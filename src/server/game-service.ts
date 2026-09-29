import {
  ROLES,
  createInitialGame,
  placeOrder as corePlaceOrder,
  getPlayerView as coreGetPlayerView,
  validateRole,
  type Role,
} from '../core/index.ts';
import {
  RoomNotFoundError,
  RoomAlreadyActiveError,
  RoomAlreadyCompletedError,
  RoleUnavailableError,
  PlayerAlreadyInRoomError,
  PlayerNotInRoomError,
  GameNotActiveError,
} from './errors.ts';
import { InMemoryRoomStore } from './room-store.ts';
import type {
  GameRoom,
  RoomPlayer,
  RoomStore,
  RoomSummary,
  ServerPlayerView,
} from './types.ts';

/**
 * Default generator for 6-character human-friendly room codes (e.g. "BEER-7A9B" or "X7K2M9").
 */
function defaultCodeGenerator(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // omit ambiguous 0/O, 1/I
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export interface GameServiceOptions {
  store?: RoomStore;
  codeGenerator?: () => string;
}

/**
 * Authoritative application service managing game rooms, players, roles, and order submissions.
 * Orchestrates the pure core domain engine without reimplementing any game rules.
 */
export class GameService {
  private readonly store: RoomStore;
  private readonly codeGenerator: () => string;

  constructor(options: GameServiceOptions = {}) {
    this.store = options.store ?? new InMemoryRoomStore();
    this.codeGenerator = options.codeGenerator ?? defaultCodeGenerator;
  }

  /**
   * Creates a new game room in 'waiting' state.
   */
  createRoom(customCode?: string): GameRoom {
    const code = customCode ? customCode.trim().toUpperCase() : this.codeGenerator();

    if (this.store.has(code)) {
      throw new Error(`Room with code "${code}" already exists.`);
    }

    const room: GameRoom = {
      code,
      status: 'waiting',
      createdAt: new Date(),
      players: new Map<string, RoomPlayer>(),
      roles: {},
      gameState: createInitialGame(),
    };

    this.store.set(code, room);
    return room;
  }

  /**
   * Retrieves a room by its code or throws RoomNotFoundError.
   */
  getRoom(roomCode: string): GameRoom {
    const room = this.store.get(roomCode.trim().toUpperCase());
    if (!room) {
      throw new RoomNotFoundError(roomCode);
    }
    return room;
  }

  /**
   * Returns a public summary of the room (e.g. for lobby listings or role selection).
   */
  getRoomSummary(roomCode: string): RoomSummary {
    const room = this.getRoom(roomCode);
    const occupiedRoles = ROLES.filter((r) => typeof room.roles[r] === 'string');
    const availableRoles = ROLES.filter((r) => typeof room.roles[r] !== 'string');
    const allRolesFilled = occupiedRoles.length === ROLES.length;

    return {
      code: room.code,
      status: room.status,
      createdAt: room.createdAt,
      occupiedRoles,
      availableRoles,
      allRolesFilled,
      currentRound: room.gameState.currentRound,
    };
  }

  /**
   * Adds a player to a room and assigns them a role.
   * When all four roles are filled, transitions the room to 'active'.
   * Re-joining with the same playerId and same role is idempotent.
   */
  joinRoom(roomCode: string, playerId: string, role: Role): ServerPlayerView {
    const room = this.getRoom(roomCode);

    if (room.status === 'completed') {
      throw new RoomAlreadyCompletedError(room.code);
    }

    const validRole = validateRole(role);

    // Check if player already in the room
    const existingPlayer = room.players.get(playerId);
    if (existingPlayer) {
      if (existingPlayer.role === validRole) {
        // Idempotent re-join
        return this.getPlayerView(room.code, playerId);
      }
      throw new PlayerAlreadyInRoomError(playerId, room.code);
    }

    if (room.status === 'active') {
      throw new RoomAlreadyActiveError(room.code);
    }

    // Check if requested role is already occupied
    if (room.roles[validRole]) {
      throw new RoleUnavailableError(validRole, room.code);
    }

    // Register player and assign role
    const player: RoomPlayer = {
      id: playerId,
      role: validRole,
      joinedAt: new Date(),
    };
    room.players.set(playerId, player);
    room.roles[validRole] = playerId;

    // Check if all four roles are now occupied
    const allFilled = ROLES.every((r) => typeof room.roles[r] === 'string');
    if (allFilled) {
      room.status = 'active';
    }

    this.store.set(room.code, room);
    return this.getPlayerView(room.code, playerId);
  }

  /**
   * Resolves player and their role within a room.
   */
  getPlayer(roomCode: string, playerId: string): { room: GameRoom; player: RoomPlayer } {
    const room = this.getRoom(roomCode);
    const player = room.players.get(playerId);
    if (!player) {
      throw new PlayerNotInRoomError(playerId, room.code);
    }
    return { room, player };
  }

  /**
   * Returns the personalized view for a player in a room.
   * Strictly hides peer metrics while exposing current round submission booleans.
   */
  getPlayerView(roomCode: string, playerId: string): ServerPlayerView {
    const { room, player } = this.getPlayer(roomCode, playerId);
    const coreView = coreGetPlayerView(room.gameState, player.role);

    const assignedRoles: Record<Role, boolean> = {
      retailer: typeof room.roles.retailer === 'string',
      wholesaler: typeof room.roles.wholesaler === 'string',
      distributor: typeof room.roles.distributor === 'string',
      factory: typeof room.roles.factory === 'string',
    };

    const allRolesFilled = ROLES.every((r) => assignedRoles[r]);

    return {
      ...coreView,
      roomCode: room.code,
      roomStatus: room.status,
      assignedRoles,
      allRolesFilled,
    };
  }

  /**
   * Accepts an order submission intent from a registered player.
   * Validates room state, resolves player role, calls the pure core engine,
   * updates authoritative state, and returns the player-specific view.
   */
  placeOrder(roomCode: string, playerId: string, order: number): ServerPlayerView {
    const { room, player } = this.getPlayer(roomCode, playerId);

    if (room.status === 'waiting') {
      throw new GameNotActiveError(room.code);
    }

    if (room.status === 'completed') {
      throw new RoomAlreadyCompletedError(room.code);
    }

    // Pure domain transition (delegated to core engine)
    const nextGameState = corePlaceOrder(room.gameState, player.role, order);

    // Replace authoritative state immutably
    room.gameState = nextGameState;

    if (nextGameState.status === 'completed') {
      room.status = 'completed';
    }

    this.store.set(room.code, room);
    return this.getPlayerView(room.code, playerId);
  }

  /**
   * Lists all existing rooms.
   */
  listRooms(): RoomSummary[] {
    return this.store.list().map((room) => this.getRoomSummary(room.code));
  }
}
