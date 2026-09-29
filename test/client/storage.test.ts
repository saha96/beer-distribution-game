import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPlayerId, saveSession, getStoredSession, clearSession } from '../../src/client/storage.ts';

describe('Client Storage & Session Recovery', () => {
  let mockStorage: Record<string, string> = {};
  const originalLocalStorage = (globalThis as any).localStorage;
  const originalSessionStorage = (globalThis as any).sessionStorage;

  beforeEach(() => {
    mockStorage = {};
    const storageImpl = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => {
        mockStorage[key] = String(val);
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      },
    };
    (globalThis as any).sessionStorage = storageImpl;
    (globalThis as any).localStorage = storageImpl;
  });

  after(() => {
    (globalThis as any).localStorage = originalLocalStorage;
    (globalThis as any).sessionStorage = originalSessionStorage;
  });

  it('generates a playerId if none exists and persists it across calls', () => {
    const id1 = getPlayerId();
    assert.match(id1, /^player-[a-z0-9]+$/);
    const id2 = getPlayerId();
    assert.equal(id1, id2, 'subsequent calls must return the same stored playerId');
  });

  it('saves and retrieves active room session', () => {
    saveSession('ROOM42', 'Distributor');
    const session = getStoredSession();
    assert.equal(session.roomCode, 'ROOM42');
    assert.equal(session.role, 'Distributor');
  });

  it('clears stored session on clearSession() without deleting playerId', () => {
    const id = getPlayerId();
    saveSession('ROOM42', 'Distributor');
    clearSession();

    const session = getStoredSession();
    assert.equal(session.roomCode, null);
    assert.equal(session.role, null);

    // Player ID should remain intact
    assert.equal(getPlayerId(), id);
  });
});
