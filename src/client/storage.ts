import type { Role } from './types.ts';

const STORAGE_KEY_PLAYER_ID = 'beer_game_player_id';
const STORAGE_KEY_ROOM_CODE = 'beer_game_room_code';
const STORAGE_KEY_ROLE = 'beer_game_role';

/**
 * Accesses tab-scoped sessionStorage (or localStorage fallback in test/fallback environments).
 * Using sessionStorage ensures that 4 separate browser tabs can participate in the same
 * room with 4 distinct player identities without colliding, while still surviving page refreshes.
 */
function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).sessionStorage) {
      return (globalThis as any).sessionStorage;
    }
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage;
    }
  } catch {
    // Restricted environment
  }
  return null;
}

/**
 * In-memory fallback map if Web Storage is disabled or unavailable.
 */
const memoryStorage = new Map<string, string>();

/**
 * Retrieves the persistent player ID for this browser tab, generating and saving
 * a unique one if this is the first visit.
 */
export function getPlayerId(): string {
  const storage = getStorage();
  try {
    if (storage) {
      let id = storage.getItem(STORAGE_KEY_PLAYER_ID);
      if (!id) {
        id = 'player-' + Math.random().toString(36).slice(2, 9);
        storage.setItem(STORAGE_KEY_PLAYER_ID, id);
      }
      return id;
    }
  } catch {
    // ignore storage error
  }

  let id = memoryStorage.get(STORAGE_KEY_PLAYER_ID);
  if (!id) {
    id = 'player-' + Math.random().toString(36).slice(2, 9);
    memoryStorage.set(STORAGE_KEY_PLAYER_ID, id);
  }
  return id;
}

/**
 * Retrieves the active room and role session for this tab to support automatic reconnect/reload.
 */
export function getStoredSession(): { roomCode: string | null; role: Role | null } {
  const storage = getStorage();
  try {
    if (storage) {
      const roomCode = storage.getItem(STORAGE_KEY_ROOM_CODE);
      const role = storage.getItem(STORAGE_KEY_ROLE) as Role | null;
      return { roomCode, role };
    }
  } catch {
    // ignore
  }

  return {
    roomCode: memoryStorage.get(STORAGE_KEY_ROOM_CODE) ?? null,
    role: (memoryStorage.get(STORAGE_KEY_ROLE) as Role) ?? null,
  };
}

/**
 * Saves current room and role to tab storage to support page refresh recovery.
 */
export function saveSession(roomCode: string, role?: Role): void {
  const storage = getStorage();
  try {
    if (storage) {
      storage.setItem(STORAGE_KEY_ROOM_CODE, roomCode);
      if (role) {
        storage.setItem(STORAGE_KEY_ROLE, role);
      }
      return;
    }
  } catch {
    // ignore
  }

  memoryStorage.set(STORAGE_KEY_ROOM_CODE, roomCode);
  if (role) {
    memoryStorage.set(STORAGE_KEY_ROLE, role);
  }
}

/**
 * Clears saved session (e.g. when leaving game or on unrecoverable room errors).
 */
export function clearSession(): void {
  const storage = getStorage();
  try {
    if (storage) {
      storage.removeItem(STORAGE_KEY_ROOM_CODE);
      storage.removeItem(STORAGE_KEY_ROLE);
      return;
    }
  } catch {
    // ignore
  }

  memoryStorage.delete(STORAGE_KEY_ROOM_CODE);
  memoryStorage.delete(STORAGE_KEY_ROLE);
}
