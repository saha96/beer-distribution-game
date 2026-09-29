import {
  ROLES,
  TOTAL_ROUNDS,
  INITIAL_INVENTORY,
  INITIAL_BACKLOG,
  INITIAL_SHIPMENTS_IN_TRANSIT,
  INITIAL_LAST_ORDER_PLACED,
} from './constants.ts';
import {
  DomainError,
  DuplicateOrderError,
  GameCompletedError,
} from './errors.ts';
import { validateOrder, validateRole } from './rules.ts';
import { executeStepsOneToFour } from './transitions.ts';
import type {
  Role,
  RoleState,
  GameState,
  RoundRecord,
  RoleRoundRecord,
  PlayerView,
} from './types.ts';

/**
 * Creates the initial baseline state for a given role before round 1 begins.
 */
export function createInitialRoleState(role: Role): RoleState {
  return {
    role,
    inventory: INITIAL_INVENTORY,
    backlog: INITIAL_BACKLOG,
    shipmentsInTransit: [
      INITIAL_SHIPMENTS_IN_TRANSIT[0],
      INITIAL_SHIPMENTS_IN_TRANSIT[1],
    ],
    lastOrderPlaced: INITIAL_LAST_ORDER_PLACED,
    totalCost: 0,
    currentRoundDetails: {
      shipmentArrived: 0,
      incomingOrder: 0,
      shipped: 0,
      roundCost: 0,
    },
  };
}

/**
 * Initializes a new 20-round game.
 * Immediately executes steps 1–4 for round 1, leaving the game in active state
 * awaiting step 5 (player orders).
 */
export function createInitialGame(): GameState {
  const initialRoles: Record<Role, RoleState> = {
    retailer: createInitialRoleState('retailer'),
    wholesaler: createInitialRoleState('wholesaler'),
    distributor: createInitialRoleState('distributor'),
    factory: createInitialRoleState('factory'),
  };

  // Run steps 1–4 for round 1
  const roundOneRoles = executeStepsOneToFour(1, initialRoles);

  return {
    status: 'in_progress',
    currentRound: 1,
    roles: roundOneRoles,
    currentOrders: {},
    history: [],
  };
}

/**
 * Returns true if all four roles have submitted orders for the active round.
 */
export function canAdvanceRound(state: GameState): boolean {
  return ROLES.every((role) => typeof state.currentOrders[role] === 'number');
}

/**
 * Advances the game round after all four players have submitted orders.
 *
 * If the current round was 20, the game transitions to 'completed'.
 * Otherwise, advances to the next round and automatically executes steps 1–4.
 */
