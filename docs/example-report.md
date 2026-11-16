# coupon-quantity

**REGRESSION** · baseline → stale

First divergence: summary

| Step | Request | Result |
|---|---|---|
| 1. create_cart | `POST /test/carts` | MATCH |
| 2. add_item | `POST /test/carts/${cart_id}/items` | MATCH |
| 3. apply_coupon | `POST /test/carts/${cart_id}/coupons` | MATCH |
| 4. change_quantity | `PATCH /test/carts/${cart_id}/items/${item_id}` | MATCH |
| 5. summary | `GET /test/carts/${cart_id}/summary` | DIFF |

## summary

| Path | Reference | Candidate | Check |
|---|---:|---:|---|
| `$.discount` | `2000` | `1000` | value |
| `$.total` | `18000` | `19000` | value |

Money amounts are integer CAD cents.

Fixture: `carts-basic-v1` · Clock: `2026-01-15T10:00:00.000Z`

Scenario SHA-256: `24cf28030ba023dc2efa581e0e5e1fee4e9e866245f7782321d339fae74f9c2f`
