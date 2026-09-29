# Worked example

Every player orders **4 units every round**, so the rounds below are fully
determined by the rules. Use this to check your implementation.

The Wholesaler, Distributor and Factory each receive an order of 4 and ship
4 every round, so their inventory stays at 12 and they pay 6.0 per round,
120 in total. The Retailer runs out after the demand jump:

| Round | Shipment arrived | Incoming order | Shipped | Inventory | Backlog | Round cost | Order placed |
|---|---|---|---|---|---|---|---|
| 1 | 4 | 4 | 4 | 12 | 0 | 6.0 | 4 |
| 2 | 4 | 4 | 4 | 12 | 0 | 6.0 | 4 |
| 3 | 4 | 4 | 4 | 12 | 0 | 6.0 | 4 |
| 4 | 4 | 4 | 4 | 12 | 0 | 6.0 | 4 |
| 5 | 4 | 8 | 8 | 8 | 0 | 4.0 | 4 |
| 6 | 4 | 8 | 8 | 4 | 0 | 2.0 | 4 |
| 7 | 4 | 8 | 8 | 0 | 0 | 0.0 | 4 |
| 8 | 4 | 8 | 4 | 0 | 4 | 4.0 | 4 |
| 9 | 4 | 8 | 4 | 0 | 8 | 8.0 | 4 |
| 10 | 4 | 8 | 4 | 0 | 12 | 12.0 | 4 |
| 11 | 4 | 8 | 4 | 0 | 16 | 16.0 | 4 |
| 12 | 4 | 8 | 4 | 0 | 20 | 20.0 | 4 |
| 13 | 4 | 8 | 4 | 0 | 24 | 24.0 | 4 |
| 14 | 4 | 8 | 4 | 0 | 28 | 28.0 | 4 |
| 15 | 4 | 8 | 4 | 0 | 32 | 32.0 | 4 |
| 16 | 4 | 8 | 4 | 0 | 36 | 36.0 | 4 |
| 17 | 4 | 8 | 4 | 0 | 40 | 40.0 | 4 |
| 18 | 4 | 8 | 4 | 0 | 44 | 44.0 | 4 |
| 19 | 4 | 8 | 4 | 0 | 48 | 48.0 | 4 |
| 20 | 4 | 8 | 4 | 0 | 52 | 52.0 | 4 |

Final costs:

| Role | Cost |
|---|---|
| Retailer | 394 |
| Wholesaler | 120 |
| Distributor | 120 |
| Factory | 120 |
| **Total** | **754** |

A second check for the delays: if the Retailer orders 8 from round 5 onward
and everyone else keeps ordering 4, the Wholesaler first receives an order of
8 in round 6 and the Retailer first receives a shipment of 8 in round 8.