export function advanceRound(state: GameState): GameState {
  if (state.status === 'completed') {
    throw new GameCompletedError();
  }

  if (!canAdvanceRound(state)) {
    throw new DomainError('Cannot advance round: pending orders from some roles.');
  }

  const currentRound = state.currentRound;

  // Build the completed RoundRecord for the current round
  const createRoleRecord = (role: Role): RoleRoundRecord => {
    const roleState = state.roles[role];
    const details = roleState.currentRoundDetails;
    const orderPlaced = state.currentOrders[role]!;

    return {
      shipmentArrived: details.shipmentArrived,
      incomingOrder: details.incomingOrder,
      shipped: details.shipped,
      inventory: roleState.inventory,
      backlog: roleState.backlog,
      roundCost: details.roundCost,
      totalCost: roleState.totalCost,
      orderPlaced,
    };
  };

  const roundRecord: RoundRecord = {
    round: currentRound,
    retailer: createRoleRecord('retailer'),
    wholesaler: createRoleRecord('wholesaler'),
    distributor: createRoleRecord('distributor'),
    factory: createRoleRecord('factory'),
  };

  // Update lastOrderPlaced for each role with the order placed in step 5
  const rolesWithUpdatedLastOrder: Record<Role, RoleState> = {
    retailer: {
      ...state.roles.retailer,
      lastOrderPlaced: state.currentOrders.retailer!,
    },
    wholesaler: {
      ...state.roles.wholesaler,
      lastOrderPlaced: state.currentOrders.wholesaler!,
    },
    distributor: {
      ...state.roles.distributor,
      lastOrderPlaced: state.currentOrders.distributor!,
    },
    factory: {
      ...state.roles.factory,
      lastOrderPlaced: state.currentOrders.factory!,
    },
  };

  const updatedHistory = [...state.history, roundRecord];

  // If round 20 was completed, the game is finished
  if (currentRound >= TOTAL_ROUNDS) {
    const finalCosts: Record<Role, number> = {
      retailer: state.roles.retailer.totalCost,
      wholesaler: state.roles.wholesaler.totalCost,
      distributor: state.roles.distributor.totalCost,
      factory: state.roles.factory.totalCost,
    };
    const totalCost =
      finalCosts.retailer +
      finalCosts.wholesaler +
      finalCosts.distributor +
      finalCosts.factory;

    return {
      status: 'completed',
      currentRound: TOTAL_ROUNDS,
      roles: rolesWithUpdatedLastOrder,
      currentOrders: { ...state.currentOrders },
      history: updatedHistory,
      finalCosts,
      totalCost,
    };
  }

  // Advance to next round and execute steps 1–4
  const nextRound = currentRound + 1;
  const nextRoles = executeStepsOneToFour(nextRound, rolesWithUpdatedLastOrder);

  return {
    status: 'in_progress',
    currentRound: nextRound,
    roles: nextRoles,
    currentOrders: {},
    history: updatedHistory,
  };
}

/**
 * Places an order for a given role in the current round.
 * Validates the order, ensures no duplicate submissions, and advances the round
 * automatically if all 4 roles have submitted.
 */
export function placeOrder(
  state: GameState,
  role: Role,
  order: number,
): GameState {
  if (state.status === 'completed') {
    throw new GameCompletedError();
  }

  const validRole = validateRole(role);
  const validOrder = validateOrder(order);

  if (typeof state.currentOrders[validRole] === 'number') {
    throw new DuplicateOrderError(validRole, state.currentRound);
  }

  const updatedOrders: Partial<Record<Role, number>> = {
    ...state.currentOrders,
    [validRole]: validOrder,
  };

  const stateWithOrder: GameState = {
    ...state,
    currentOrders: updatedOrders,
  };

  // If all roles have submitted, advance automatically
  if (canAdvanceRound(stateWithOrder)) {
    return advanceRound(stateWithOrder);
  }

  return stateWithOrder;
}

/**
 * Projects the authoritative game state into a role-specific PlayerView.
 * Hides all other roles' internal metrics during gameplay.
 */
export function getPlayerView(state: GameState, role: Role): PlayerView {
  const validRole = validateRole(role);
  const roleState = state.roles[validRole];

  const peerSubmissions: Record<Role, boolean> = {
    retailer: typeof state.currentOrders.retailer === 'number',
    wholesaler: typeof state.currentOrders.wholesaler === 'number',
    distributor: typeof state.currentOrders.distributor === 'number',
    factory: typeof state.currentOrders.factory === 'number',
  };

  const view: PlayerView = {
    role: validRole,
    status: state.status,
    currentRound: state.currentRound,
    inventory: roleState.inventory,
    backlog: roleState.backlog,
    shipmentArrived: roleState.currentRoundDetails.shipmentArrived,
    incomingOrder: roleState.currentRoundDetails.incomingOrder,
    lastOrderPlaced: roleState.lastOrderPlaced,
    roundCost: roleState.currentRoundDetails.roundCost,
    totalCost: roleState.totalCost,
    hasSubmitted: typeof state.currentOrders[validRole] === 'number',
    peerSubmissions,
  };

  if (state.status === 'completed') {
    view.finalCosts = state.finalCosts;
    view.overallTotalCost = state.totalCost;
  }

  return view;
}
