import {
  DEMAND_EARLY_ROUNDS,
  DEMAND_LATE_ROUNDS,
  DEMAND_CHANGE_ROUND,
  TOTAL_ROUNDS,
  HOLDING_COST_PER_UNIT,
  BACKLOG_COST_PER_UNIT,
  ROLES,
} from './constants.ts';
import { DomainError, InvalidOrderError, InvalidRoleError } from './errors.ts';
import type { Role } from './types.ts';

/**
 * Returns the external customer demand for a given round.
 * Rounds 1–4: 4 units
 * Rounds 5–20: 8 units
 */
export function getCustomerDemand(round: number): number {
  if (!Number.isInteger(round) || round < 1 || round > TOTAL_ROUNDS) {
    throw new DomainError(`Invalid round ${round}. Round must be an integer between 1 and ${TOTAL_ROUNDS}.`);
  }
  return round < DEMAND_CHANGE_ROUND ? DEMAND_EARLY_ROUNDS : DEMAND_LATE_ROUNDS;
}

/**
 * Validates that an order is a non-negative integer.
 */
export function validateOrder(order: unknown): number {
  if (typeof order !== 'number' || !Number.isInteger(order) || order < 0 || !Number.isFinite(order)) {
    throw new InvalidOrderError(order);
  }
  return order;
}

/**
 * Validates that a string is a valid Role.
 */
export function validateRole(role: unknown): Role {
  if (typeof role !== 'string' || !ROLES.includes(role as Role)) {
    throw new InvalidRoleError(String(role));
  }
  return role as Role;
}

export interface ShippingResult {
  shipped: number;
  newInventory: number;
  newBacklog: number;
}

/**
 * Executes the shipping calculation for a role in a round:
 * shipped = min(inventory, backlog + incomingOrder)
 * newBacklog = (backlog + incomingOrder) - shipped
 * newInventory = inventory - shipped
 */
export function calculateShipping(
  inventory: number,
  backlog: number,
  incomingOrder: number,
): ShippingResult {
  const totalDemand = backlog + incomingOrder;
  const shipped = Math.min(inventory, totalDemand);
  const newBacklog = totalDemand - shipped;
  const newInventory = inventory - shipped;
  return { shipped, newInventory, newBacklog };
}

/**
 * Calculates holding and backlog costs for a single round:
 * cost = 0.5 * inventory + 1.0 * backlog
 */
export function calculateRoundCost(inventory: number, backlog: number): number {
  return HOLDING_COST_PER_UNIT * inventory + BACKLOG_COST_PER_UNIT * backlog;
}
