import type { Role, RoleState, RoleRoundDetails } from './types.ts';
import { calculateShipping, calculateRoundCost, getCustomerDemand } from './rules.ts';

/**
 * Executes steps 1–4 of the round lifecycle simultaneously for all roles:
 * 1. Shipments arrive (due shipments added to inventory)
 * 2. Orders arrive (Retailer gets customer demand; others get downstream order from last round)
 * 3. Shipping occurs (min(inventory, backlog + incoming) shipped downstream; supplier fulfills factory order)
 * 4. Costs charged (0.5 * inventory + 1.0 * backlog added to cumulative cost)
 *
 * Returns updated role states awaiting step 5 (player order submissions).
 */
export function executeStepsOneToFour(
  round: number,
  roles: Record<Role, RoleState>,
): Record<Role, RoleState> {
  // Step 1: Shipments arrive (dequeue index 0)
  const retailerShipmentArrived = roles.retailer.shipmentsInTransit[0];
  const wholesalerShipmentArrived = roles.wholesaler.shipmentsInTransit[0];
  const distributorShipmentArrived = roles.distributor.shipmentsInTransit[0];
  const factoryShipmentArrived = roles.factory.shipmentsInTransit[0];

  const retailerInvAfterShipment = roles.retailer.inventory + retailerShipmentArrived;
  const wholesalerInvAfterShipment = roles.wholesaler.inventory + wholesalerShipmentArrived;
  const distributorInvAfterShipment = roles.distributor.inventory + distributorShipmentArrived;
  const factoryInvAfterShipment = roles.factory.inventory + factoryShipmentArrived;

  // Remaining shipment in transit for each role (index 1 moves to index 0)
  const retailerRemainingInTransit = roles.retailer.shipmentsInTransit[1];
  const wholesalerRemainingInTransit = roles.wholesaler.shipmentsInTransit[1];
  const distributorRemainingInTransit = roles.distributor.shipmentsInTransit[1];
  const factoryRemainingInTransit = roles.factory.shipmentsInTransit[1];

  // Step 2: Orders arrive
  const retailerIncomingOrder = getCustomerDemand(round);
  const wholesalerIncomingOrder = roles.retailer.lastOrderPlaced;
  const distributorIncomingOrder = roles.wholesaler.lastOrderPlaced;
  const factoryIncomingOrder = roles.distributor.lastOrderPlaced;

  // Step 3: Shipping calculation
  const retailerShipping = calculateShipping(
    retailerInvAfterShipment,
    roles.retailer.backlog,
    retailerIncomingOrder,
  );
  const wholesalerShipping = calculateShipping(
    wholesalerInvAfterShipment,
    roles.wholesaler.backlog,
    wholesalerIncomingOrder,
  );
  const distributorShipping = calculateShipping(
    distributorInvAfterShipment,
    roles.distributor.backlog,
    distributorIncomingOrder,
  );
  const factoryShipping = calculateShipping(
    factoryInvAfterShipment,
    roles.factory.backlog,
    factoryIncomingOrder,
  );

  // Unlimited supplier always ships 100% of Factory's last placed order
  const supplierShipped = roles.factory.lastOrderPlaced;

  // In-transit shipments updated: [arriving R+1, arriving R+2]
  const retailerTransit: [number, number] = [
    retailerRemainingInTransit,
    wholesalerShipping.shipped,
  ];
  const wholesalerTransit: [number, number] = [
    wholesalerRemainingInTransit,
    distributorShipping.shipped,
  ];
  const distributorTransit: [number, number] = [
    distributorRemainingInTransit,
    factoryShipping.shipped,
  ];
  const factoryTransit: [number, number] = [
    factoryRemainingInTransit,
    supplierShipped,
  ];

  // Step 4: Costs charged
  const retailerRoundCost = calculateRoundCost(
    retailerShipping.newInventory,
    retailerShipping.newBacklog,
  );
  const wholesalerRoundCost = calculateRoundCost(
    wholesalerShipping.newInventory,
    wholesalerShipping.newBacklog,
  );
  const distributorRoundCost = calculateRoundCost(
    distributorShipping.newInventory,
    distributorShipping.newBacklog,
  );
  const factoryRoundCost = calculateRoundCost(
    factoryShipping.newInventory,
    factoryShipping.newBacklog,
  );

  const retailerRoundDetails: RoleRoundDetails = {
    shipmentArrived: retailerShipmentArrived,
    incomingOrder: retailerIncomingOrder,
    shipped: retailerShipping.shipped,
    roundCost: retailerRoundCost,
  };

  const wholesalerRoundDetails: RoleRoundDetails = {
    shipmentArrived: wholesalerShipmentArrived,
    incomingOrder: wholesalerIncomingOrder,
    shipped: wholesalerShipping.shipped,
    roundCost: wholesalerRoundCost,
  };

  const distributorRoundDetails: RoleRoundDetails = {
    shipmentArrived: distributorShipmentArrived,
    incomingOrder: distributorIncomingOrder,
    shipped: distributorShipping.shipped,
    roundCost: distributorRoundCost,
  };

  const factoryRoundDetails: RoleRoundDetails = {
    shipmentArrived: factoryShipmentArrived,
    incomingOrder: factoryIncomingOrder,
    shipped: factoryShipping.shipped,
    roundCost: factoryRoundCost,
  };

  return {
    retailer: {
      role: 'retailer',
      inventory: retailerShipping.newInventory,
      backlog: retailerShipping.newBacklog,
      shipmentsInTransit: retailerTransit,
      lastOrderPlaced: roles.retailer.lastOrderPlaced,
      totalCost: roles.retailer.totalCost + retailerRoundCost,
      currentRoundDetails: retailerRoundDetails,
    },
    wholesaler: {
      role: 'wholesaler',
      inventory: wholesalerShipping.newInventory,
      backlog: wholesalerShipping.newBacklog,
      shipmentsInTransit: wholesalerTransit,
      lastOrderPlaced: roles.wholesaler.lastOrderPlaced,
      totalCost: roles.wholesaler.totalCost + wholesalerRoundCost,
      currentRoundDetails: wholesalerRoundDetails,
    },
    distributor: {
      role: 'distributor',
      inventory: distributorShipping.newInventory,
      backlog: distributorShipping.newBacklog,
      shipmentsInTransit: distributorTransit,
      lastOrderPlaced: roles.distributor.lastOrderPlaced,
      totalCost: roles.distributor.totalCost + distributorRoundCost,
      currentRoundDetails: distributorRoundDetails,
    },
    factory: {
      role: 'factory',
      inventory: factoryShipping.newInventory,
      backlog: factoryShipping.newBacklog,
      shipmentsInTransit: factoryTransit,
      lastOrderPlaced: roles.factory.lastOrderPlaced,
      totalCost: roles.factory.totalCost + factoryRoundCost,
      currentRoundDetails: factoryRoundDetails,
    },
  };
}
