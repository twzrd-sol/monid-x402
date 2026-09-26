# Sprint outcome B: pay did not run

Date: 2026-09-12. Branch: `cursor/monid-week0-sprint`.
Listen: `127.0.0.1:8788` on the `monid-x402` checkout at `a05ce97`.
8787 left alone.

## What moved

Listen → inspect → gated run → pay-path decision completed without a signer.

| Step | Result | Sign |
| --- | --- | --- |
| `POST /v1/run` default cap | HTTP 402 `over_cap` | 0 |
| `POST /v1/inspect` no key | HTTP 401 | 0 |
| `POST /v1/run` floor, no confirm | HTTP 403 `spend_gated` | 0 |
| `POST /v1/run` floor + `X-TWZRD-Confirm-Spend` | HTTP 403, no proxy wallet | 0 |
| `GET /v1/runs` | HTTP 501 | 0 |
| CLI `decision` | `canPay: false`, `nextGate: confirm_spend` | 0 |
| CLI `pay` | gated: no `--confirm-spend` | 0 |
| CLI `pay --confirm-spend` | gated: `PRIVATE_KEY` unset | 0 |

No body named `api.monid.ai`. `usdc_spent` stayed 0.

Code on this branch: append-only `evidence/ledger/`, `assertPayAuthorized`,
CLI `decision`, tests for confirm-still-gated. `npm test` 26 passed.

## Why pay did not run

Three independent holds. Any one is enough.

1. Operator has not documented `--confirm-spend` / `X-TWZRD-Confirm-Spend`
   for a live USDC attempt. Prior pin: no pay until said otherwise.
2. `PRIVATE_KEY` unset. No `.env`. No `monid-x402` Doppler project.
3. Week 0 listen has no proxy wallet. Confirm on 8788 still 403s.

## Single next step

Operator documents one local confirm (`--confirm-spend` plus a dedicated
EVM `PRIVATE_KEY` for this repo only). Then CLI:

```bash
# only after that written confirm
node dist/cli.js pay --confirm-spend --max-amount-micro 10000
```

Do not restart 8788 to add a wallet. Listen stays refuse-only.

Packets: `evidence/sprint-2026-09-12-pay-path.json`, `evidence/ledger/`.
