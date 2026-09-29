import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  GameService,
  RoomNotFoundError,
  RoomAlreadyActiveError,
  RoomAlreadyCompletedError,
  RoleUnavailableError,
  PlayerAlreadyInRoomError,
  PlayerNotInRoomError,
  GameNotActiveError,
} from '../../src/server/index.ts';
import {
  ROLES,
  InvalidOrderError,
  DuplicateOrderError,
  InvalidRoleError,
} from '../../src/core/index.ts';

describe('GameService (Authoritative Server Layer)', () => {
  let service: GameService;

  beforeEach(() => {
    service = new GameService({
      codeGenerator: () => 'TEST01',
    });
  });

  describe('1. Room Creation', () => {
    it('creates a room in waiting state with no occupied roles', () => {
      const room = service.createRoom();

      assert.equal(room.code, 'TEST01');
      assert.equal(room.status, 'waiting');
      assert.equal(room.players.size, 0);
      assert.deepEqual(room.roles, {});
      assert.ok(room.gameState);
      assert.equal(room.gameState.currentRound, 1);
      assert.equal(room.gameState.status, 'in_progress');
    });

    it('creates a room with custom code', () => {
      const custom = service.createRoom('CUSTOM');
      assert.equal(custom.code, 'CUSTOM');
    });

    it('rejects duplicate room creation with same code', () => {
      service.createRoom('DUP01');
      assert.throws(() => service.createRoom('DUP01'), /already exists/);
    });

    it('provides accurate room summary', () => {
      service.createRoom('SUMM01');
      const summary = service.getRoomSummary('SUMM01');

      assert.equal(summary.code, 'SUMM01');
      assert.equal(summary.status, 'waiting');
      assert.equal(summary.allRolesFilled, false);
      assert.deepEqual(summary.occupiedRoles, []);
      assert.deepEqual(summary.availableRoles, ROLES);
      assert.equal(summary.currentRound, 1);
    });
  });

  describe('2. Role Assignment & Joining', () => {
    it('allows valid roles to be joined', () => {
      service.createRoom('JOIN01');
      const view = service.joinRoom('JOIN01', 'p1', 'retailer');

      assert.equal(view.roomCode, 'JOIN01');
      assert.equal(view.role, 'retailer');
      assert.equal(view.roomStatus, 'waiting');
      assert.equal(view.assignedRoles.retailer, true);
      assert.equal(view.assignedRoles.wholesaler, false);
      assert.equal(view.allRolesFilled, false);
    });

    it('rejects joining an occupied role', () => {
      service.createRoom('JOIN02');
      service.joinRoom('JOIN02', 'p1', 'retailer');

      assert.throws(
        () => service.joinRoom('JOIN02', 'p2', 'retailer'),
        RoleUnavailableError,
      );
    });

    it('rejects invalid roles', () => {
      service.createRoom('JOIN03');
      assert.throws(
        () => service.joinRoom('JOIN03', 'p1', 'invalid_role' as any),
        InvalidRoleError,
      );
    });

    it('rejects a player joining a different role in the same room', () => {
      service.createRoom('JOIN04');
      service.joinRoom('JOIN04', 'p1', 'retailer');

      assert.throws(
        () => service.joinRoom('JOIN04', 'p1', 'wholesaler'),
        PlayerAlreadyInRoomError,
      );
    });

    it('handles idempotent re-join by the same player with the same role', () => {
      service.createRoom('REJOIN');
      const first = service.joinRoom('REJOIN', 'p1', 'retailer');
      const second = service.joinRoom('REJOIN', 'p1', 'retailer');

      assert.equal(first.role, second.role);
      assert.equal(first.roomCode, second.roomCode);
    });

    it('rejects joining a non-existent room', () => {
      assert.throws(
        () => service.joinRoom('UNKNOWN', 'p1', 'retailer'),
        RoomNotFoundError,
      );
    });
  });

  describe('3. Room Activation Lifecycle', () => {
    it('remains waiting with 1 to 3 players', () => {
      service.createRoom('ACT01');

      service.joinRoom('ACT01', 'p1', 'retailer');
      assert.equal(service.getRoom('ACT01').status, 'waiting');

      service.joinRoom('ACT01', 'p2', 'wholesaler');
      assert.equal(service.getRoom('ACT01').status, 'waiting');

      service.joinRoom('ACT01', 'p3', 'distributor');
      assert.equal(service.getRoom('ACT01').status, 'waiting');
    });

    it('becomes active when the fourth role is filled', () => {
      service.createRoom('ACT02');

      service.joinRoom('ACT02', 'p1', 'retailer');
      service.joinRoom('ACT02', 'p2', 'wholesaler');
      service.joinRoom('ACT02', 'p3', 'distributor');
      const view4 = service.joinRoom('ACT02', 'p4', 'factory');

      assert.equal(view4.roomStatus, 'active');
      assert.equal(view4.allRolesFilled, true);
      assert.equal(service.getRoom('ACT02').status, 'active');
    });

    it('rejects joining when all roles are already filled', () => {
      service.createRoom('ACT03');
      service.joinRoom('ACT03', 'p1', 'retailer');
      service.joinRoom('ACT03', 'p2', 'wholesaler');
      service.joinRoom('ACT03', 'p3', 'distributor');
      service.joinRoom('ACT03', 'p4', 'factory');

      assert.throws(
        () => service.joinRoom('ACT03', 'p5', 'retailer'),
        RoomAlreadyActiveError,
      );
    });
  });

  describe('4. Player Lookup', () => {
    it('resolves registered players and roles correctly', () => {
      service.createRoom('LOOK01');
      service.joinRoom('LOOK01', 'p1', 'retailer');

      const { player, room } = service.getPlayer('LOOK01', 'p1');
      assert.equal(player.id, 'p1');
      assert.equal(player.role, 'retailer');
      assert.equal(room.code, 'LOOK01');
    });

    it('rejects lookup of unregistered player in existing room', () => {
      service.createRoom('LOOK02');
      assert.throws(
        () => service.getPlayer('LOOK02', 'ghost'),
        PlayerNotInRoomError,
      );
    });

    it('rejects player lookup in unknown room', () => {
      assert.throws(
        () => service.getPlayer('NONE', 'p1'),
        RoomNotFoundError,
      );
    });
  });

  describe('5. Authoritative Order Placement', () => {
    beforeEach(() => {
      service.createRoom('ORDER01');
      service.joinRoom('ORDER01', 'p1', 'retailer');
      service.joinRoom('ORDER01', 'p2', 'wholesaler');
      service.joinRoom('ORDER01', 'p3', 'distributor');
      service.joinRoom('ORDER01', 'p4', 'factory');
    });

    it('accepts valid order from registered player', () => {
      const view = service.placeOrder('ORDER01', 'p1', 4);
      assert.equal(view.hasSubmitted, true);
      assert.equal(view.peerSubmissions.retailer, true);
      assert.equal(view.peerSubmissions.wholesaler, false);
      assert.equal(view.currentRound, 1);
    });

    it('rejects orders when room is still waiting for players', () => {
      service.createRoom('WAIT01');
      service.joinRoom('WAIT01', 'p1', 'retailer');

      assert.throws(
        () => service.placeOrder('WAIT01', 'p1', 4),
        GameNotActiveError,
      );
    });

    it('rejects duplicate orders from the same player in the same round', () => {
      service.placeOrder('ORDER01', 'p1', 4);

      assert.throws(
        () => service.placeOrder('ORDER01', 'p1', 4),
        DuplicateOrderError,
      );
    });

    it('rejects invalid order values (negative numbers, non-integers)', () => {
      assert.throws(
        () => service.placeOrder('ORDER01', 'p1', -1),
        InvalidOrderError,
      );
      assert.throws(
        () => service.placeOrder('ORDER01', 'p1', 2.5),
        InvalidOrderError,
      );
      assert.throws(
        () => service.placeOrder('ORDER01', 'p1', NaN),
        InvalidOrderError,
      );
    });

    it('rejects orders from unknown players', () => {
      assert.throws(
        () => service.placeOrder('ORDER01', 'intruder', 4),
        PlayerNotInRoomError,
      );
    });
  });

  describe('6. Round Progression Across Service Layer', () => {
    it('advances round when all 4 players submit orders and resets flags', () => {
      service.createRoom('ROUND01');
      service.joinRoom('ROUND01', 'p1', 'retailer');
      service.joinRoom('ROUND01', 'p2', 'wholesaler');
      service.joinRoom('ROUND01', 'p3', 'distributor');
      service.joinRoom('ROUND01', 'p4', 'factory');

      // Round 1 submissions
      service.placeOrder('ROUND01', 'p1', 4);
      service.placeOrder('ROUND01', 'p2', 4);
      service.placeOrder('ROUND01', 'p3', 4);
      const view4 = service.placeOrder('ROUND01', 'p4', 4);

      // Round advanced to 2
      assert.equal(view4.currentRound, 2);
      assert.equal(view4.hasSubmitted, false);
      assert.deepEqual(view4.peerSubmissions, {
        retailer: false,
        wholesaler: false,
        distributor: false,
        factory: false,
      });

      // Checking other players' views also shows round 2
      const retailerRound2 = service.getPlayerView('ROUND01', 'p1');
      assert.equal(retailerRound2.currentRound, 2);
      assert.equal(retailerRound2.hasSubmitted, false);
      assert.equal(retailerRound2.peerSubmissions.retailer, false);
    });
  });

  describe('7. Strict Information Hiding (Player Views)', () => {
    it('provides role-specific views and strictly hides peer metrics during active play', () => {
      service.createRoom('HIDE01');
      service.joinRoom('HIDE01', 'p-ret', 'retailer');
      service.joinRoom('HIDE01', 'p-who', 'wholesaler');
      service.joinRoom('HIDE01', 'p-dis', 'distributor');
      service.joinRoom('HIDE01', 'p-fac', 'factory');

      // Retailer submits order
      service.placeOrder('HIDE01', 'p-ret', 7);

      const retailer = service.getPlayerView('HIDE01', 'p-ret');
      const factory = service.getPlayerView('HIDE01', 'p-fac');

      // Retailer sees their own role
      assert.equal(retailer.role, 'retailer');
      assert.equal(retailer.inventory, 12);
      assert.equal(retailer.hasSubmitted, true);
      assert.equal(retailer.peerSubmissions.retailer, true);
      assert.equal(retailer.peerSubmissions.factory, false);

      // Factory sees factory role
      assert.equal(factory.role, 'factory');
      assert.equal(factory.inventory, 12);
      assert.equal(factory.hasSubmitted, false);
      assert.equal(factory.peerSubmissions.retailer, true);
      assert.equal(factory.peerSubmissions.factory, false);

      // Verify that neither player has access to the raw internal game state or peer metrics
      assert.equal((retailer as any).roles, undefined);
      assert.equal((retailer as any).history, undefined);
      assert.equal((retailer as any).currentOrders, undefined);
      assert.equal((factory as any).roles, undefined);
      assert.equal((factory as any).history, undefined);
      assert.equal((factory as any).currentOrders, undefined);
    });
  });

  describe('8. Completed Game Lifecycle', () => {
    it('runs a full 20-round game to completion, exposes final costs, and rejects further orders', () => {
      service.createRoom('COMP01');
      service.joinRoom('COMP01', 'p1', 'retailer');
      service.joinRoom('COMP01', 'p2', 'wholesaler');
      service.joinRoom('COMP01', 'p3', 'distributor');
      service.joinRoom('COMP01', 'p4', 'factory');

      // Play 20 rounds where all players order 4
      for (let r = 1; r <= 20; r++) {
        service.placeOrder('COMP01', 'p1', 4);
        service.placeOrder('COMP01', 'p2', 4);
        service.placeOrder('COMP01', 'p3', 4);
        service.placeOrder('COMP01', 'p4', 4);
      }

      const room = service.getRoom('COMP01');
      assert.equal(room.status, 'completed');
      assert.equal(room.gameState.status, 'completed');

      const view = service.getPlayerView('COMP01', 'p1');
      assert.equal(view.roomStatus, 'completed');
      assert.ok(view.finalCosts);
      assert.equal(view.finalCosts.retailer, 394);
      assert.equal(view.finalCosts.wholesaler, 120);
      assert.equal(view.finalCosts.distributor, 120);
      assert.equal(view.finalCosts.factory, 120);
      assert.equal(view.overallTotalCost, 754);

      // Placing order in completed room throws RoomAlreadyCompletedError
      assert.throws(
        () => service.placeOrder('COMP01', 'p1', 4),
        RoomAlreadyCompletedError,
      );

      // Joining completed room throws RoomAlreadyCompletedError
      assert.throws(
        () => service.joinRoom('COMP01', 'p5', 'retailer'),
        RoomAlreadyCompletedError,
      );
    });
  });
});
