import type { Role } from '../core/types.ts';
import type { ServerPlayerView } from '../server/types.ts';
import type { ClientMessage, ServerMessage, ErrorMessage } from '../server/websocket-types.ts';

export type { Role, ServerPlayerView, ClientMessage, ServerMessage, ErrorMessage };

export type AppScreenState =
  | 'connecting'
  | 'lobby'
  | 'waiting'
  | 'playing'
  | 'completed';

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting';
