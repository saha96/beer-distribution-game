import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

import {
  GameService,
  RealtimeServer,
  SqliteRoomStore,
  InMemoryRoomStore,
} from '../../src/server/index.ts';
import type { ServerMessage, RoomStateMessage, ErrorMessage } from '../../src/server/index.ts';
import { ROLES, type Role } from '../../src/core/index.ts';

function createTempDbPath(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return path.join(os.tmpdir(), `beer-ws-test-${Date.now()}-${rand}.sqlite`);
}

function cleanupTempDb(dbPath: string): void {
  for (const ext of ['', '-wal', '-shm', '-journal']) {
    const fullPath = dbPath + ext;
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
      } catch {
        // ignore
      }
    }
  }
}

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitForMessage<T = ServerMessage>(
  ws: WebSocket,
  predicate?: (msg: T) => boolean,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`Timeout waiting for WebSocket message after ${timeoutMs}ms`));
    }, timeoutMs);

    function onMessage(data: any) {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf-8');
        const parsed = JSON.parse(text) as T;
        if (!predicate || predicate(parsed)) {
          clearTimeout(timer);
          ws.off('message', onMessage);
          resolve(parsed);
        }
      } catch (err) {
        // continue listening
      }
    }

    ws.on('message', onMessage);
  });
}

function sendJson(ws: WebSocket, payload: unknown): void {
  ws.send(JSON.stringify(payload));
}

async function closeClient(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.close();
    });
  }
}

