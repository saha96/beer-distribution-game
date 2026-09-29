# Beer Distribution Game — Technical Submission & Handoff Report

This document details the complete end-to-end engineering implementation, architectural design decisions, verification results, and operational procedures for the **Beer Distribution Game** take-home project.

---

## 1. Project Overview

The Beer Distribution Game is a full-stack, authoritative multiplayer simulation of the classic MIT supply chain management game. Four players assume distinct roles along a linear supply chain—**Retailer**, **Wholesaler**, **Distributor**, and **Factory**—over a fixed horizon of **20 rounds**. 

Under shifting consumer demand, players make independent ordering decisions while managing inherent propagation delays:
- **1-round order delay**: Upstream tiers receive downstream orders in the round following placement.
- **2-round shipment delay**: Goods shipped take two rounds to physically arrive at the downstream recipient.

The primary objective for the team is to minimize cumulative supply chain costs across holding charges ($0.50/unit/round) and backlog penalties ($1.00/unit/round). The system is implemented with strict server authority, zero information leakage across players, SQLite persistence with server-restart recovery, and a clean browser interface runnable across tabs or separate machines.

---

## 2. Original Requirements

The technical challenge required delivering a test-driven application designed to run on Node.js 24 without native SQLite build dependencies, satisfying:
1. **Pure Game Engine**: A deterministic, framework-independent rules engine matching the provided specification and `fixtures/everyone-orders-four.json` with 100% mathematical fidelity.
2. **Authoritative Backend**: A server layer that manages room lifecycles, player registrations, role allocations, intent validation, and strict player view projections.
3. **Robust Persistence**: Durability across server restarts using SQLite, ensuring zero state corruption or premature round advancement upon recovery.
4. **Realtime WebSocket Protocol**: A lightweight, resilient protocol supporting room creation, joining, order submissions, turn synchronization, and session resumption across disconnects.
5. **Usable Web Frontend**: A responsive, interview-quality browser client supporting lobby management, role selection, private dashboards, and final results breakdown.
6. **Zero Dependencies on Heavy Tooling**: Running natively on Node.js 24 without external native C++ compiler dependencies.

---

## 3. Implementation Approach

Development was executed incrementally across six focused, verifiable phases:
1. **Repository Audit & Architecture Definition**: Established architectural boundaries, TypeScript configurations, `.nvmrc` (Node 24), and repository hygiene rules.
2. **Phase 1 — Pure Domain Rules (`src/core/`)**: Built and verified the deterministic state machine and step-by-step round pipeline with zero external dependencies.
3. **Phase 2 — Authoritative Game Service (`src/server/game-service.ts`)**: Built room coordination, role claiming, intent gating, and information-hiding view projections.
4. **Phase 3 — SQLite Persistence (`src/server/sqlite-room-store.ts`)**: Integrated Node 24's native `node:sqlite DatabaseSync` with atomic transaction boundaries and recovery testing.
5. **Phase 4 — Realtime WebSocket Layer (`src/server/websocket-server.ts`)**: Implemented bidirectional JSON messaging, socket identity locking, connection management, and session resumption.
6. **Phase 5 — React Frontend Client (`src/client/`)**: Developed the Vite + React 19 interface with tab-scoped session isolation (`sessionStorage`), enabling single-browser multi-tab evaluation.
7. **Phase 6 — Consistency Audit & Verification**: Aligned UI copy with backend protocol behavior and verified end-to-end execution against golden master benchmarks.

---

## 4. Architecture

The system enforces strict unidirectional dependencies following Clean Architecture principles:

