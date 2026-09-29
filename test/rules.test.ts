import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ROLES,
  TOTAL_ROUNDS,
  INITIAL_INVENTORY,
  INITIAL_BACKLOG,
  INITIAL_LAST_ORDER_PLACED,
  getCustomerDemand,
  validateOrder,
  calculateShipping,
  calculateRoundCost,
  createInitialRoleState,
  createInitialGame,
  canAdvanceRound,
  placeOrder,
  getPlayerView,
  DomainError,
  InvalidOrderError,
  DuplicateOrderError,
  GameCompletedError,
  InvalidRoleError,
} from '../src/core/index.ts';
import type { Role, GameState } from '../src/core/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Core Game Rules', () => {
  describe('1. Initial State', () => {
    it('initializes role state with exact specification baseline', () => {
      for (const role of ROLES) {
        const state = createInitialRoleState(role);
        assert.equal(state.role, role);
        assert.equal(state.inventory, 12);
        assert.equal(state.backlog, 0);
        assert.deepEqual(state.shipmentsInTransit, [4, 4]);
        assert.equal(state.lastOrderPlaced, 4);
        assert.equal(state.totalCost, 0);
      }
    });

    it('creates game starting at round 1 with steps 1-4 pre-executed', () => {
      const game = createInitialGame();
      assert.equal(game.status, 'in_progress');
      assert.equal(game.currentRound, 1);
      assert.equal(game.history.length, 0);
      assert.deepEqual(game.currentOrders, {});

      // In round 1: 4 arrives, 4 ordered/shipped -> inventory remains 12, cost is 6.0
      for (const role of ROLES) {
        const roleState = game.roles[role];
        assert.equal(roleState.inventory, 12);
        assert.equal(roleState.backlog, 0);
        assert.equal(roleState.totalCost, 6);
        assert.equal(roleState.currentRoundDetails.shipmentArrived, 4);
        assert.equal(roleState.currentRoundDetails.incomingOrder, 4);
        assert.equal(roleState.currentRoundDetails.shipped, 4);
        assert.equal(roleState.currentRoundDetails.roundCost, 6);
      }
    });
  });

  describe('2. Customer Demand Schedule', () => {
    it('returns 4 units for rounds 1 through 4', () => {
      assert.equal(getCustomerDemand(1), 4);
      assert.equal(getCustomerDemand(2), 4);
      assert.equal(getCustomerDemand(3), 4);
      assert.equal(getCustomerDemand(4), 4);
    });

    it('returns 8 units for rounds 5 through 20', () => {
      assert.equal(getCustomerDemand(5), 8);
      assert.equal(getCustomerDemand(10), 8);
      assert.equal(getCustomerDemand(15), 8);
      assert.equal(getCustomerDemand(20), 8);
    });

    it('throws DomainError on invalid round numbers', () => {
      assert.throws(() => getCustomerDemand(0), DomainError);
      assert.throws(() => getCustomerDemand(21), DomainError);
      assert.throws(() => getCustomerDemand(-5), DomainError);
      assert.throws(() => getCustomerDemand(3.5), DomainError);
    });
  });

  describe('3. Shipment Timing (Two-Round Delay)', () => {
    it('delivers shipments exactly 2 rounds after upstream dispatch', () => {
      let game = createInitialGame();

      // In Round 1 to 4: all order 4
      for (let r = 1; r <= 4; r++) {
        for (const role of ROLES) {
          game = placeOrder(game, role, 4);
        }
      }

      // In Round 5: Retailer orders 8, others order 4
      game = placeOrder(game, 'retailer', 8);
      game = placeOrder(game, 'wholesaler', 4);
      game = placeOrder(game, 'distributor', 4);
      game = placeOrder(game, 'factory', 4);
      assert.equal(game.currentRound, 6);

      // In Round 6: Wholesaler receives order of 8, ships 8
      assert.equal(game.roles.wholesaler.currentRoundDetails.incomingOrder, 8);
      assert.equal(game.roles.wholesaler.currentRoundDetails.shipped, 8);
      // Wholesaler shipped 8 in Round 6 -> this shipment enters Retailer's pipeline:
      // Retailer shipmentsInTransit is [arriving in R7, arriving in R8] = [4, 8]
      assert.deepEqual(game.roles.retailer.shipmentsInTransit, [4, 8]);

      // Round 6 orders placed
      for (const role of ROLES) {
        game = placeOrder(game, role, 4);
      }
      assert.equal(game.currentRound, 7);

      // In Round 7: Retailer receives shipment of 4 (the first queued shipment)
      assert.equal(game.roles.retailer.currentRoundDetails.shipmentArrived, 4);

      // Round 7 orders placed
      for (const role of ROLES) {
        game = placeOrder(game, role, 4);
      }
      assert.equal(game.currentRound, 8);

      // In Round 8: Retailer receives shipment of 8 (dispatched in Round 6)
      assert.equal(game.roles.retailer.currentRoundDetails.shipmentArrived, 8);
    });
  });

  describe('4. Order Timing (One-Round Delay)', () => {
    it('passes downstream order placed in round N to upstream in round N+1', () => {
      let game = createInitialGame();

      // In Round 1: Retailer orders 7, Wholesaler orders 5, Distributor orders 9, Factory orders 3
      game = placeOrder(game, 'retailer', 7);
      game = placeOrder(game, 'wholesaler', 5);
      game = placeOrder(game, 'distributor', 9);
      game = placeOrder(game, 'factory', 3);

      assert.equal(game.currentRound, 2);

      // In Round 2:
      // Retailer receives customer demand: 4
      assert.equal(game.roles.retailer.currentRoundDetails.incomingOrder, 4);
      // Wholesaler receives Retailer's round 1 order: 7
      assert.equal(game.roles.wholesaler.currentRoundDetails.incomingOrder, 7);
      // Distributor receives Wholesaler's round 1 order: 5
      assert.equal(game.roles.distributor.currentRoundDetails.incomingOrder, 5);
      // Factory receives Distributor's round 1 order: 9
      assert.equal(game.roles.factory.currentRoundDetails.incomingOrder, 9);
    });
  });

  describe('5. Shipping Calculations', () => {
    it('ships full amount when inventory is sufficient', () => {
      const res = calculateShipping(16, 0, 4);
      assert.equal(res.shipped, 4);
      assert.equal(res.newInventory, 12);
      assert.equal(res.newBacklog, 0);
    });

    it('ships partial amount when inventory is insufficient', () => {
      const res = calculateShipping(4, 0, 8);
      assert.equal(res.shipped, 4);
      assert.equal(res.newInventory, 0);
      assert.equal(res.newBacklog, 4);
    });

    it('ships zero when inventory is 0 and accumulates full backlog', () => {
      const res = calculateShipping(0, 0, 8);
      assert.equal(res.shipped, 0);
      assert.equal(res.newInventory, 0);
      assert.equal(res.newBacklog, 8);
    });

    it('satisfies existing backlog plus incoming order when inventory allows', () => {
      const res = calculateShipping(20, 6, 8);
      assert.equal(res.shipped, 14);
      assert.equal(res.newInventory, 6);
      assert.equal(res.newBacklog, 0);
    });

    it('partially satisfies existing backlog when inventory is limited', () => {
      const res = calculateShipping(5, 4, 4); // total demand = 8
      assert.equal(res.shipped, 5);
      assert.equal(res.newInventory, 0);
      assert.equal(res.newBacklog, 3);
    });
  });

  describe('6. Cost Calculation', () => {
    it('charges 0.5 per inventory unit when backlog is 0', () => {
      assert.equal(calculateRoundCost(12, 0), 6.0);
      assert.equal(calculateRoundCost(8, 0), 4.0);
      assert.equal(calculateRoundCost(0, 0), 0.0);
    });

    it('charges 1.0 per backlog unit when inventory is 0', () => {
      assert.equal(calculateRoundCost(0, 4), 4.0);
      assert.equal(calculateRoundCost(0, 52), 52.0);
    });

    it('combines holding and backlog costs if both were non-zero', () => {
      assert.equal(calculateRoundCost(10, 5), 5.0 + 5.0);
    });
  });

  describe('7. Order Validation & Duplicate Protection', () => {
    it('accepts valid non-negative integer orders including 0', () => {
      assert.equal(validateOrder(0), 0);
      assert.equal(validateOrder(4), 4);
      assert.equal(validateOrder(100), 100);
    });

    it('rejects negative numbers, floats, NaN, non-numbers', () => {
      assert.throws(() => validateOrder(-1), InvalidOrderError);
      assert.throws(() => validateOrder(3.14), InvalidOrderError);
      assert.throws(() => validateOrder(NaN), InvalidOrderError);
      assert.throws(() => validateOrder(Infinity), InvalidOrderError);
      assert.throws(() => validateOrder('4'), InvalidOrderError);
      assert.throws(() => validateOrder(null), InvalidOrderError);
      assert.throws(() => validateOrder(undefined), InvalidOrderError);
    });

    it('rejects duplicate orders from the same role in the same round', () => {
      let game = createInitialGame();
      game = placeOrder(game, 'retailer', 4);

      assert.throws(() => placeOrder(game, 'retailer', 4), DuplicateOrderError);
      assert.throws(() => placeOrder(game, 'retailer', 6), DuplicateOrderError);
    });
  });

  describe('8. Round Advancement', () => {
    it('does not advance round until all four roles submit', () => {
      let game = createInitialGame();
      assert.equal(game.currentRound, 1);
      assert.equal(canAdvanceRound(game), false);

      game = placeOrder(game, 'retailer', 4);
      assert.equal(game.currentRound, 1);
      assert.equal(canAdvanceRound(game), false);

      game = placeOrder(game, 'wholesaler', 4);
      assert.equal(game.currentRound, 1);
      assert.equal(canAdvanceRound(game), false);

      game = placeOrder(game, 'distributor', 4);
      assert.equal(game.currentRound, 1);
      assert.equal(canAdvanceRound(game), false);

      // 4th submission advances round
      game = placeOrder(game, 'factory', 4);
      assert.equal(game.currentRound, 2);
      assert.equal(game.history.length, 1);
      assert.deepEqual(game.currentOrders, {});
    });
  });

  describe('9. Game Completion & Rejection of Subsequent Orders', () => {
    it('transitions to completed after round 20 and freezes costs', () => {
      let game = createInitialGame();

      for (let r = 1; r <= 20; r++) {
        assert.equal(game.status, 'in_progress');
        assert.equal(game.currentRound, r);
        for (const role of ROLES) {
          game = placeOrder(game, role, 4);
        }
      }

      assert.equal(game.status, 'completed');
      assert.equal(game.currentRound, 20);
      assert.equal(game.history.length, 20);
      assert.ok(game.finalCosts);
      assert.equal(typeof game.totalCost, 'number');

      // Attempting further orders throws GameCompletedError
      assert.throws(() => placeOrder(game, 'retailer', 4), GameCompletedError);
      assert.throws(() => placeOrder(game, 'factory', 0), GameCompletedError);
    });
  });

  describe('10. Strict Information Hiding (PlayerView)', () => {
    it('projects only the player role metrics and hides peer metrics during game', () => {
      let game = createInitialGame();
      game = placeOrder(game, 'retailer', 4);

      const retailerRole = 'retailer';
      const wholesalerRole = 'wholesaler';

      const view = getPlayerView(game, retailerRole);
      assert.equal(view.role, 'retailer');
      assert.equal(view.currentRound, 1);
      assert.equal(view.inventory, 12);
      assert.equal(view.backlog, 0);
      assert.equal(view.shipmentArrived, 4);
      assert.equal(view.incomingOrder, 4);
      assert.equal(view.lastOrderPlaced, 4);
      assert.equal(view.roundCost, 6);
      assert.equal(view.totalCost, 6);
      assert.equal(view.hasSubmitted, true);
      assert.deepEqual(view.peerSubmissions, {
        retailer: true,
        wholesaler: false,
        distributor: false,
        factory: false,
      });

      // Assert peer data is absent
      assert.equal((view as any).roles, undefined);
      assert.equal((view as any).history, undefined);
      assert.equal(view.finalCosts, undefined);

      const wholesalerView = getPlayerView(game, wholesalerRole);
      assert.equal(wholesalerView.hasSubmitted, false);
      assert.equal(wholesalerView.peerSubmissions.retailer, true);
      assert.equal(wholesalerView.peerSubmissions.wholesaler, false);
    });

    it('reveals final costs on completion', () => {
      let game = createInitialGame();
      for (let r = 1; r <= 20; r++) {
        for (const role of ROLES) {
          game = placeOrder(game, role, 4);
        }
      }
      assert.equal(game.status, 'completed');

      const view = getPlayerView(game, 'retailer');
      assert.ok(view.finalCosts);
      assert.equal(view.finalCosts.retailer, 394);
      assert.equal(view.finalCosts.wholesaler, 120);
      assert.equal(view.finalCosts.distributor, 120);
      assert.equal(view.finalCosts.factory, 120);
      assert.equal(view.overallTotalCost, 754);
    });
  });

  describe('11. Golden Master: everyone-orders-four.json & EXAMPLE.md', () => {
    it('reproduces round-by-round fixture state and final costs with 100% precision', () => {
      const fixturePath = path.resolve(__dirname, '../fixtures/everyone-orders-four.json');
      const fixtureRaw = fs.readFileSync(fixturePath, 'utf-8');
      const fixture = JSON.parse(fixtureRaw);

      let game = createInitialGame();

      for (let r = 1; r <= TOTAL_ROUNDS; r++) {
        const expectedRound = fixture.rounds.find((item: any) => item.round === r);
        assert.ok(expectedRound, `Fixture round ${r} must exist`);

        // Check pre-order state (after steps 1–4) for each role
        for (const role of ROLES) {
          const expectedRole = expectedRound[role];
          const actualRoleState = game.roles[role];
          const details = actualRoleState.currentRoundDetails;

          assert.equal(
            details.shipmentArrived,
            expectedRole.shipmentArrived,
            `Round ${r} ${role} shipmentArrived`,
          );
          assert.equal(
            details.incomingOrder,
            expectedRole.incomingOrder,
            `Round ${r} ${role} incomingOrder`,
          );
          assert.equal(
            details.shipped,
            expectedRole.shipped,
            `Round ${r} ${role} shipped`,
          );
          assert.equal(
            actualRoleState.inventory,
            expectedRole.inventory,
            `Round ${r} ${role} inventory`,
          );
          assert.equal(
            actualRoleState.backlog,
            expectedRole.backlog,
            `Round ${r} ${role} backlog`,
          );
          assert.equal(
            details.roundCost,
            expectedRole.roundCost,
            `Round ${r} ${role} roundCost`,
          );
          assert.equal(
            actualRoleState.totalCost,
            expectedRole.totalCost,
            `Round ${r} ${role} totalCost`,
          );
        }

        // Each role places order 4 (matching expected orderPlaced in fixture)
        for (const role of ROLES) {
          game = placeOrder(game, role, 4);
        }
      }

      // Check game completed
      assert.equal(game.status, 'completed');
      assert.equal(game.currentRound, 20);

      // Check final history length
      assert.equal(game.history.length, 20);

      // Verify each round in history matches fixture exactly
      for (let i = 0; i < 20; i++) {
        const expected = fixture.rounds[i];
        const actual = game.history[i];

        assert.equal(actual.round, expected.round);
        for (const role of ROLES) {
          assert.deepEqual(
            actual[role],
            expected[role],
            `History round ${actual.round} ${role} record mismatch`,
          );
        }
      }

      // Verify final costs match fixture and EXAMPLE.md
      assert.deepEqual(game.finalCosts, fixture.finalCosts);
      assert.equal(game.totalCost, fixture.totalCost);

      assert.equal(game.finalCosts?.retailer, 394);
      assert.equal(game.finalCosts?.wholesaler, 120);
      assert.equal(game.finalCosts?.distributor, 120);
      assert.equal(game.finalCosts?.factory, 120);
      assert.equal(game.totalCost, 754);
    });
  });
});
