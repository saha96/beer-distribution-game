# Take-home task: a small multiplayer supply-chain game

Thanks for applying. This task is a scaled-down version of the classic
**Beer Distribution Game**: four players, each running one stage of a supply
chain, try to keep the total cost low while demand changes under them.

We use it because it touches every layer of a full-stack app in a small
space: game rules, an authoritative server, realtime sync between browsers,
persistence, and a usable UI.

## Time and scope

- We expect the core to take an experienced developer **6–10 hours**. Please
  do not spend more than that. Leaving something out and saying so in the
  README is far better than a rushed everything.
- Please send it back within **5 days** of receiving it. If that doesn't work
  for you, tell us and we'll find a date.
- We look at, in this order: correct game rules, readable code, backend and
  realtime design, tests, the README. Visual polish comes last. Spend your
  time accordingly.

## Stack

React, TypeScript, Node.js, SQLite, and WebSockets (or another realtime
approach you can justify). Pick whatever libraries around those you are most
productive with. Vite, Express or Fastify, `ws` or socket.io, and
`better-sqlite3` are all fine.

## The game

Four roles form a chain. Orders flow up, shipments flow down:

```text
Customer  →  Retailer  →  Wholesaler  →  Distributor  →  Factory  →  (unlimited supplier)
           ←            ←              ←               ←
                         shipments
```

Each player controls one role and makes one decision per round: **how many
units to order from upstream**. Shipping is automatic. The game lasts
**20 rounds**.

### Starting state (every role)

```text
Inventory:            12
Backlog:              0
Shipments in transit: 4 units arriving next round, 4 the round after
Last order placed:    4
```

### Customer demand (what the Retailer receives)

```text
Rounds 1–4:   4 units per round
Rounds 5–20:  8 units per round
```

### One round, in order

The server runs steps 1–4 for all four roles at once, then waits for step 5.

1. **Shipments arrive.** Each role adds the shipment that was due this round
   to its inventory. Shipments take **2 rounds** to arrive.
2. **Orders arrive.** The Retailer receives the customer demand for this round.
   Every other role receives the order its downstream neighbour placed
   **last round**.
3. **Ship.** Each role ships `min(inventory, backlog + incoming order)` to its
   downstream neighbour. Whatever it could not ship is added to its backlog.
   The Retailer ships to the customer. The Factory's supplier is unlimited:
   it always ships exactly what the Factory ordered last round.
4. **Charge costs.** After shipping, each role pays
   `0.5 × inventory + 1.0 × backlog` for the round.
5. **Players order.** Each player submits an integer order (0 or more). When
   all four have submitted, the server advances to the next round. Nobody can
   submit twice in the same round, and the round cannot advance early.

After round 20 the game ends and everyone sees the cost per role and the
total.

Worked example: `EXAMPLE.md` shows all 20 rounds for the Retailer when every
player orders 4 every round, and `fixtures/everyone-orders-four.json` holds
the same run for all four roles in a form you can load straight into a test.

### What a player can see

Only their own role: inventory, backlog, the shipment and order that just
arrived, their last order, their cost so far, the round number, and whether
the others have submitted yet. **Other roles' numbers are hidden while the
game runs.** The server must enforce this, not just the UI.

## What to build

1. **Lobby.** Create a game, get a room code or link, others join and pick a
   free role. The game starts when all four roles are taken.
2. **Game screen.** The player's own numbers, an order input, and who is
   still to submit this round.
3. **Results screen.** Cost per role and the total after round 20.
4. **Authoritative server.** Clients only send intents such as
   `place order: 8`. The server validates, updates state, and pushes the
   new (per-player) view to everyone in the game.
5. **Persistence.** Games and players are stored in SQLite and survive a
   backend restart. A player who reloads the page rejoins their game and role.
   Storing a whole game as one JSON column is perfectly acceptable; we prefer
   simple over normalised.
6. **Tests** for the rules. A handful of meaningful ones beats many shallow
   ones. The rules must be testable without React, HTTP, sockets, or the
   database.

Please make sure one person can play all four roles from four tabs of one
browser. We review that way, and it is the easiest way for you to test too.

## Optional, only once the above works

- A bot that fills empty roles so a game can start with fewer humans
- A chart of inventory, backlog, or orders over time
- Animated shipments, 3D, mobile layout

Extras do not make up for wrong rules or hard-to-read code.

## Commands

Start from this repository (fork it or copy it). The root `package.json`
defines the commands we will run, currently as placeholders that fail. Keep
the script names, replace their bodies:

```sh
npm install     # one-time setup
npm run dev     # start the server and the client for local development
npm test        # run the automated tests
npm run build   # produce a production build
npm start       # run the production build
```

`npm install` and `npm run dev` must be enough to play a game locally, and
`npm test` must run the rules tests. We run everything on Node 24 (see
`.nvmrc`). pnpm or yarn are fine too; just say so in your README and keep the
same script names. If you split the code into workspaces, wire the root
scripts so the commands above still work from the root.

## What to send

A git repository (link or archive) with:

- the source
- a `README.md` covering: how to run it (the commands above, plus anything
  else we need to know), how the pieces fit together, how you keep four
  clients in sync, how game state is modelled, tradeoffs you made, and what
  you would do next with more time
- the tests, runnable with `npm test`

If you used an AI assistant, that is fine. Do tell us how, and be ready to
walk us through any part of the code.