```text
┌─────────────────────────────────────────────────────────────┐
│                       React Client                          │
│        (Vite + React 19 + TypeScript + Tab Storage)         │
└──────────────────────────────▲──────────────────────────────┘
                               │ WebSocket (/ws JSON Protocol)
┌──────────────────────────────▼──────────────────────────────┐
│                    RealtimeServer (ws)                      │
│   - Connection registry (roomCode -> playerId -> socket)    │
│   - Identity lock (prevents cross-client impersonation)     │
│   - Individualized per-player view projections              │
└──────────────────────────────▲──────────────────────────────┘
                               │ Dispatches validated intents
┌──────────────────────────────▼──────────────────────────────┐
│                   GameService (Application)                 │
│   - Room lifecycle management (waiting -> active -> done)   │
│   - Role allocation & player registration                   │
│   - Round turn gating & advancement trigger                 │
└───────────────▲─────────────────────────────▲───────────────┘
                │ Invokes pure logic          │ Synchronous transactions
┌───────────────▼─────────────┐ ┌─────────────▼───────────────┐
│     Pure Domain Engine      │ │      SqliteRoomStore        │
│        (`src/core/`)        │ │   (`src/server/sqlite...`)  │
│ - Zero I/O or dependencies  │ │ - Node 24 `node:sqlite`     │
│ - Two-round shipment delay  │ │ - Atomic transactions       │
│ - One-round order delay     │ │ - JSON game state snapshot  │
│ - Golden Master verified    │ │ - Instant restart recovery  │
└─────────────────────────────┘ └─────────────────────────────┘
```

### Core Rules (`src/core/`)
- Pure mathematical functions with zero runtime dependencies.
- State transitions are immutable: `(previousState, orders) => nextState`.
- Implements the MIT Beer Game formulas, delays, customer demand schedules, and cost functions.

### Game Service (`src/server/game-service.ts`)
- Manages application-level entities: `GameRoom`, `RoomPlayer`, and room lifecycles (`waiting`, `active`, `completed`).
- Acts as the single point of entry for mutating game state.
- Enforces role uniqueness, prevents duplicate orders within the same round, and projects individualized views.

### Persistence (`src/server/sqlite-room-store.ts`)
- Uses Node 24 native `node:sqlite DatabaseSync`.
- Schema contains `rooms` and `players` tables with atomic `BEGIN IMMEDIATE ... COMMIT` transactions.
- Canonical state serialized as JSON, enabling point-in-time recovery across process restarts.

### WebSocket Server (`src/server/websocket-server.ts`)
- Bidirectional event transport using `ws`.
- Sockets are identity-locked to an established `(roomCode, playerId)` session.
- Submissions are broadcast as individualized player projections (`ServerPlayerView`) rather than raw game state.

### React Client (`src/client/`)
- Built with React 19, Vite, and modular CSS.
- Tab-scoped session storage prevents cross-tab collision, allowing 4 roles to be tested in one browser window.
- Graceful connection handling with exponential backoff and automatic session resumption (`resume`).

---

## 5. Game State Model

Each role's state is encapsulated in `RoleState`:
- **`inventory`**: Current on-hand stock (initial: 12).
- **`backlog`**: Cumulative unfilled orders awaiting shipment (initial: 0).
- **`incomingOrder`**: Units demanded by the downstream tier in the current round.
- **`shipmentArrived`**: Units delivered to inventory in the current round.
- **`lastOrderPlaced`**: The order quantity submitted to the upstream supplier in the previous round (initial: 4).
- **`shipmentsInTransit`**: A two-element tuple `[dueNextRound, dueInTwoRounds]` modeling the 2-round transit pipeline (initial: `[4, 4]`).
- **`roundCost`**: Current round expenses (`0.5 × inventory + 1.0 × backlog`).
- **`totalCost`**: Cumulative expenses incurred through the current round.

Global `GameState` tracks:
- **`round`**: Current round number (1 through 20).
- **`status`**: `'active'` | `'completed'`.
- **`roles`**: Map of `Role -> RoleState`.
- **`pendingOrders`**: Map of `Role -> number` collecting current round submissions.
- **`history`**: Array of historical round snapshots for auditing and final results.

---

## 6. Game Lifecycle & Round Execution

When entering Round $N$, the engine automatically executes **Steps 1 through 4**:
1. **Receive Shipments**: Shipments due for Round $N$ arrive from the transit pipeline and are added to `inventory`.
2. **Receive Incoming Orders**:
   - Retailer receives external consumer demand: **4 units** for rounds 1–4; **8 units** for rounds 5–20.
   - Upstream roles (Wholesaler, Distributor, Factory) receive the previous round's order from their immediate downstream neighbor (1-round order delay).
