# Beer Distribution Game — Multiplayer Supply Chain Simulation

A full-stack, authoritative multiplayer implementation of the classic **Beer Distribution Game**. Four players manage the four tiers of a linear supply chain (Retailer, Wholesaler, Distributor, Factory) across 20 rounds under changing consumer demand, attempting to minimize holding costs and backlog penalties while navigating propagation delays.

---

## Quick Start & Commands

The project runs on **Node 24+** (configured in `.nvmrc`) without native C++ compilation dependencies.

```bash
# 1. Install dependencies
npm install

# 2. Run local development (starts backend server & Vite dev server with HMR)
npm run dev

# 3. Run automated tests (runs all 76 core, service, persistence, realtime, and client tests)
npm test

# 4. Produce production build
npm run build

# 5. Run the production build (serves SPA and WebSocket server on port 3000)
npm start
```

* **Development URL**: `http://localhost:5173` (Vite dev server proxies `/ws` to the backend on `127.0.0.1:3000`)
* **Production URL**: `http://localhost:3000` (Node.js HTTP server serves bundled SPA from `dist/client` and handles `/ws`)

### Multi-Tab Testing (One Browser, Four Roles)
To test the game as a single reviewer:
1. Open `http://localhost:5173` (or `http://localhost:3000` after `npm run build`).
2. Click **Create New Game**, select **Retailer**, and create the room (e.g. note the 6-character room code `ROOM42`).
3. Open 3 additional tabs in the same browser at `http://localhost:5173/?room=ROOM42` (or click **Join Existing Game** and enter the code).
4. Claim the remaining three roles: **Wholesaler**, **Distributor**, and **Factory**.
5. Once all four roles are filled, the game transitions to **Active** immediately across all tabs.
6. Submit orders across the tabs (0–20 rounds) and inspect the round advancements and final results screen!

---

## Architectural Overview & Component Structure

The repository is organized following clean architecture boundaries, with strict separation between the framework-independent domain engine, the authoritative application service, the persistence layer, the realtime WebSocket transport, and the React frontend:

```text
┌─────────────────────────────────────────────────────────────┐
│                       React Client                          │
│   (Vite + React 19 + TypeScript + Pure CSS)                 │
│   - Tab-isolated session storage (multi-tab testing)        │
│   - Automatic WebSocket reconnect with exponential backoff  │
│   - Strict role-specific view rendering                     │
└──────────────────────────────▲──────────────────────────────┘
                               │ WebSocket (/ws JSON Protocol)
┌──────────────────────────────▼──────────────────────────────┐
│                    RealtimeServer (ws)                      │
│   - Connection registry (roomCode -> playerId -> socket)    │
│   - Socket identity lock (prevents identity switching)      │
│   - Individualized per-player view projections              │
└──────────────────────────────▲──────────────────────────────┘
                               │ Dispatches validated intents
┌──────────────────────────────▼──────────────────────────────┐
│                   GameService (Application)                 │
│   - Room lifecycle (waiting -> active -> completed)         │
│   - Role assignment and player registration                 │
│   - Turn coordination & advancement trigger                 │
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

### 1. Pure Game Rules (`src/core/`)
* **Zero dependencies, 100% portable**: No Node, browser, HTTP, WebSocket, or database imports.
* **Deterministic state machine**: Functions take immutable state snapshots and return updated state:
  * `createInitialState()`: 12 inventory, 0 backlog, `[4, 4]` shipment transit pipelines, last order 4.
  * `stepShipmentsArrive()`: Dequeues arriving shipment into inventory (2-round shipping delay).
  * `stepOrdersArrive()`: Retailer receives customer demand schedule (4 for rounds 1–4, 8 for rounds 5–20); upstream neighbors receive downstream's previous round order (1-round order delay).
  * `stepShip()`: Ships `min(inventory, backlog + incomingOrder)`, accumulates unfulfilled demand into backlog, queues downstream shipment. Factory supplier is unlimited (always ships Factory's previous order).
  * `stepChargeCosts()`: Calculates `0.5 × inventory + 1.0 × backlog` and appends to cost history.
  * `placeOrder()`: Validates non-negative integer orders, prevents duplicate submissions in the same round, and advances the round strictly when all four roles submit.
  * Verified against the Golden Master fixture `fixtures/everyone-orders-four.json` with 100% mathematical precision.

### 2. Authoritative Backend Service (`src/server/game-service.ts`)
* Owns room lifecycles, player registrations, and role allocations.
* Validates all incoming intents from players.
* Enforces that a player cannot change roles or join multiple roles in the same room.
* Coordinates round progression and persists updated state to the `RoomStore`.
* Implements `getPlayerView(roomCode, playerId)` to project strictly player-visible data.

### 3. SQLite Persistence & Restart Recovery (`src/server/sqlite-room-store.ts`)
* Uses Node.js 24's built-in `node:sqlite DatabaseSync` — requires zero external native C++ build tools.
* Stores room metadata, player registrations, and canonical `GameState` serialized as JSON inside atomic transactions (`BEGIN` ... `COMMIT`).
* Survives server process restarts completely. Upon restart, active rooms, waiting rooms, completed games, and player assignments are reloaded on demand without state loss or spurious turn advancements.

### 4. Realtime WebSocket Transport (`src/server/websocket-server.ts`)
* Lightweight, bidirectional event-driven communication using `ws`.
* **Identity Protection**: Sockets are bound to an established player session upon join or resume. Submitting an order as another player or for another room is strictly rejected with `IDENTITY_MISMATCH`.
* **Zero Information Leakage**: The server never broadcasts raw `GameState`. Instead, `broadcastRoom(roomCode)` computes and dispatches an individualized `ServerPlayerView` to each connected socket independently.
* **Graceful Disconnects**: Disconnects remove transient socket references without mutating game state or dropping players. Players reconnect by sending `{ type: 'resume', roomCode, playerId }`.

### 5. React Frontend Client (`src/client/`)
* Built with Vite, React 19, and TypeScript.
* **Tab-Scoped Session Storage**: Uses `sessionStorage` for player identity and room sessions. Each browser tab receives its own persistent `playerId`, enabling one developer or reviewer to play all 4 roles across 4 tabs in a single browser window without identity collisions, while still surviving page reloads in each tab.
* **Resilient Connection**: `GameWebSocketClient` provides exponential backoff reconnection and automatically resumes the session on reconnect.
* **User Interface**:
  * **Lobby**: Create or join rooms, with role selector and URL query param pre-population (`?room=CODE`).
  * **Waiting Room**: Realtime roster showing claimed roles and waiting indicators.
  * **Game Dashboard**: Shows player's inventory, backlog, arriving shipments, incoming orders, cost metrics, order form, and peer submission readiness (whether peers have submitted, without revealing their numbers).
  * **Results Screen**: Complete breakdown of final costs per role and total supply-chain cost after Round 20.

---

## How Four Clients Are Kept in Sync

1. **State Mutation & Turn Gating**:
   * Sockets submit `{ type: 'place_order', order: N }`.
   * Server marks that role's submission for the current round.
   * If fewer than 4 roles have submitted, the server broadcasts an updated `ServerPlayerView` where `peerStatus[role].hasSubmitted` is updated to `true`. Peers see that the role has submitted without seeing the order value.
2. **Round Advancement Broadcast**:
   * As soon as the 4th order is submitted, `GameService` advances the round:
     * Dispatches shipments.
     * Advances in-transit shipment pipelines.
     * Computes shipments, backlogs, and costs for the new round.
     * Resets submission flags.
     * Persists new state snapshot to SQLite.
   * `RealtimeServer.broadcastRoom()` projects the new round view for each player and transmits it over WebSockets.
3. **Information Hiding Guarantee**:
   * The client bundle contains no domain rules, backend state models, or SQLite code.
   * Peer inventories, peer orders, and peer backlogs are not sent in the WebSocket message payload. Inspecting network traffic in browser DevTools confirms that only the player's own numbers are transmitted.

---

## Testing Strategy & Test Suites

The test suite contains **76 automated tests** executed via Node.js native test runner (`npm test`):

1. **Core Domain Rules** (`test/rules.test.ts` — 19 tests):
   * Initial state baseline.
   * Customer demand schedule (rounds 1–4 vs 5–20).
   * 2-round shipment delays and 1-round order delays.
   * Backlog accumulation, partial shipments, and holding/backlog cost formulas.
   * Order validation (rejection of negatives, floats, non-integers, duplicates).
   * Golden Master test: 100% reproduction of `fixtures/everyone-orders-four.json` and `EXAMPLE.md` across all 20 rounds.
2. **Application Game Service** (`test/server/game-service.test.ts` — 22 tests):
   * Room creation, custom codes, collision rejection.
   * Role assignment, duplicate role prevention, re-join idempotency.
   * Room activation transition (waiting -> active on 4th player).
   * Strict player view projection and information hiding.
   * 20-round game completion and post-game order rejection.
3. **SQLite Persistence & Recovery** (`test/server/sqlite-persistence.test.ts` — 13 tests):
   * Schema initialization and atomic transactions.
   * Cross-store instance persistence.
   * Mid-game server restart recovery: playing rounds 1–10, restarting server process, and playing rounds 11–20 to exact Golden Master values.
   * Waiting room and completed game persistence.
4. **Realtime WebSocket Protocol** (`test/server/websocket-integration.test.ts` — 17 tests):
   * Client-server message roundtrips (`create_room`, `join_room`, `place_order`, `resume`).
   * Over-the-wire payload inspection proving peer state is never broadcast.
   * Identity-switching attack protection.
   * Malformed message and protocol error resilience.
   * Disconnect and reconnect session resumption.
5. **Client Session Storage** (`test/client/storage.test.ts` — 3 tests):
   * Generation and tab-scoped persistence of `playerId`.
   * Active room and role session recovery across page refreshes.
   * Session clearing on room exit.
6. **Production Entry Point** (`test/server/main-server.test.ts` — 2 tests):
   * Server bootstrapping, HTTP `/health` check, WebSocket multiplexing, and clean shutdown.
   * SPA static file fallback routing.

---

## Engineering Decisions & Tradeoffs

| Decision | Chosen Approach | Rationale & Tradeoffs |
|---|---|---|
| **SQLite Driver** | Node 24 `node:sqlite DatabaseSync` | Standard built-in feature of Node 24. Requires zero external native dependencies (`node-gyp`, Python, MSVC), guaranteeing seamless cross-platform installation and instant test runs. |
| **State Persistence** | Document-style JSON column in SQLite | Recommended in the task specification. Avoids complex relational ORM mapping and schema migrations for nested shipment pipelines while providing atomic transactional ACID guarantees. |
| **Realtime Transport** | Raw `ws` WebSocket library | Lightweight and standards-based. Avoids the heavy abstraction and reconnection quirks of socket.io while providing full control over serialization and payload auditing. |
| **Multi-Tab Isolation** | Tab-scoped `sessionStorage` | In a single browser, `localStorage` is origin-scoped and shared across tabs, which would cause identity collisions when one reviewer tests all 4 roles. `sessionStorage` provides tab isolation while persisting across F5 page reloads. |
| **Development vs Production** | Vite proxy (dev) / Node static server (prod) | Vite provides instant React Fast Refresh during development. For production, `npm run build` compiles static assets to `dist/client`, and `npm start` serves both the static frontend and WebSocket endpoints from a single Node process. |

---

## What I Would Do Next With More Time

1. **Automated Bots**: Implement a simple algorithmic bot (e.g. order-up-to policy or anchored ordering) to fill unclaimed roles so a single player can play without opening multiple tabs.
2. **Post-Game Bullwhip Analytics**: Add an interactive chart on the results screen displaying the bullwhip effect (variance magnification from Retailer to Factory) across the 20 rounds.
3. **Turn Timers**: Add optional round time limits with configurable auto-submission for synchronized group workshops.
4. **Room Expiration & GC**: Add periodic cleanup for abandoned waiting rooms and completed games older than 24 hours.

---

## Notes on AI Assistant Usage

An AI assistant was utilized as a pair-programming partner during development for:
* Scaffolding test cases against the `fixtures/everyone-orders-four.json` Golden Master specification.
* Designing the SQLite schema and transaction boundaries.
* Generating boilerplate CSS styles for the game dashboard.

All architectural design decisions, domain rules, state invariants, information-hiding boundaries, and test assertions were reviewed, verified, and refined.
