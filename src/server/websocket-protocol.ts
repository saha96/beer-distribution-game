import {
  DomainError,
  InvalidOrderError,
  DuplicateOrderError,
  GameCompletedError,
  InvalidRoleError,
  ROLES,
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
import type { ClientMessage, ErrorMessage } from './websocket-types.ts';

export class ProtocolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

/**
 * Validates and parses raw incoming JSON into a strongly typed ClientMessage.
 * Throws ProtocolError on malformed payloads.
 */
export function parseClientMessage(raw: unknown): ClientMessage {
  if (typeof raw !== 'string') {
    throw new ProtocolError('INVALID_MESSAGE', 'Incoming message must be a JSON string.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProtocolError('INVALID_JSON', 'Malformed JSON payload.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProtocolError('INVALID_MESSAGE', 'Message payload must be a non-null JSON object.');
  }

  const msg = parsed as Record<string, unknown>;

  if (typeof msg.type !== 'string') {
    throw new ProtocolError('INVALID_MESSAGE', 'Message must specify a "type" string.');
  }

  switch (msg.type) {
    case 'create_room': {
      if (typeof msg.playerId !== 'string' || !msg.playerId.trim()) {
        throw new ProtocolError('INVALID_MESSAGE', 'Field "playerId" must be a non-empty string.');
      }
      if (typeof msg.role !== 'string' || !ROLES.includes(msg.role as any)) {
        throw new ProtocolError(
          'INVALID_ROLE',
          `Field "role" must be one of: ${ROLES.join(', ')}.`,
        );
      }
      return {
        type: 'create_room',
        playerId: msg.playerId.trim(),
        role: msg.role as any,
        customCode: typeof msg.customCode === 'string' ? msg.customCode.trim() : undefined,
      };
    }

    case 'join_room': {
      if (typeof msg.roomCode !== 'string' || !msg.roomCode.trim()) {
        throw new ProtocolError('INVALID_MESSAGE', 'Field "roomCode" must be a non-empty string.');
      }
      if (typeof msg.playerId !== 'string' || !msg.playerId.trim()) {
        throw new ProtocolError('INVALID_MESSAGE', 'Field "playerId" must be a non-empty string.');
      }
      if (typeof msg.role !== 'string' || !ROLES.includes(msg.role as any)) {
        throw new ProtocolError(
          'INVALID_ROLE',
          `Field "role" must be one of: ${ROLES.join(', ')}.`,
        );
      }
      return {
        type: 'join_room',
        roomCode: msg.roomCode.trim().toUpperCase(),
        playerId: msg.playerId.trim(),
        role: msg.role as any,
      };
    }

    case 'place_order': {
      if (typeof msg.order !== 'number' || !Number.isFinite(msg.order)) {
        throw new ProtocolError('INVALID_ORDER', 'Field "order" must be a valid number.');
      }
      return {
        type: 'place_order',
        roomCode: typeof msg.roomCode === 'string' ? msg.roomCode.trim().toUpperCase() : undefined,
        playerId: typeof msg.playerId === 'string' ? msg.playerId.trim() : undefined,
        order: msg.order,
      };
    }

    case 'resume': {
      if (typeof msg.roomCode !== 'string' || !msg.roomCode.trim()) {
        throw new ProtocolError('INVALID_MESSAGE', 'Field "roomCode" must be a non-empty string.');
      }
      if (typeof msg.playerId !== 'string' || !msg.playerId.trim()) {
        throw new ProtocolError('INVALID_MESSAGE', 'Field "playerId" must be a non-empty string.');
      }
      return {
        type: 'resume',
        roomCode: msg.roomCode.trim().toUpperCase(),
        playerId: msg.playerId.trim(),
      };
    }

    default:
      throw new ProtocolError('UNKNOWN_MESSAGE_TYPE', `Unrecognized message type: "${String(msg.type)}".`);
  }
}

/**
 * Translates domain, application, or protocol errors into safe client-facing ErrorMessages.
 */
export function toErrorMessage(err: unknown): ErrorMessage {
  if (err instanceof ProtocolError) {
    return {
      type: 'error',
      code: err.code,
      message: err.message,
    };
  }

  if (err instanceof RoomNotFoundError) {
    return {
      type: 'error',
      code: 'ROOM_NOT_FOUND',
      message: err.message,
    };
  }

  if (err instanceof RoomAlreadyActiveError) {
    return {
      type: 'error',
      code: 'ROOM_ALREADY_ACTIVE',
      message: err.message,
    };
  }

  if (err instanceof RoomAlreadyCompletedError) {
    return {
      type: 'error',
      code: 'ROOM_ALREADY_COMPLETED',
      message: err.message,
    };
  }

  if (err instanceof RoleUnavailableError) {
    return {
      type: 'error',
      code: 'ROLE_UNAVAILABLE',
      message: err.message,
    };
  }

  if (err instanceof PlayerAlreadyInRoomError) {
    return {
      type: 'error',
      code: 'PLAYER_ALREADY_IN_ROOM',
      message: err.message,
    };
  }

  if (err instanceof PlayerNotInRoomError) {
    return {
      type: 'error',
      code: 'PLAYER_NOT_IN_ROOM',
      message: err.message,
    };
  }

  if (err instanceof GameNotActiveError) {
    return {
      type: 'error',
      code: 'GAME_NOT_ACTIVE',
      message: err.message,
    };
  }

  if (err instanceof DuplicateOrderError) {
    return {
      type: 'error',
      code: 'DUPLICATE_ORDER',
      message: err.message,
    };
  }

  if (err instanceof InvalidOrderError) {
    return {
      type: 'error',
      code: 'INVALID_ORDER',
      message: err.message,
    };
  }

  if (err instanceof GameCompletedError) {
    return {
      type: 'error',
      code: 'GAME_COMPLETED',
      message: err.message,
    };
  }

  if (err instanceof InvalidRoleError) {
    return {
      type: 'error',
      code: 'INVALID_ROLE',
      message: err.message,
    };
  }

  if (err instanceof DomainError) {
    return {
      type: 'error',
      code: 'DOMAIN_ERROR',
      message: err.message,
    };
  }

  // Generic fallback for unexpected errors to avoid leaking internals
  const fallbackMessage = err instanceof Error ? err.message : 'An unexpected server error occurred.';
  return {
    type: 'error',
    code: 'INTERNAL_ERROR',
    message: fallbackMessage,
  };
}
