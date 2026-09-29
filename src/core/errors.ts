export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export class InvalidOrderError extends DomainError {
  constructor(order: unknown) {
    super(`Invalid order: "${String(order)}". Order must be a finite, non-negative integer (0 or greater).`);
    this.name = 'InvalidOrderError';
  }
}

export class DuplicateOrderError extends DomainError {
  constructor(role: string, round: number) {
    super(`Role "${role}" has already submitted an order for round ${round}.`);
    this.name = 'DuplicateOrderError';
  }
}

export class GameCompletedError extends DomainError {
  constructor() {
    super('The game is already completed. No additional orders can be placed.');
    this.name = 'GameCompletedError';
  }
}

export class InvalidRoleError extends DomainError {
  constructor(role: string) {
    super(`Invalid role "${role}". Valid roles are: retailer, wholesaler, distributor, factory.`);
    this.name = 'InvalidRoleError';
  }
}
