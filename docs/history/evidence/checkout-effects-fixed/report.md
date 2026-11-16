# checkout-effects

**PASS** · baseline → fixed

First divergence: none

| Step | Request | Result |
|---|---|---|
| 1. cart | `POST /test/carts` | MATCH |
| 2. item | `POST /test/carts/${cart_id}/items` | MATCH |
| 3. coupon | `POST /test/carts/${cart_id}/coupons` | MATCH |
| 4. wait_for_coupon | `GET /test/carts/${cart_id}/settled` | MATCH |
| 5. checkout | `POST /test/carts/${cart_id}/checkout` | MATCH |

Money amounts are integer CAD cents.

Fixture: `carts-basic-v1` · Clock: `2026-01-15T10:00:00.000Z`

Baseline commit: `aef63ebd83ab6ec9f43dda5762f598c2153bfdff` · Candidate commit: `aef63ebd83ab6ec9f43dda5762f598c2153bfdff`

Run: 2026-11-16T15:44:18.589Z → 2026-11-16T15:44:18.618Z

Scenario SHA-256: `d57f04c74950ac2a940a85b84b28014fe1c742c21107c3d1bafc1fe6571b3b86`