describe('Realtime WebSocket Server & Protocol Integration', () => {
  let server: RealtimeServer;
  let service: GameService;
  let port: number;
  const clients: WebSocket[] = [];

  beforeEach(async () => {
    service = new GameService({ store: new InMemoryRoomStore() });
    server = new RealtimeServer({
      gameService: service,
      port: 0, // dynamic port assigned by OS
    });
    port = await server.start();
  });

  afterEach(async () => {
    for (const client of clients) {
      await closeClient(client);
    }
    clients.length = 0;
    await server.close();
  });

  describe('18.1 Create Room', () => {
    it('creates room and sends initial room_state view to creator', async () => {
      const ws = await connectClient(port);
      clients.push(ws);

      const msgPromise = waitForMessage<RoomStateMessage>(
        ws,
        (msg) => msg.type === 'room_state',
      );

      sendJson(ws, {
        type: 'create_room',
        playerId: 'creator-1',
        role: 'retailer',
        customCode: 'ROOM181',
      });

      const response = await msgPromise;
      assert.equal(response.type, 'room_state');
      assert.equal(response.view.roomCode, 'ROOM181');
      assert.equal(response.view.role, 'retailer');
      assert.equal(response.view.roomStatus, 'waiting');
      assert.equal(response.view.assignedRoles.retailer, true);
      assert.equal(response.view.assignedRoles.factory, false);
      assert.equal(response.view.allRolesFilled, false);
    });
  });

  describe('18.2 Join Room & Role Conflict Handling', () => {
    it('allows distinct roles to join and rejects role collisions', async () => {
      const ws1 = await connectClient(port);
      const ws2 = await connectClient(port);
      const ws3 = await connectClient(port);
      clients.push(ws1, ws2, ws3);

      // Creator joins as retailer
      const p1 = waitForMessage<RoomStateMessage>(ws1, (m) => m.type === 'room_state');
      sendJson(ws1, {
        type: 'create_room',
        playerId: 'p1',
        role: 'retailer',
        customCode: 'JOIN182',
      });
      await p1;

      // Player 2 joins as wholesaler
      const p2 = waitForMessage<RoomStateMessage>(ws2, (m) => m.type === 'room_state');
      sendJson(ws2, {
        type: 'join_room',
        roomCode: 'JOIN182',
        playerId: 'p2',
        role: 'wholesaler',
      });
      const r2 = await p2;
      assert.equal(r2.view.role, 'wholesaler');
      assert.equal(r2.view.assignedRoles.retailer, true);
      assert.equal(r2.view.assignedRoles.wholesaler, true);

      // Player 3 tries to join already-taken retailer role -> error
      const p3Err = waitForMessage<ErrorMessage>(ws3, (m) => m.type === 'error');
      sendJson(ws3, {
        type: 'join_room',
        roomCode: 'JOIN182',
        playerId: 'p3',
        role: 'retailer',
      });
      const err = await p3Err;
      assert.equal(err.code, 'ROLE_UNAVAILABLE');
    });
  });

  describe('18.3 Room Activation Broadcast', () => {
    it('transitions to active when 4th player joins and broadcasts to all clients', async () => {
      const sockets: WebSocket[] = [];
      for (let i = 0; i < 4; i++) {
        const s = await connectClient(port);
        clients.push(s);
        sockets.push(s);
      }

      // Creator
      sendJson(sockets[0], {
        type: 'create_room',
        playerId: 'p-ret',
        role: 'retailer',
        customCode: 'ACT183',
      });
      await waitForMessage(sockets[0], (m: any) => m.type === 'room_state');

      // Player 2 & 3 join
      sendJson(sockets[1], {
        type: 'join_room',
        roomCode: 'ACT183',
        playerId: 'p-who',
        role: 'wholesaler',
      });
      await waitForMessage(sockets[1], (m: any) => m.type === 'room_state');

      sendJson(sockets[2], {
        type: 'join_room',
        roomCode: 'ACT183',
        playerId: 'p-dis',
        role: 'distributor',
      });
      await waitForMessage(sockets[2], (m: any) => m.type === 'room_state');

      // Set up listeners for the 4th player join broadcast on all sockets
      const promises = sockets.map((s) =>
        waitForMessage<RoomStateMessage>(
          s,
          (m) => m.type === 'room_state' && m.view.allRolesFilled === true,
        ),
      );

      // 4th player joins
      sendJson(sockets[3], {
        type: 'join_room',
        roomCode: 'ACT183',
        playerId: 'p-fac',
        role: 'factory',
      });

      const responses = await Promise.all(promises);

      // Verify all 4 received active state with their respective roles
      assert.equal(responses[0].view.role, 'retailer');
      assert.equal(responses[0].view.roomStatus, 'active');

      assert.equal(responses[1].view.role, 'wholesaler');
      assert.equal(responses[1].view.roomStatus, 'active');

      assert.equal(responses[2].view.role, 'distributor');
      assert.equal(responses[2].view.roomStatus, 'active');

      assert.equal(responses[3].view.role, 'factory');
      assert.equal(responses[3].view.roomStatus, 'active');
    });
  });

  describe('18.4 Strict Information Hiding (Over-the-Wire Inspection)', () => {
    it('verifies that transmitted JSON payloads never leak peer numbers or unprojected metrics', async () => {
      const wsRet = await connectClient(port);
      const wsFac = await connectClient(port);
      clients.push(wsRet, wsFac);

      sendJson(wsRet, {
        type: 'create_room',
        playerId: 'ret',
        role: 'retailer',
        customCode: 'HIDE184',
      });
      const retJoined = await waitForMessage<RoomStateMessage>(wsRet);

      sendJson(wsFac, {
        type: 'join_room',
        roomCode: 'HIDE184',
        playerId: 'fac',
        role: 'factory',
      });
      const facJoined = await waitForMessage<RoomStateMessage>(wsFac);

      // Inspect Retailer payload
      const retView = retJoined.view as any;
      assert.equal(retView.role, 'retailer');
      assert.equal(retView.inventory, 12);
      assert.equal(retView.factoryInventory, undefined);
      assert.equal(retView.wholesalerInventory, undefined);
      assert.equal(retView.roles, undefined);
      assert.equal(retView.history, undefined);
      assert.equal(retView.currentOrders, undefined);

      // Inspect Factory payload
      const facView = facJoined.view as any;
      assert.equal(facView.role, 'factory');
      assert.equal(facView.inventory, 12);
      assert.equal(facView.retailerInventory, undefined);
      assert.equal(facView.retailerBacklog, undefined);
      assert.equal(facView.roles, undefined);
      assert.equal(facView.history, undefined);

      // Peer submissions must only be booleans
      for (const role of ROLES) {
        assert.equal(typeof retView.peerSubmissions[role], 'boolean');
        assert.equal(typeof facView.peerSubmissions[role], 'boolean');
      }
    });
  });

  describe('18.5 Order Propagation & Turn Advancements', () => {
    it('propagates orders, rejects duplicate submissions, and advances round on 4th order', async () => {
      const sockets: WebSocket[] = [];
      const roles: Role[] = ['retailer', 'wholesaler', 'distributor', 'factory'];

      for (let i = 0; i < 4; i++) {
        const s = await connectClient(port);
        clients.push(s);
        sockets.push(s);
      }

      // Initialize room
      sendJson(sockets[0], {
        type: 'create_room',
        playerId: 'p0',
        role: roles[0],
        customCode: 'ORDER185',
      });
      await waitForMessage(sockets[0]);

      for (let i = 1; i < 4; i++) {
        sendJson(sockets[i], {
          type: 'join_room',
          roomCode: 'ORDER185',
          playerId: `p${i}`,
          role: roles[i],
        });
        await waitForMessage(sockets[i], (m: any) => m.type === 'room_state');
      }

      // Retailer submits order 4
      const retOrderPromise = waitForMessage<RoomStateMessage>(sockets[0]);
      sendJson(sockets[0], {
        type: 'place_order',
        order: 4,
      });
      const retState = await retOrderPromise;
      assert.equal(retState.view.hasSubmitted, true);
      assert.equal(retState.view.currentRound, 1);
      assert.equal(retState.view.peerSubmissions.retailer, true);
      assert.equal(retState.view.peerSubmissions.wholesaler, false);

      // Duplicate order submission by retailer rejected
      const dupPromise = waitForMessage<ErrorMessage>(sockets[0], (m) => m.type === 'error');
      sendJson(sockets[0], {
        type: 'place_order',
        order: 6,
      });
      const dupErr = await dupPromise;
      assert.equal(dupErr.code, 'DUPLICATE_ORDER');

      // Wholesaler and Distributor submit
      sendJson(sockets[1], { type: 'place_order', order: 4 });
      await waitForMessage(sockets[1]);

      sendJson(sockets[2], { type: 'place_order', order: 4 });
      await waitForMessage(sockets[2]);

      // Set up listeners for round 2 advancement across all sockets
      const round2Promises = sockets.map((s) =>
        waitForMessage<RoomStateMessage>(
          s,
          (m) => m.type === 'room_state' && m.view.currentRound === 2,
        ),
      );

      // Factory submits 4th order -> triggers round advance
      sendJson(sockets[3], { type: 'place_order', order: 4 });

      const round2States = await Promise.all(round2Promises);

      // Verify all sockets received round 2 state and reset flags
      for (const state of round2States) {
        assert.equal(state.view.currentRound, 2);
        assert.equal(state.view.hasSubmitted, false);
        assert.equal(state.view.peerSubmissions.retailer, false);
        assert.equal(state.view.peerSubmissions.factory, false);
      }
    });
  });

  describe('18.6 Identity Switching Protection', () => {
    it('prevents a socket connected as player A from submitting orders as player B', async () => {
      const wsA = await connectClient(port);
      const wsB = await connectClient(port);
      clients.push(wsA, wsB);

      // Player A creates room
      sendJson(wsA, {
        type: 'create_room',
        playerId: 'alice',
        role: 'retailer',
        customCode: 'AUTH186',
      });
      await waitForMessage(wsA);

      // Player B joins
      sendJson(wsB, {
        type: 'join_room',
        roomCode: 'AUTH186',
        playerId: 'bob',
        role: 'wholesaler',
      });
      await waitForMessage(wsB);

      // Player A attempts to place order claiming to be "bob"
      const errPromise = waitForMessage<ErrorMessage>(wsA, (m) => m.type === 'error');
      sendJson(wsA, {
        type: 'place_order',
        roomCode: 'AUTH186',
        playerId: 'bob', // Mismatch!
        order: 4,
      });
      const err = await errPromise;
      assert.equal(err.code, 'IDENTITY_MISMATCH');
    });

    it('rejects orders from unauthenticated sockets without an active session', async () => {
      const ws = await connectClient(port);
      clients.push(ws);

      const errPromise = waitForMessage<ErrorMessage>(ws, (m) => m.type === 'error');
      sendJson(ws, {
        type: 'place_order',
        order: 4,
      });
      const err = await errPromise;
      assert.equal(err.code, 'SESSION_REQUIRED');
    });
  });

  describe('18.7 Disconnect & Reconnect (Resume Session)', () => {
    it('recovers player role and state upon reconnecting with resume', async () => {
      const ws1 = await connectClient(port);
      clients.push(ws1);

      sendJson(ws1, {
        type: 'create_room',
        playerId: 'reconnect-player',
        role: 'distributor',
        customCode: 'RECON187',
      });
      const initialView = await waitForMessage<RoomStateMessage>(ws1);
      assert.equal(initialView.view.role, 'distributor');

      // Disconnect socket 1
      await closeClient(ws1);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify server connection registry dropped the socket
      assert.equal(server.getConnectedPlayers('RECON187').length, 0);

      // New socket connects and resumes session
      const ws2 = await connectClient(port);
      clients.push(ws2);

      const resumePromise = waitForMessage<RoomStateMessage>(ws2);
      sendJson(ws2, {
        type: 'resume',
        roomCode: 'RECON187',
        playerId: 'reconnect-player',
      });

      const resumedView = await resumePromise;
      assert.equal(resumedView.type, 'room_state');
      assert.equal(resumedView.view.role, 'distributor');
      assert.equal(resumedView.view.roomCode, 'RECON187');
      assert.equal(resumedView.view.inventory, 12);
      assert.equal(server.getConnectedPlayers('RECON187').length, 1);
    });
  });

  describe('18.8 Server Restart Recovery Over WebSockets', () => {
    it('restores state after closing and reopening server with SQLite store', async () => {
      const dbPath = createTempDbPath();
      const sqliteStore = new SqliteRoomStore(dbPath);
      const sqliteService = new GameService({ store: sqliteStore });
      const wsServer1 = new RealtimeServer({ gameService: sqliteService, port: 0 });
      const port1 = await wsServer1.start();

      // Client connects to server 1
      const client1 = await connectClient(port1);
      sendJson(client1, {
        type: 'create_room',
        playerId: 'p-sqlite',
        role: 'retailer',
        customCode: 'SQLITE188',
      });
      await waitForMessage(client1);
      await closeClient(client1);
      await wsServer1.close();
      sqliteStore.close();

      // Start new server 2 on fresh port using the same SQLite database
      const sqliteStore2 = new SqliteRoomStore(dbPath);
      const sqliteService2 = new GameService({ store: sqliteStore2 });
      const wsServer2 = new RealtimeServer({ gameService: sqliteService2, port: 0 });
      const port2 = await wsServer2.start();

      // Client connects to server 2 and resumes
      const client2 = await connectClient(port2);
      const resumePromise = waitForMessage<RoomStateMessage>(client2);
      sendJson(client2, {
        type: 'resume',
        roomCode: 'SQLITE188',
        playerId: 'p-sqlite',
      });

      const recovered = await resumePromise;
      assert.equal(recovered.view.roomCode, 'SQLITE188');
      assert.equal(recovered.view.role, 'retailer');
      assert.equal(recovered.view.inventory, 12);

      await closeClient(client2);
      await wsServer2.close();
      sqliteStore2.close();
      cleanupTempDb(dbPath);
    });
  });

  describe('18.9 Malformed Messages & Server Resilience', () => {
    it('safely handles malformed JSON without crashing server', async () => {
      const ws = await connectClient(port);
      clients.push(ws);

      const errPromise = waitForMessage<ErrorMessage>(ws, (m) => m.type === 'error');
      ws.send('NOT_A_VALID_JSON{{{');

      const err = await errPromise;
      assert.equal(err.code, 'INVALID_JSON');
      assert.equal(ws.readyState, WebSocket.OPEN); // connection remains healthy
    });

    it('safely handles missing or unknown message type', async () => {
      const ws = await connectClient(port);
      clients.push(ws);

      const err1 = waitForMessage<ErrorMessage>(ws, (m) => m.type === 'error');
      sendJson(ws, { foo: 'bar' });
      const res1 = await err1;
      assert.equal(res1.code, 'INVALID_MESSAGE');

      const err2 = waitForMessage<ErrorMessage>(ws, (m) => m.type === 'error');
      sendJson(ws, { type: 'unknown_type' });
      const res2 = await err2;
      assert.equal(res2.code, 'UNKNOWN_MESSAGE_TYPE');
    });

    it('safely handles invalid order types in place_order', async () => {
      const ws = await connectClient(port);
      clients.push(ws);

      // Join first
      sendJson(ws, {
        type: 'create_room',
        playerId: 'validator',
        role: 'retailer',
        customCode: 'VAL189',
      });
      await waitForMessage(ws);

      const errPromise = waitForMessage<ErrorMessage>(ws, (m) => m.type === 'error');
      sendJson(ws, {
        type: 'place_order',
        order: 'not-a-number' as any,
      });
      const err = await errPromise;
      assert.equal(err.code, 'INVALID_ORDER');
    });
  });

  describe('18.10 Completed Game Lifecycle via WebSocket', () => {
    it('completes 20 rounds, broadcasts final costs, and rejects subsequent orders', async () => {
      const sockets: WebSocket[] = [];
      const roles: Role[] = ['retailer', 'wholesaler', 'distributor', 'factory'];

      for (let i = 0; i < 4; i++) {
        const s = await connectClient(port);
        clients.push(s);
        sockets.push(s);
      }

      sendJson(sockets[0], {
        type: 'create_room',
        playerId: 'p0',
        role: roles[0],
        customCode: 'FULL20',
      });
      await waitForMessage(sockets[0]);

      for (let i = 1; i < 4; i++) {
        sendJson(sockets[i], {
          type: 'join_room',
          roomCode: 'FULL20',
          playerId: `p${i}`,
          role: roles[i],
        });
        await waitForMessage(sockets[i], (m: any) => m.type === 'room_state');
      }

      // Play rounds 1 through 19
      for (let r = 1; r <= 19; r++) {
        const nextRoundPromises = sockets.map((s) =>
          waitForMessage<RoomStateMessage>(
            s,
            (m) => m.type === 'room_state' && m.view.currentRound === r + 1,
          ),
        );

        for (let i = 0; i < 4; i++) {
          sendJson(sockets[i], { type: 'place_order', order: 4 });
        }

        await Promise.all(nextRoundPromises);
      }

      // Play round 20 to completion
      const completedPromises = sockets.map((s) =>
        waitForMessage<RoomStateMessage>(
          s,
          (m) => m.type === 'room_state' && m.view.status === 'completed',
        ),
      );

      for (let i = 0; i < 4; i++) {
        sendJson(sockets[i], { type: 'place_order', order: 4 });
      }

      const completedViews = await Promise.all(completedPromises);
      for (const cv of completedViews) {
        assert.equal(cv.view.status, 'completed');
        assert.equal(cv.view.roomStatus, 'completed');
        assert.ok(cv.view.finalCosts);
        assert.equal(cv.view.finalCosts.retailer, 394);
        assert.equal(cv.view.finalCosts.wholesaler, 120);
        assert.equal(cv.view.finalCosts.distributor, 120);
        assert.equal(cv.view.finalCosts.factory, 120);
        assert.equal(cv.view.overallTotalCost, 754);
      }

      // Verify placing order in completed game returns error
      const postErrPromise = waitForMessage<ErrorMessage>(sockets[0], (m) => m.type === 'error');
      sendJson(sockets[0], { type: 'place_order', order: 4 });
      const postErr = await postErrPromise;
      assert.equal(postErr.code, 'ROOM_ALREADY_COMPLETED');
    });
  });

});
