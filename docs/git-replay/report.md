# coupon-quantity-yaml

**REGRESSION** · baseline → baseline

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

Baseline commit: `4b35c9db76d2bd20dc24635590c855924a3a57c0` · Candidate commit: `769deccc2cf05c17c6051d9866dfcfb24ace0710`

Run: 2026-11-16T15:45:54.093Z → 2026-11-16T15:45:54.205Z

Scenario SHA-256: `e0fb4870127918e9c5917bd70dd1f1bc9a409ef5426bbb6a50e992ad3bb5f4ab`
