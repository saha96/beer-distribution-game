import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { bootstrap } from '../../src/server/main.ts';

describe('Application Production Entry Point (main.ts)', () => {
  it('boots server, serves HTTP health check, accepts WebSocket connections, and closes cleanly', async () => {
    const { port, close } = await bootstrap({
      port: 0,
      dbPath: ':memory:',
    });

    try {
      // 1. Verify HTTP health check
      const httpRes = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(httpRes.status, 200);
      const data = (await httpRes.json()) as { status: string };
      assert.equal(data.status, 'ok');

      // 2. Verify WebSocket connection to the same server port
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      // Send create_room message
      const responsePromise = new Promise<any>((resolve) => {
        ws.on('message', (raw) => {
          resolve(JSON.parse(raw.toString('utf-8')));
        });
      });

      ws.send(
        JSON.stringify({
          type: 'create_room',
          playerId: 'p-test-main',
          role: 'retailer',
          customCode: 'ENTRY1',
        }),
      );

      const msg = await responsePromise;
      assert.equal(msg.type, 'room_state');
      assert.equal(msg.view.roomCode, 'ENTRY1');
      assert.equal(msg.view.role, 'retailer');

      ws.close();
      await new Promise<void>((resolve) => ws.on('close', resolve));
    } finally {
      await close();
    }
  });

  it('serves SPA fallback HTML for arbitrary page routes', async () => {
    const { port, close } = await bootstrap({
      port: 0,
      dbPath: ':memory:',
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/any-app-route`);
      assert.equal(res.status, 200);
      const text = await res.text();
      // Should serve index.html (or development landing notice) containing HTML
      assert.ok(text.includes('<!DOCTYPE html>') || text.includes('<html'));
    } finally {
      await close();
    }
  });
});
