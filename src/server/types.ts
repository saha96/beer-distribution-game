import type { Role, GameState, PlayerView } from '../core/index.ts';

export type RoomStatus = 'waiting' | 'active' | 'completed';

export interface RoomPlayer {
  id: string;
  role: Role;
  joinedAt: Date;
}

export interface GameRoom {
  code: string;
  status: RoomStatus;
  createdAt: Date;
  players: Map<string, RoomPlayer>; // playerId -> RoomPlayer
  roles: Partial<Record<Role, string>>; // role -> playerId
  gameState: GameState;
}

export interface ServerPlayerView extends PlayerView {
  roomCode: string;
  roomStatus: RoomStatus;
  assignedRoles: Record<Role, boolean>;
  allRolesFilled: boolean;
}

export interface RoomSummary {
  code: string;
  status: RoomStatus;
  createdAt: Date;
  occupiedRoles: Role[];
  availableRoles: Role[];
  allRolesFilled: boolean;
  currentRound: number;
}

export interface RoomStore {
  get(code: string): GameRoom | undefined;
  set(code: string, room: GameRoom): void;
  has(code: string): boolean;
  delete(code: string): boolean;
  list(): GameRoom[];
}
