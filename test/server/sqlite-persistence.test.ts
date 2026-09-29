import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  GameService,
  SqliteRoomStore,
  RoomAlreadyCompletedError,
} from '../../src/server/index.ts';
import { ROLES } from '../../src/core/index.ts';

function createTempDbPath(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return path.join(os.tmpdir(), `beer-persistence-test-${Date.now()}-${rand}.sqlite`);
}

function cleanupTempDb(dbPath: string): void {
  for (const ext of ['', '-wal', '-shm', '-journal']) {
    const fullPath = dbPath + ext;
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
      } catch {
        // ignore temporary lock on win32 if any
      }
    }
  }
}

describe('SQLite Persistence & Server-Restart Recovery', () => {
  let dbPath: string;
  let store: SqliteRoomStore;

  beforeEach(() => {
    dbPath = createTempDbPath();
    store = new SqliteRoomStore(dbPath);
  });

  afterEach(() => {
    store.close();
    cleanupTempDb(dbPath);
  });

  describe('1. Empty Database Initialization', () => {
    it('initializes schema automatically on a fresh database file', () => {
      assert.ok(fs.existsSync(dbPath));
      assert.equal(store.has('NON_EXISTENT'), false);
      assert.deepEqual(store.list(), []);
    });

    it('is safe to re-initialize schema repeatedly without error or data loss', () => {
      const room = {
        code: 'INIT01',
        status: 'waiting' as const,
        createdAt: new Date(),
        players: new Map(),
        roles: {},
        gameState: {} as any,
      };
      store.set('INIT01', room);

      // Reopen second store instance pointing to same file
      const store2 = new SqliteRoomStore(dbPath);
      assert.equal(store2.has('INIT01'), true);
      store2.close();
    });
  });

  describe('2. Room Persistence Across Store Instances', () => {
    it('persists a newly created room and loads it from a completely separate store instance', () => {
      const service1 = new GameService({ store });
      const room = service1.createRoom('PERSIST01');

      // Create new store and service simulating server restart
      const store2 = new SqliteRoomStore(dbPath);
      const service2 = new GameService({ store: store2 });

      const loadedRoom = service2.getRoom('PERSIST01');
      assert.equal(loadedRoom.code, 'PERSIST01');
      assert.equal(loadedRoom.status, 'waiting');
      assert.equal(loadedRoom.createdAt.getTime(), room.createdAt.getTime());
      assert.equal(loadedRoom.gameState.currentRound, 1);
      assert.equal(loadedRoom.gameState.status, 'in_progress');

      store2.close();
    });
  });

  describe('3. Player & Role Persistence', () => {
    it('persists player joined roles and recovers them accurately after restart', () => {
      const service1 = new GameService({ store });
      service1.createRoom('PLAYERS01');
      service1.joinRoom('PLAYERS01', 'p-ret', 'retailer');
      service1.joinRoom('PLAYERS01', 'p-who', 'wholesaler');

      // Simulate restart
      const store2 = new SqliteRoomStore(dbPath);
      const service2 = new GameService({ store: store2 });

      const summary = service2.getRoomSummary('PLAYERS01');
      assert.equal(summary.status, 'waiting');
      assert.deepEqual(summary.occupiedRoles, ['retailer', 'wholesaler']);
      assert.deepEqual(summary.availableRoles, ['distributor', 'factory']);

      // Player lookup
      const retLookup = service2.getPlayer('PLAYERS01', 'p-ret');
      assert.equal(retLookup.player.role, 'retailer');
      assert.equal(retLookup.player.id, 'p-ret');

      const whoLookup = service2.getPlayer('PLAYERS01', 'p-who');
      assert.equal(whoLookup.player.role, 'wholesaler');
      assert.equal(whoLookup.player.id, 'p-who');

      store2.close();
    });
  });

  describe('4. Game State Persistence Across Rounds', () => {
    it('persists inventory, backlog, transit shipments, orders, and round costs', () => {
      const service1 = new GameService({ store });
      service1.createRoom('STATE01');
      service1.joinRoom('STATE01', 'p1', 'retailer');
      service1.joinRoom('STATE01', 'p2', 'wholesaler');
      service1.joinRoom('STATE01', 'p3', 'distributor');
      service1.joinRoom('STATE01', 'p4', 'factory');

      // Complete round 1 with order 4
      service1.placeOrder('STATE01', 'p1', 4);
      service1.placeOrder('STATE01', 'p2', 4);
      service1.placeOrder('STATE01', 'p3', 4);
      service1.placeOrder('STATE01', 'p4', 4);

      // In Round 2: Retailer places order 8, others haven't submitted yet
      service1.placeOrder('STATE01', 'p1', 8);

      const preRestartView = service1.getPlayerView('STATE01', 'p1');
      assert.equal(preRestartView.currentRound, 2);
      assert.equal(preRestartView.hasSubmitted, true);

      // Simulate restart
      const store2 = new SqliteRoomStore(dbPath);
      const service2 = new GameService({ store: store2 });

      const postRestartView = service2.getPlayerView('STATE01', 'p1');
      assert.equal(postRestartView.currentRound, preRestartView.currentRound);
      assert.equal(postRestartView.inventory, preRestartView.inventory);
      assert.equal(postRestartView.backlog, preRestartView.backlog);
      assert.equal(postRestartView.shipmentArrived, preRestartView.shipmentArrived);
      assert.equal(postRestartView.incomingOrder, preRestartView.incomingOrder);
      assert.equal(postRestartView.roundCost, preRestartView.roundCost);
      assert.equal(postRestartView.totalCost, preRestartView.totalCost);
      assert.equal(postRestartView.hasSubmitted, true);
      assert.deepEqual(postRestartView.peerSubmissions, preRestartView.peerSubmissions);

      // Wholesaler view after restart
      const wholesalerView = service2.getPlayerView('STATE01', 'p2');
      assert.equal(wholesalerView.hasSubmitted, false);
      assert.equal(wholesalerView.peerSubmissions.retailer, true);
      assert.equal(wholesalerView.peerSubmissions.wholesaler, false);

      store2.close();
    });
  });

  describe('5. Active Game Recovery', () => {
    it('restores an active game without advancing state or altering round number', () => {
      const service1 = new GameService({ store });
      service1.createRoom('ACTIVE01');
      service1.joinRoom('ACTIVE01', 'p1', 'retailer');
      service1.joinRoom('ACTIVE01', 'p2', 'wholesaler');
      service1.joinRoom('ACTIVE01', 'p3', 'distributor');
      service1.joinRoom('ACTIVE01', 'p4', 'factory');

      // Advance through 3 complete rounds
      for (let r = 1; r <= 3; r++) {
        for (let i = 1; i <= 4; i++) {
          service1.placeOrder('ACTIVE01', `p${i}`, 4);
        }
      }

      const roomPre = service1.getRoom('ACTIVE01');
      assert.equal(roomPre.status, 'active');
      assert.equal(roomPre.gameState.currentRound, 4);

      // Simulate restart
      const store2 = new SqliteRoomStore(dbPath);
      const service2 = new GameService({ store: store2 });

      const roomPost = service2.getRoom('ACTIVE01');
      assert.equal(roomPost.status, 'active');
      assert.equal(roomPost.gameState.currentRound, 4);
      assert.equal(roomPost.gameState.history.length, 3);

      // Verify players can continue playing in Round 4
      service2.placeOrder('ACTIVE01', 'p1', 4);
      service2.placeOrder('ACTIVE01', 'p2', 4);
      service2.placeOrder('ACTIVE01', 'p3', 4);
      const v4 = service2.placeOrder('ACTIVE01', 'p4', 4);

      assert.equal(v4.currentRound, 5);

      store2.close();
    });
  });

  describe('6. Waiting Room Recovery', () => {
    it('restores a waiting room and allows new players to join and activate it after restart', () => {
      const service1 = new GameService({ store });
      service1.createRoom('WAIT_RECOVER');
      service1.joinRoom('WAIT_RECOVER', 'p-ret', 'retailer');
      service1.joinRoom('WAIT_RECOVER', 'p-who', 'wholesaler');

      // Simulate restart while 2 roles are missing
      const store2 = new SqliteRoomStore(dbPath);
      const service2 = new GameService({ store: store2 });

      const summary = service2.getRoomSummary('WAIT_RECOVER');
      assert.equal(summary.status, 'waiting');
      assert.equal(summary.allRolesFilled, false);

      // Remaining roles join post-restart
      service2.joinRoom('WAIT_RECOVER', 'p-dis', 'distributor');
      const finalJoin = service2.joinRoom('WAIT_RECOVER', 'p-fac', 'factory');

      assert.equal(finalJoin.roomStatus, 'active');
      assert.equal(finalJoin.allRolesFilled, true);

      store2.close();
    });
  });

  describe('7. Completed Game Recovery', () => {
    it('restores completed game state, preserves final costs, and rejects new orders', () => {
      const service1 = new GameService({ store });
      service1.createRoom('DONE01');
      service1.joinRoom('DONE01', 'p1', 'retailer');
      service1.joinRoom('DONE01', 'p2', 'wholesaler');
      service1.joinRoom('DONE01', 'p3', 'distributor');
      service1.joinRoom('DONE01', 'p4', 'factory');

      // Play through round 20
      for (let r = 1; r <= 20; r++) {
        for (let i = 1; i <= 4; i++) {
          service1.placeOrder('DONE01', `p${i}`, 4);
        }
      }

      // Simulate restart
      const store2 = new SqliteRoomStore(dbPath);
      const service2 = new GameService({ store: store2 });

      const room = service2.getRoom('DONE01');
      assert.equal(room.status, 'completed');
      assert.equal(room.gameState.status, 'completed');
      assert.equal(room.gameState.currentRound, 20);

      const view = service2.getPlayerView('DONE01', 'p1');
      assert.equal(view.roomStatus, 'completed');
      assert.ok(view.finalCosts);
      assert.equal(view.finalCosts.retailer, 394);
      assert.equal(view.finalCosts.wholesaler, 120);
      assert.equal(view.finalCosts.distributor, 120);
      assert.equal(view.finalCosts.factory, 120);
      assert.equal(view.overallTotalCost, 754);

      // Verify rejections
      assert.throws(
        () => service2.placeOrder('DONE01', 'p1', 4),
        RoomAlreadyCompletedError,
      );
      assert.throws(
        () => service2.joinRoom('DONE01', 'p5', 'retailer'),
        RoomAlreadyCompletedError,
      );

      store2.close();
    });
  });

  describe('8. Player Role Reconnection & View Projection', () => {
    it('resolves roomCode + playerId to the identical role and projected view after restart', () => {
      const service1 = new GameService({ store });
      service1.createRoom('RECON01');
      service1.joinRoom('RECON01', 'alice', 'distributor');

      // Simulate restart
      const store2 = new SqliteRoomStore(dbPath);
      const service2 = new GameService({ store: store2 });

      const { player } = service2.getPlayer('RECON01', 'alice');
      assert.equal(player.id, 'alice');
      assert.equal(player.role, 'distributor');

      const view = service2.getPlayerView('RECON01', 'alice');
      assert.equal(view.role, 'distributor');
      assert.equal(view.roomCode, 'RECON01');
      assert.equal(view.assignedRoles.distributor, true);
      assert.equal(view.assignedRoles.retailer, false);

      // Idempotent re-join also succeeds and returns matching view
      const rejoinView = service2.joinRoom('RECON01', 'alice', 'distributor');
      assert.equal(rejoinView.role, 'distributor');

      store2.close();
    });
  });

  describe('9. No Accidental State Advancement on Restart', () => {
    it('ensures restarting multiple times leaves the game state completely unchanged', () => {
      const service1 = new GameService({ store });
      service1.createRoom('IDLE01');
      service1.joinRoom('IDLE01', 'p1', 'retailer');
      service1.joinRoom('IDLE01', 'p2', 'wholesaler');
      service1.joinRoom('IDLE01', 'p3', 'distributor');
      service1.joinRoom('IDLE01', 'p4', 'factory');

      // Place 2 orders in round 1
      service1.placeOrder('IDLE01', 'p1', 5);
      service1.placeOrder('IDLE01', 'p2', 6);

      const baselineSnapshot = JSON.stringify(service1.getRoom('IDLE01').gameState);

      // Restart cycle 1
      const store2 = new SqliteRoomStore(dbPath);
      const service2 = new GameService({ store: store2 });
      assert.equal(JSON.stringify(service2.getRoom('IDLE01').gameState), baselineSnapshot);
      store2.close();

      // Restart cycle 2
      const store3 = new SqliteRoomStore(dbPath);
      const service3 = new GameService({ store: store3 });
      assert.equal(JSON.stringify(service3.getRoom('IDLE01').gameState), baselineSnapshot);
      store3.close();
    });
  });

  describe('10. Full Deterministic Mid-Game Recovery Scenario', () => {
    it('plays rounds 1-10, restarts the server, continues rounds 11-20 to exact Golden Master values', () => {
      // Phase A: Play rounds 1 to 10
      const serviceA = new GameService({ store });
      serviceA.createRoom('MIDGAME');
      serviceA.joinRoom('MIDGAME', 'p-ret', 'retailer');
      serviceA.joinRoom('MIDGAME', 'p-who', 'wholesaler');
      serviceA.joinRoom('MIDGAME', 'p-dis', 'distributor');
      serviceA.joinRoom('MIDGAME', 'p-fac', 'factory');

      for (let r = 1; r <= 10; r++) {
        serviceA.placeOrder('MIDGAME', 'p-ret', 4);
        serviceA.placeOrder('MIDGAME', 'p-who', 4);
        serviceA.placeOrder('MIDGAME', 'p-dis', 4);
        serviceA.placeOrder('MIDGAME', 'p-fac', 4);
      }

      const midRoom = serviceA.getRoom('MIDGAME');
      assert.equal(midRoom.gameState.currentRound, 11);
      assert.equal(midRoom.gameState.history.length, 10);
      assert.equal(midRoom.gameState.history[9].retailer.totalCost, 54); // Round 10 history totalCost = 54
      assert.equal(midRoom.gameState.roles.retailer.totalCost, 70); // Round 11 active totalCost after steps 1-4 = 70

      // Simulate full server shutdown and restart
      const storeB = new SqliteRoomStore(dbPath);
      const serviceB = new GameService({ store: storeB });

      // Phase B: Continue from round 11 to 20
      for (let r = 11; r <= 20; r++) {
        serviceB.placeOrder('MIDGAME', 'p-ret', 4);
        serviceB.placeOrder('MIDGAME', 'p-who', 4);
        serviceB.placeOrder('MIDGAME', 'p-dis', 4);
        serviceB.placeOrder('MIDGAME', 'p-fac', 4);
      }

      const finalRoom = serviceB.getRoom('MIDGAME');
      assert.equal(finalRoom.status, 'completed');
      assert.equal(finalRoom.gameState.currentRound, 20);
      assert.equal(finalRoom.gameState.history.length, 20);

      // Verify exact final costs matching EXAMPLE.md
      assert.equal(finalRoom.gameState.finalCosts?.retailer, 394);
      assert.equal(finalRoom.gameState.finalCosts?.wholesaler, 120);
      assert.equal(finalRoom.gameState.finalCosts?.distributor, 120);
      assert.equal(finalRoom.gameState.finalCosts?.factory, 120);
      assert.equal(finalRoom.gameState.totalCost, 754);

      storeB.close();
    });
  });
});