3. **Fulfill Orders & Update Backlog**:
   - Total demand = `incomingOrder + backlog`.
   - Units shipped = `min(inventory, totalDemand)`.
   - Remaining unfilled demand becomes the updated `backlog`.
   - `inventory` decreases by units shipped.
   - Factory's raw material supplier is unlimited and always ships the Factory's previous order in full.
4. **Calculate Costs**:
   - Holding cost: $\$0.50 \times \text{inventory}$.
   - Backlog penalty: $\$1.00 \times \text{backlog}$.
   - Sum added to `totalCost`.

**Step 5: Place Orders**:
- The game pauses awaiting player orders.
- Each player enters an order $\ge 0$ for their upstream supplier.
- As players submit, the server broadcasts peer readiness flags (`hasSubmitted: true`) without revealing order quantities.
- When the 4th player submits, `GameService` atomically advances to Round $N+1$, dispatches shipments into the 2-round transit pipeline, executes Steps 1–4, and broadcasts the updated round state.
- Upon completing Round 20, the game transitions to `'completed'`, reveals supply chain cost totals, and locks out further orders.

---

## 7. Synchronization Strategy

State synchronization is strictly authoritative and event-driven:
1. **Intent-Based Messages**: Clients send intents (`create_room`, `join_room`, `place_order`, `resume`).
2. **Server Turn Gating**: Orders are queued in `pendingOrders`. Sockets cannot force round advancement.
3. **Atomic Advancement**: The round advances synchronously once all 4 roles submit.
4. **Individualized Projections**: Sockets receive a projected `ServerPlayerView`:
   ```typescript
   export interface ServerPlayerView {
     roomCode: string;
     role: Role;
     currentRound: number;
     status: 'active' | 'completed';
     roomStatus: 'waiting' | 'active' | 'completed';
     assignedRoles: Record<Role, boolean>;
     // Private to this player:
     inventory: number;
     backlog: number;
     incomingOrder: number;
     shipmentArrived: number;
     lastOrderPlaced: number;
     roundCost: number;
     totalCost: number;
     hasSubmitted: boolean;
     // Peer readiness only (quantities hidden):
     peerSubmissions: Record<Role, boolean>;
     // Revealed only on game completion:
     finalCosts?: Record<Role, number>;
     overallTotalCost?: number;
   }
   ```

---

## 8. Persistence Strategy

- **Database**: SQLite embedded via Node 24 `node:sqlite DatabaseSync`. Default file location: `data/game.sqlite` (or `:memory:` for automated test isolation).
- **Schema**:
  - `rooms`: `room_code` (TEXT PRIMARY KEY), `status` (TEXT), `current_round` (INTEGER), `game_state` (JSON TEXT), `created_at` (INTEGER), `updated_at` (INTEGER).
  - `players`: `room_code` (TEXT), `player_id` (TEXT), `role` (TEXT), `joined_at` (INTEGER), PRIMARY KEY (`room_code`, `player_id`).
- **Atomic Transactions**: State updates and player joins execute inside `BEGIN IMMEDIATE ... COMMIT` blocks.
- **Restart Recovery**: When the server restarts, incoming requests or reconnecting sockets reload the canonical room state from SQLite on demand. In-flight orders, inventory levels, shipment transit queues, and round numbers remain fully intact.

---

## 9. Security & Information Hiding

1. **Zero Information Leakage**: Peer inventory, backlog, order quantities, and costs are stripped at the server projection boundary before serialization over WebSockets.
2. **Socket Identity Locking**: When a socket connects and claims or resumes a role, its session is locked to `(roomCode, playerId)`. Any subsequent attempt to place an order under another player's ID or room code is rejected with `IDENTITY_MISMATCH`.
3. **Role Uniqueness & Mutability Lock**: A player cannot claim multiple roles in a single room, nor can a player switch roles mid-game.
4. **Input Validation**: Order values must be non-negative finite integers. Floats, negatives, non-numeric values, or malformed JSON payloads trigger immediate protocol errors (`INVALID_ORDER`, `INVALID_JSON`) without crashing the server.

---

## 10. Testing Strategy & Execution Results

Automated testing covers the entire stack across 6 test suites using the Node.js native test runner (`node --test`):

