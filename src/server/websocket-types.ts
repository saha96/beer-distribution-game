import type { Role } from '../core/index.ts';
import type { ServerPlayerView } from './types.ts';

// Client to Server Message Types
export type ClientMessageType = 'create_room' | 'join_room' | 'place_order' | 'resume';

export interface CreateRoomMessage {
  type: 'create_room';
  playerId: string;
  role: Role;
  customCode?: string;
}

export interface JoinRoomMessage {
  type: 'join_room';
  roomCode: string;
  playerId: string;
  role: Role;
}

export interface PlaceOrderMessage {
  type: 'place_order';
  roomCode?: string;
  playerId?: string;
  order: number;
}

export interface ResumeMessage {
  type: 'resume';
  roomCode: string;
  playerId: string;
}

export type ClientMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | PlaceOrderMessage
  | ResumeMessage;

// Server to Client Message Types
export type ServerMessageType = 'room_state' | 'error';

export interface RoomStateMessage {
  type: 'room_state';
  view: ServerPlayerView;
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export type ServerMessage = RoomStateMessage | ErrorMessage;

export interface SocketSession {
  roomCode: string;
  playerId: string;
  role: Role;
}
