export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export class RoomNotFoundError extends AppError {
  constructor(roomCode: string) {
    super(`Room "${roomCode}" not found.`);
    this.name = 'RoomNotFoundError';
  }
}

export class RoomAlreadyActiveError extends AppError {
  constructor(roomCode: string) {
    super(`Room "${roomCode}" is already active; all roles are occupied.`);
    this.name = 'RoomAlreadyActiveError';
  }
}

export class RoomAlreadyCompletedError extends AppError {
  constructor(roomCode: string) {
    super(`Room "${roomCode}" is already completed.`);
    this.name = 'RoomAlreadyCompletedError';
  }
}

export class RoleUnavailableError extends AppError {
  constructor(role: string, roomCode: string) {
    super(`Role "${role}" is already taken in room "${roomCode}".`);
    this.name = 'RoleUnavailableError';
  }
}

export class PlayerAlreadyInRoomError extends AppError {
  constructor(playerId: string, roomCode: string) {
    super(`Player "${playerId}" is already in room "${roomCode}".`);
    this.name = 'PlayerAlreadyInRoomError';
  }
}

export class PlayerNotInRoomError extends AppError {
  constructor(playerId: string, roomCode: string) {
    super(`Player "${playerId}" is not registered in room "${roomCode}".`);
    this.name = 'PlayerNotInRoomError';
  }
}

export class GameNotActiveError extends AppError {
  constructor(roomCode: string) {
    super(`Game in room "${roomCode}" is not active. All four roles must be filled before placing orders.`);
    this.name = 'GameNotActiveError';
  }
}