| Test Suite | File | Tests | Coverage Scope |
| :--- | :--- | :---: | :--- |
| **Core Domain Rules** | `test/rules.test.ts` | 19 | Initial state, customer demand schedule, 1-round order delay, 2-round shipment pipeline, backlog accumulation, partial shipments, holding/backlog cost math, order validation, and round advancement. |
| **Golden Master Verification** | `test/rules.test.ts` | 1 | 100% round-by-round reproduction of `fixtures/everyone-orders-four.json` and `EXAMPLE.md` across all 20 rounds. |
| **Authoritative Game Service** | `test/server/game-service.test.ts` | 22 | Room creation, custom room codes, collision prevention, role allocation, room activation transition, player lookups, intent gating, projection isolation, and game completion. |
| **SQLite Persistence & Recovery** | `test/server/sqlite-persistence.test.ts` | 13 | Schema initialization, multi-instance persistence, player/role recovery, waiting room recovery, completed game persistence, and mid-game server restart recovery. |
| **Realtime WebSocket Protocol** | `test/server/websocket-integration.test.ts` | 17 | Client-server roundtrips, over-the-wire payload inspection for information hiding, identity spoofing protection, disconnect/reconnect session resumption, malformed message handling, and server restart over WebSockets. |
| **Client Session Storage** | `test/client/storage.test.ts` | 3 | Tab-scoped player ID generation, session recovery, and session cleanup. |
| **Production Entry Point** | `test/server/main-server.test.ts` | 2 | Server bootstrapping, HTTP `/health` probe, SPA static file fallback routing, and graceful shutdown. |

### Execution Record (`npm test`):
```text
✔ Core Game Rules (16.0942ms)
✔ GameService (Authoritative Server Layer) (11.2889ms)
✔ Application Production Entry Point (main.ts) (51.8592ms)
✔ SQLite Persistence & Server-Restart Recovery (338.3026ms)
✔ Realtime WebSocket Server & Protocol Integration (184.8964ms)

ℹ tests 76
ℹ suites 45
ℹ pass 76
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 646.8711
```

---

## 11. Manual & Live Scenario Verification

In addition to automated unit and integration tests, real live multiplayer verification scenarios were executed against active servers on ephemeral ports:

1. **Four-Player Live Synchronization**: Four independent WebSocket clients joined a room (`SCENARIO-LIVE`), synchronized state across 20 rounds, and verified round advancement gating.
2. **Information Hiding Over the Wire**: Inspected raw incoming WebSocket frames across all 4 clients during live play; verified zero leakage of peer inventory, backlog, or order values.
3. **Identity Spoofing Attack**: Client connected as `retailer` attempted to submit an order spoofing `wholesaler`; server rejected with `IDENTITY_MISMATCH`.
4. **Duplicate Order Rejection**: Client submitted an order for Round 1, then attempted a second submission in the same round; rejected with `DUPLICATE_ORDER`.
5. **Disconnect & Reconnect**: Wholesaler disconnected mid-game, reconnected with `{ type: 'resume', roomCode, playerId }`, and resumed exact state without data loss or turn skipping.
6. **Server Restart Recovery**: At Round 8, the server process was terminated. A new server instance booted pointing to the same SQLite database file. All 4 clients reconnected and verified exact continuity across inventory, backlog, costs, and round numbers.

---

## 12. Deterministic Verification Results

### Scenario A: Golden Master (All Players Order 4)
Verified mathematically against `fixtures/everyone-orders-four.json` and `EXAMPLE.md`, both in unit tests and via a live 4-client WebSocket simulation:
- **Retailer Final Cost**: $\$394.00$
- **Wholesaler Final Cost**: $\$120.00$
- **Distributor Final Cost**: $\$120.00$
- **Factory Final Cost**: $\$120.00$
- **Total Supply Chain Cost**: $\$754.00$

### Scenario B: Realistic Mixed-Order Scenario
Verified via live 4-client simulation with varying order inputs:
- Order Matrix:
  - Round 1: R=4, W=4, D=4, F=4
  - Round 2: R=6, W=5, D=4, F=3
  - Round 3: R=2, W=7, D=5, F=9
  - Round 4: R=8, W=3, D=6, F=2
  - Round 5: R=1, W=9, D=4, F=8
  - Round 6: R=10, W=2, D=7, F=5
  - Round 7: R=3, W=12, D=2, F=10
  - Round 8: R=8, W=4, D=9, F=3
  - Rounds 9–20: R=4, W=4, D=4, F=4
