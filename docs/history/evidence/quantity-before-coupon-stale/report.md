# quantity-before-coupon

**PASS** · baseline → stale

First divergence: none

| Step | Request | Result |
|---|---|---|
| 1. create_cart | `POST /test/carts` | MATCH |
| 2. add_item | `POST /test/carts/${cart_id}/items` | MATCH |
| 3. change_quantity | `PATCH /test/carts/${cart_id}/items/${item_id}` | MATCH |
| 4. apply_coupon | `POST /test/carts/${cart_id}/coupons` | MATCH |
| 5. summary | `GET /test/carts/${cart_id}/summary` | MATCH |

Money amounts are integer CAD cents.

Fixture: `carts-basic-v1` · Clock: `2026-01-15T10:00:00.000Z`

Baseline commit: `aef63ebd83ab6ec9f43dda5762f598c2153bfdff` · Candidate commit: `aef63ebd83ab6ec9f43dda5762f598c2153bfdff`

Run: 2026-11-16T15:44:18.329Z → 2026-11-16T15:44:18.343Z

Scenario SHA-256: `c9dc132826ed3ea21566b98bdf41d493f0b6d4089b1f29ac5e96ae6c8eac4cca`
