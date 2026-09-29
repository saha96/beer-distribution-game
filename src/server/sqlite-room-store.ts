import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

import type { Role, GameState } from '../core/index.ts';
import type { GameRoom, RoomPlayer, RoomStatus, RoomStore } from './types.ts';

export interface SqliteRoomStoreOptions {
  /**
   * File path to SQLite database or ':memory:'.
   * Defaults to 'data/game.sqlite'.
   */
  dbPath?: string;
  /**
   * Optional pre-existing DatabaseSync instance.
   */
  db?: DatabaseSync;
}

interface RoomRow {
  code: string;
  status: string;
  game_state_json: string;
  created_at: string;
  updated_at: string;
}

interface PlayerRow {
  room_code: string;
  player_id: string;
  role: string;
  joined_at: string;
}

/**
 * SQLite-backed implementation of RoomStore using Node.js 24's built-in `node:sqlite`.
 * Provides atomic, persistent room and player storage surviving server restarts.
 */
export class SqliteRoomStore implements RoomStore {
  private readonly db: DatabaseSync;
  private readonly isOwnedDb: boolean;

  constructor(optionsOrPath: string | SqliteRoomStoreOptions = 'data/game.sqlite') {
    let dbPath: string;
    let explicitDb: DatabaseSync | undefined;

    if (typeof optionsOrPath === 'string') {
      dbPath = optionsOrPath;
    } else {
      dbPath = optionsOrPath.dbPath ?? 'data/game.sqlite';
      explicitDb = optionsOrPath.db;
    }

    if (explicitDb) {
      this.db = explicitDb;
      this.isOwnedDb = false;
    } else {
      if (dbPath !== ':memory:') {
        const dir = path.dirname(path.resolve(dbPath));
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }
      this.db = new DatabaseSync(dbPath);
      this.isOwnedDb = true;
    }

    this.initDatabase();
  }

  private initDatabase(): void {
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        game_state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS players (
        room_code TEXT NOT NULL,
        player_id TEXT NOT NULL,
        role TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (room_code, player_id),
        FOREIGN KEY (room_code) REFERENCES rooms (code) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_players_room_code ON players (room_code);
    `);
  }

  get(code: string): GameRoom | undefined {
    const normalizedCode = code.trim().toUpperCase();
    const selectRoom = this.db.prepare(
      'SELECT code, status, game_state_json, created_at, updated_at FROM rooms WHERE code = ?',
    );
    const roomRow = selectRoom.get(normalizedCode) as RoomRow | undefined;

    if (!roomRow) {
      return undefined;
    }

    const selectPlayers = this.db.prepare(
      'SELECT player_id, role, joined_at FROM players WHERE room_code = ? ORDER BY joined_at ASC',
    );
    const playerRows = selectPlayers.all(normalizedCode) as PlayerRow[];

    const players = new Map<string, RoomPlayer>();
    const roles: Partial<Record<Role, string>> = {};

    for (const p of playerRows) {
      const role = p.role as Role;
      players.set(p.player_id, {
        id: p.player_id,
        role,
        joinedAt: new Date(p.joined_at),
      });
      roles[role] = p.player_id;
    }

    const gameState = JSON.parse(roomRow.game_state_json) as GameState;

    return {
      code: roomRow.code,
      status: roomRow.status as RoomStatus,
      createdAt: new Date(roomRow.created_at),
      players,
      roles,
      gameState,
    };
  }

  set(code: string, room: GameRoom): void {
    const normalizedCode = code.trim().toUpperCase();
    const now = new Date().toISOString();
    const createdAt =
      room.createdAt instanceof Date
        ? room.createdAt.toISOString()
        : new Date(room.createdAt).toISOString();
    const gameStateJson = JSON.stringify(room.gameState);

    this.db.exec('BEGIN');
    try {
      const upsertRoom = this.db.prepare(`
        INSERT INTO rooms (code, status, game_state_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
          status = excluded.status,
          game_state_json = excluded.game_state_json,
          updated_at = excluded.updated_at
      `);
      upsertRoom.run(normalizedCode, room.status, gameStateJson, createdAt, now);

      // Re-synchronize players
      const deletePlayers = this.db.prepare('DELETE FROM players WHERE room_code = ?');
      deletePlayers.run(normalizedCode);

      const insertPlayer = this.db.prepare(`
        INSERT INTO players (room_code, player_id, role, joined_at)
        VALUES (?, ?, ?, ?)
      `);

      for (const [playerId, player] of room.players) {
        const joinedAt =
          player.joinedAt instanceof Date
            ? player.joinedAt.toISOString()
            : new Date(player.joinedAt).toISOString();
        insertPlayer.run(normalizedCode, playerId, player.role, joinedAt);
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  has(code: string): boolean {
    const normalizedCode = code.trim().toUpperCase();
    const stmt = this.db.prepare('SELECT 1 FROM rooms WHERE code = ?');
    return stmt.get(normalizedCode) !== undefined;
  }

  delete(code: string): boolean {
    const normalizedCode = code.trim().toUpperCase();
    const stmt = this.db.prepare('DELETE FROM rooms WHERE code = ?');
    const result = stmt.run(normalizedCode) as { changes?: number };
    return typeof result?.changes === 'number' ? result.changes > 0 : true;
  }

  list(): GameRoom[] {
    const selectRooms = this.db.prepare(
      'SELECT code, status, game_state_json, created_at, updated_at FROM rooms ORDER BY created_at ASC',
    );
    const roomRows = selectRooms.all() as RoomRow[];

    if (roomRows.length === 0) {
      return [];
    }

    const selectAllPlayers = this.db.prepare(
      'SELECT room_code, player_id, role, joined_at FROM players ORDER BY joined_at ASC',
    );
    const playerRows = selectAllPlayers.all() as (PlayerRow & { room_code: string })[];

    const playersByRoom = new Map<string, PlayerRow[]>();
    for (const p of playerRows) {
      const list = playersByRoom.get(p.room_code) ?? [];
      list.push(p);
      playersByRoom.set(p.room_code, list);
    }

    return roomRows.map((row) => {
      const pRows = playersByRoom.get(row.code) ?? [];
      const players = new Map<string, RoomPlayer>();
      const roles: Partial<Record<Role, string>> = {};

      for (const p of pRows) {
        const role = p.role as Role;
        players.set(p.player_id, {
          id: p.player_id,
          role,
          joinedAt: new Date(p.joined_at),
        });
        roles[role] = p.player_id;
      }

      return {
        code: row.code,
        status: row.status as RoomStatus,
        createdAt: new Date(row.created_at),
        players,
        roles,
        gameState: JSON.parse(row.game_state_json) as GameState,
      };
    });
  }

  /**
   * Closes the database connection if this store instance owns it.
   */
  close(): void {
    if (this.isOwnedDb) {
      this.db.close();
    }
  }

  /**
   * Clears all rooms and players from the database.
   */
  clear(): void {
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM players;');
      this.db.exec('DELETE FROM rooms;');
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
