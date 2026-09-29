export type Role = 'retailer' | 'wholesaler' | 'distributor' | 'factory';

export type GameStatus = 'in_progress' | 'completed';

export interface RoleRoundDetails {
  shipmentArrived: number;
  incomingOrder: number;
  shipped: number;
  roundCost: number;
}

export interface RoleRoundRecord extends RoleRoundDetails {
  inventory: number;
  backlog: number;
  totalCost: number;
  orderPlaced: number;
}

export interface RoundRecord {
  round: number;
  retailer: RoleRoundRecord;
  wholesaler: RoleRoundRecord;
  distributor: RoleRoundRecord;
  factory: RoleRoundRecord;
}

export interface RoleState {
  role: Role;
  inventory: number;
  backlog: number;
  shipmentsInTransit: [number, number]; // [due next round (R+1), due in two rounds (R+2)]
  lastOrderPlaced: number;
  totalCost: number;
  currentRoundDetails: RoleRoundDetails;
}

export interface GameState {
  status: GameStatus;
  currentRound: number; // 1 to 20
  roles: Record<Role, RoleState>;
  currentOrders: Partial<Record<Role, number>>;
  history: RoundRecord[];
  finalCosts?: Record<Role, number>;
  totalCost?: number;
}

export interface PlayerView {
  role: Role;
  status: GameStatus;
  currentRound: number;
  inventory: number;
  backlog: number;
  shipmentArrived: number;
  incomingOrder: number;
  lastOrderPlaced: number;
  roundCost: number;
  totalCost: number;
  hasSubmitted: boolean;
  peerSubmissions: Record<Role, boolean>;
  finalCosts?: Record<Role, number>;
  overallTotalCost?: number;
}