- Verified Final Results:
  - **Retailer Final Cost**: $\$283.00$
  - **Wholesaler Final Cost**: $\$138.00$
  - **Distributor Final Cost**: $\$71.50$
  - **Factory Final Cost**: $\$133.00$
  - **Total Supply Chain Cost**: $\$625.50$

---

## 13. Engineering Decisions & Tradeoffs

| Decision | Implementation | Justification & Tradeoffs |
| :--- | :--- | :--- |
| **Node 24 `node:sqlite`** | Standard library `DatabaseSync` | Designed to run on Node.js 24 without native SQLite build dependencies (`node-gyp`, Python, C++ tools) while maintaining synchronous ACID transactional safety. |
| **Document State Storage** | JSON text column in SQLite | Recommended in the assignment specification. Avoids complex relational ORM mapping for nested pipeline tuples while ensuring atomic point-in-time state recovery. |
| **Standard WebSocket (`ws`)** | Raw WebSocket JSON protocol | Avoids socket.io overhead, proprietary handshakes, and client bundling bloat while giving full control over serialization, backpressure, and payload auditing. |
| **Tab-Scoped Storage** | Browser `sessionStorage` | Enables single-machine multi-tab evaluation. Origin-scoped `localStorage` would cause player identity collisions across tabs; `sessionStorage` isolates tabs while persisting through page refreshes (F5). |
| **Unified Production Server** | Single Node process | `npm start` serves the bundled SPA (`dist/client`) and handles `/ws` on port 3000, eliminating the need for a separate reverse proxy in local production testing. |

---

## 14. Limitations & Future Enhancements

The current implementation is intentionally focused to meet the 6–10 hour assignment scope without unnecessary infrastructure bloat. Relevant enhancements for a commercial deployment include:
1. **Algorithmic Bots**: AI/rule-based agents (e.g., base-stock or anchored order policies) to fill unoccupied roles when fewer than 4 human players are available.
2. **Bullwhip Visualizations**: Post-game interactive charts graphing demand order variance amplification from Retailer to Factory.
3. **Turn Timers**: Configurable countdown timers with auto-ordering for classroom or workshop settings.
4. **Authentication & User Accounts**: OAuth / JWT authentication to replace anonymous session-based player identity.
5. **Room Expiration Garbage Collection**: Automated background task pruning rooms and sessions older than 24 hours.

---

## 15. AI Assistance Disclosure

As permitted and requested by the evaluation guidelines, an AI assistant was utilized as a pair-programming partner during development for:
- Initial scaffolding of test cases against `fixtures/everyone-orders-four.json`.
- SQLite schema drafting and transaction wrappers.
- UI styling and CSS grid layout structure.

All architectural boundaries, domain rules, state invariants, information-hiding guarantees, bug fixes, and test assertions were independently designed, reviewed, and verified.

---

## 16. Final Verification Summary

| Item | Result | Verification Detail |
| :--- | :---: | :--- |
| **Package Installation (`npm install`)** | **PASSED** | 49 packages audited, 0 vulnerabilities, exit code 0. |
| **Automated Tests (`npm test`)** | **PASSED** | 76 tests passed, 0 failures, 0 skipped, ~647ms runtime. |
| **Production Build (`npm run build`)** | **PASSED** | Vite compiled client assets to `dist/client` in ~162ms. |
| **Development Startup (`npm run dev`)** | **PASSED** | Started backend on `:3000` and Vite dev server on `:5173`. |
| **Production Server (`npm start`)** | **PASSED** | Booted on `:3000`, verified `/health`, `/`, assets, and `/ws`. |
| **Multiplayer Simulations** | **PASSED** | 100% exact match on Golden Master ($754) and Mixed Scenario ($625.5). |
| **Repository Status** | **CLEAN** | Current Branch: `main`<br>Remote: GitHub repository configured (`git@github.com:saha96/beer-distribution-game.git`)<br>Working Tree: clean |
