# coupon-quantity-yaml

**PASS** · baseline → fixed

First divergence: none

| Step | Request | Result |
|---|---|---|
| 1. create_cart | `POST /test/carts` | MATCH |
| 2. add_item | `POST /test/carts/${cart_id}/items` | MATCH |
| 3. apply_coupon | `POST /test/carts/${cart_id}/coupons` | MATCH |
| 4. change_quantity | `PATCH /test/carts/${cart_id}/items/${item_id}` | MATCH |
| 5. summary | `GET /test/carts/${cart_id}/summary` | MATCH |

Money amounts are integer CAD cents.

Fixture: `carts-basic-v1` · Clock: `2026-01-15T10:00:00.000Z`

Baseline commit: `aef63ebd83ab6ec9f43dda5762f598c2153bfdff` · Candidate commit: `aef63ebd83ab6ec9f43dda5762f598c2153bfdff`

Run: 2026-11-16T15:44:18.246Z → 2026-11-16T15:44:18.260Z

Scenario SHA-256: `e0fb4870127918e9c5917bd70dd1f1bc9a409ef5426bbb6a50e992ad3bb5f4ab`
