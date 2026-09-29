# Architecture & Engineering Specification

## 1. Project Overview & Context

This project is a full-stack, authoritative multiplayer implementation of the classic **Beer Distribution Game**. The system models a linear four-echelon supply chain consisting of:
```text
Customer  →  Retailer  →  Wholesaler  →  Distributor  →  Factory  →  (Unlimited Supplier)
           ←            ←              ←               ←
                                Shipments
```
Four players each assume one role in the chain, placing orders upstream while shipments flow downstream with propagation delays. The objective of each player (and the supply chain as a whole) is to minimize inventory holding costs and backlog shortage penalties across 20 rounds under variable customer demand.

---

## 2. Requirements & Specification Analysis

### 2.1 Starting State (Round 0 for all roles)
* **Inventory**: `12` units
* **Backlog**: `0` units
* **Shipments in Transit**: `[4, 4]` (Queue: 4 units arriving in Round 1, 4 units arriving in Round 2)
* **Last Order Placed**: `4` units
* **Cumulative Cost**: `0.0`

### 2.2 Customer Demand Profile
* **Rounds 1–4**: `4` units per round (steady state)
* **Rounds 5–20**: `8` units per round (demand jump inducing the bullwhip effect)

### 2.3 Round Execution Lifecycle (Authoritative Server)
In each round, the server executes Steps 1–4 simultaneously for all roles, then halts and awaits Step 5:
1. **Shipments Arrive**: Role dequeues the shipment scheduled for this round and adds it to available inventory (`inventory += arrivedShipment`). Shipment delay is 2 rounds.
2. **Orders Arrive**:
   * Retailer receives external customer demand for the current round.
   * Wholesaler, Distributor, and Factory receive the order submitted by their immediate downstream neighbor in the *previous round* (1-round order delay).
3. **Ship**:
   * Demand to satisfy = `backlog + incomingOrder`.
   * Units shipped = `min(inventory, backlog + incomingOrder)`.
   * Unfulfilled balance becomes backlog: `newBacklog = (backlog + incomingOrder) - shipped`.
   * Remaining inventory: `newInventory = inventory - shipped`.
   * Downstream shipment delivery: Shipped units enter downstream neighbor's transit pipeline (arriving in Round $R + 2$).
   * Factory's supplier is unconstrained: always fulfills 100% of Factory's previous round order, arriving at Factory after 2 rounds.
4. **Calculate Costs**:
   * Holding cost: `0.5 × inventory`
   * Backlog cost: `1.0 × backlog`
   * Round cost: `(0.5 × inventory) + (1.0 × backlog)`
   * Total cost: `cumulativeCost += roundCost`
5. **Player Order Submission**:
   * Each player inputs an integer order $O \ge 0$.
   * Exactly one submission per role per round; submissions are idempotent or locked once submitted.
   * Round advances strictly when all 4 roles have submitted.
   * After Round 20, the game transitions to `COMPLETED`.

### 2.4 Information Hiding & Security
* During active gameplay (Rounds 1–20), each player **must only see**:
  * Their own metrics: inventory, backlog, current arrived shipment, current incoming order, last order placed, round cost, total cost.
  * Global metadata: current round number, game status.
  * Peer status: boolean indicator of whether peers have submitted their order for the active round (`hasSubmitted: boolean`).
* **Server-Side Enforcement**: The server MUST project/filter the state before serializing and transmitting over WebSocket. Peer internal metrics must never be broadcast over the wire during the game.
* **Game Completion**: Upon completion of Round 20, final costs and breakdowns for all four roles and total supply-chain cost are revealed.

### 2.5 Persistence & Reconnection
* SQLite database backing game rooms, participant tokens, and game state snapshots.
* Client stores a session token (e.g., in `localStorage`).
* On disconnect or browser refresh, the player presents the session token and automatically resumes their role and current state.
* Game state persists across server process restarts.

---

## 3. High-Level Architecture & Separation of Concerns

To ensure maintainability, testability, and adherence to clean architecture principles, the codebase is partitioned into distinct layers:

```text
┌─────────────────────────────────────────────────────────────┐
│                       React Client                          │
│   (Vite + React + TypeScript + Tailwind / Minimal CSS)      │
│   - Lobby Component (Create / Join / Role Select)           │
│   - Game Dashboard (Role View, Order Input, Peer Status)    │
│   - Results View (Summary, Cost Breakdown, History)         │
└──────────────────────────────▲──────────────────────────────┘
                               │ WebSocket / JSON RPC
┌──────────────────────────────▼──────────────────────────────┐
│                   Authoritative Server                      │
│   (Node.js + HTTP Server + WebSocket Server)                │
│   - Room & Session Management                               │
│   - Intent Validation (Order validation, Duplicate guard)   │
│   - State Projection (Hides peer metrics per player)        │
│   - Persistence Sync (Transactions via SQLite)              │
└──────────────────────────────▲──────────────────────────────┘
                               │ Invokes pure functions
┌──────────────────────────────▼──────────────────────────────┐
│                   Pure Domain Engine                        │
│   (src/core - Zero external dependencies, 100% portable)    │
│   - State types & initializers                              │
│   - Round transition logic (Steps 1–4)                      │
│   - Cost calculation formulas                               │
│   - Order submission & advancement transition (Step 5)      │
└──────────────────────────────▲──────────────────────────────┘
                               │ Verified by
┌──────────────────────────────┴──────────────────────────────┐
│                    Automated Test Suite                     │
│   - Golden Master verification against fixtures             │
│   - Delay and boundary edge case tests                      │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 Pure Core Engine (`src/core/`)
* **No I/O, no network, no database, no React dependencies.**
* Completely deterministic state machine.
* Functions accept immutable state and action intents, returning new state and generated events.
* Directly verified against `fixtures/everyone-orders-four.json`.
* **Shipment Queues & Delays**: In-transit shipments are modeled as a fixed 2-element tuple `[dueNextRound, dueInTwoRounds]`. In Step 1, index 0 arrives and is added to inventory. In Step 3, newly dispatched upstream shipments are enqueued into index 1.
* **Order Propagation Delay**: Downstream orders placed during Step 5 of Round $N$ arrive as the upstream neighbor's incoming order in Round $N + 1$.
* **Factory Supplier Behavior**: Modeled with unconstrained capacity, shipping 100% of the Factory's previous round order (`lastOrderPlaced`) in Step 3, arriving at the Factory after the standard 2-round shipping delay.
* **Round Transitions**: Steps 1–4 are processed automatically when entering a round; the game then awaits player orders (Step 5). When all 4 roles submit, the round advances, snapshot records are appended to `history`, and Steps 1–4 execute for the next round.


### 3.2 Server Layer (`src/server/`)
* **Architectural Boundary**:
  $$\text{Core Rules} \longleftarrow \text{Game Service} \longleftarrow \text{WebSocket / HTTP Protocol} \longleftarrow \text{Client}$$
* **Role of GameService**: Coordinates room lifecycles, player registrations, role allocations, and client intents. It delegates all game mechanics to the core engine, ensuring no business logic duplication.
* **Framework Independence of Core Engine**: Keeping `src/core/` decoupled from HTTP, WebSockets, and SQLite ensures game rules are 100% portable, deterministic, and verifiable in isolation without network mocks or database fixtures.
* **Authoritative State Ownership**: The authoritative state resides in memory in `GameRoom.gameState`. State updates are strictly immutable: `room.gameState = corePlaceOrder(room.gameState, role, order)`.
* **Server-Side State Projection**: Each player view is projected before leaving the server. Internal peer metrics (inventories, backlogs, order amounts, cost breakdowns) are omitted at the source, preventing data leakage over the network.
* **Intentional Deferral of Persistence & Networking**: Decoupling the application service from I/O infrastructure allows verifying state transitions and room orchestration independently prior to introducing socket connection lifecycles and database schemas.


### 3.3 Persistence Layer (`src/server/sqlite-room-store.ts`)
* **Persistence Boundary**:
  $$\text{GameService} \longleftarrow \text{RoomStore (interface)} \longleftarrow \text{SqliteRoomStore} \longleftarrow \text{SQLite (node:sqlite)}$$
* **Why RoomStore Remains an Abstraction**: Decoupling the service from storage enables fast, isolated unit testing using `InMemoryRoomStore` while allowing `SqliteRoomStore` to provide production persistence and restart recovery without touching application logic.
* **Why Domain State is Persisted as JSON**: Consistent with specification guidance ("storing a whole game as one JSON column is perfectly acceptable; we prefer simple over normalised"). Serializing the immutable `GameState` snapshot avoids relational mapping complexity, schema migrations, and impedance mismatches while providing atomic transactional consistency.
* **Schema Design**:
  * `rooms`: `code TEXT PRIMARY KEY`, `status TEXT`, `game_state_json TEXT`, `created_at TEXT`, `updated_at TEXT`
  * `players`: `room_code TEXT`, `player_id TEXT`, `role TEXT`, `joined_at TEXT`, `PRIMARY KEY (room_code, player_id)`
* **Data Persisted**: Room code, room status, canonical `GameState` (inventories, backlogs, in-transit shipment pipelines, cost history, pending submissions), player identifiers, assigned roles, timestamps.
* **Deliberately Not Persisted**: Transient network connections, WebSockets, HTTP request/response contexts, browser tokens, ephemeral timers.
* **Restart Recovery Mechanism**: On startup or fresh service instantiation, the service loads rooms and players from SQLite on demand via `store.get()` and `store.list()`. Games resume from their exact round and state without triggering artificial advancement, shipment processing, or cost recalculation.
* **Transactional Atomicity**: All room and player modifications execute inside an atomic SQLite transaction (`BEGIN` ... `COMMIT` / `ROLLBACK`). If a disk write fails, in-memory state is never corrupted.


### 3.4 Realtime WebSocket Transport Layer (`src/server/websocket-server.ts`)
* **Architectural Boundary**:
  $$\text{Browser Client} \longleftrightarrow \text{RealtimeServer} \longleftrightarrow \text{GameService} \longleftrightarrow \text{RoomStore} \longleftrightarrow \text{SQLite}$$
* **No Game Rules in Transport**: The WebSocket layer parses JSON envelopes, associates connections with verified identities, translates errors, and dispatches intents to `GameService`. It never evaluates shipping formulas, cost arithmetic, or turn advancement.
* **Socket-to-Player Association & Identity Protection**:
  * Upon `create_room`, `join_room`, or `resume`, the socket is bound to a `SocketSession` (`{ roomCode, playerId, role }`).
  * Submissions like `place_order` require an established session. If payload identifiers disagree with the socket's established session, the request is rejected with `IDENTITY_MISMATCH` or `ROOM_MISMATCH`. Clients cannot forge orders for other roles.
* **Individualized Projections & Broadcasting**:
  * The server NEVER broadcasts the canonical `GameState`.
  * When room state changes, `broadcastRoom(roomCode)` iterates through connected sockets for that room and queries `gameService.getPlayerView(roomCode, playerId)` for each player independently.
  * Every client receives strictly its own role's view (`room_state`); peer numbers never travel over the network during active gameplay.
* **Transient Connection Registry**:
  * Sockets are stored in an in-memory mapping (`roomCode -> playerId -> WebSocket`).
  * When a connection drops, the socket is removed from the registry without altering game state, round index, or database records.
* **Reconnection & Server Restart Recovery**:
  * Disconnected players reconnect by sending `{ type: "resume", roomCode, playerId }`.
  * The server resolves the player through `GameService` (which queries SQLite), restores the socket session, and transmits the current state snapshot immediately.
* **Message Protocol Summary**:
  * **Client Messages**: `create_room`, `join_room`, `place_order`, `resume`
  * **Server Messages**: `room_state` (individualized view), `error` (standardized machine-readable code + message)

### 3.5 Client Application (`src/client/`)
* Single-page application built with Vite and React.
* Manages WebSocket connection lifecycle with automatic reconnection and state resynchronization.
* Supports multi-tab local play (enabling one person to test all four roles across separate browser tabs).


---

## 4. Key Engineering Decisions & Tradeoffs

| Decision | Chosen Approach | Rationale & Tradeoffs |
|---|---|---|
| **SQLite Integration** | Built-in Node 24 `node:sqlite` (`DatabaseSync`) | Eliminates native C++ compilation/toolchain issues (`node-gyp`, MSVC, Python) on Windows while providing standard synchronous prepared statement performance. |
| **State Storage** | Document-style JSON column in SQLite | Recommended by specification ("storing a whole game as one JSON column is perfectly acceptable; we prefer simple over normalised"). Minimizes mapping complexity and migration friction. |
| **Realtime Transport** | Standard `ws` WebSocket library | Lightweight, standards-compliant, zero unnecessary protocol overhead compared to heavier abstraction layers. |
| **Frontend Tooling** | Vite + React + TypeScript | Fast HMR, minimal configuration, rapid build times, optimal developer experience. |
| **Testing Engine** | Node.js native test runner (`node:test`) or Vitest | Allows fast, standalone unit execution matching Node 24 standard capabilities. |

---

## 5. Development & Verification Workflow

The implementation is executed incrementally in isolated stages:
1. **Core Domain Rules & Types**: Pure TypeScript definitions and round calculation functions.
2. **Rule Verification Suite**: Automated tests validating round-by-round output against `fixtures/everyone-orders-four.json` and delay edge cases.
3. **State Management & Persistence**: SQLite repository and room state persistence.
4. **WebSocket Server & State Projection**: Realtime protocol and role-filtered message broadcasts.
5. **Lobby & Player Session Handling**: Room creation, role selection, reconnection tokens.
6. **Game UI & Client Synchronization**: Interactive dashboards for order entry and supply-chain metrics.
7. **End-to-End Multi-Tab Play**: Verification that 4 browser tabs can complete a full 20-round game.
8. **Final Polish & Documentation**: Script verification and production packaging.
