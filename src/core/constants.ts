import type { Role } from './types.ts';

export const ROLES: readonly Role[] = ['retailer', 'wholesaler', 'distributor', 'factory'] as const;

export const TOTAL_ROUNDS = 20;

export const INITIAL_INVENTORY = 12;
export const INITIAL_BACKLOG = 0;
export const INITIAL_SHIPMENTS_IN_TRANSIT: readonly [number, number] = [4, 4] as const;
export const INITIAL_LAST_ORDER_PLACED = 4;

export const HOLDING_COST_PER_UNIT = 0.5;
export const BACKLOG_COST_PER_UNIT = 1.0;

export const DEMAND_EARLY_ROUNDS = 4;
export const DEMAND_LATE_ROUNDS = 8;
export const DEMAND_CHANGE_ROUND = 5;
