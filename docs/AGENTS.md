# Lane contract

Work in a `monid-x402` worktree. Do not edit `/home/twzrd/tool-audit`.
Do not edit wzrd-final serve trees. Do not invent or commit a key.
Spend only with `--confirm-spend` after a refuse packet is on disk.

Solo build is allowed. Keep the write-scope table so two agents do not
collide. Do not claim an independent VERIFY lane unless a second process
that did not write `src/` actually graded.

## Listen (week 1-2 door)

Default Path proxy is loopback **8788**. `GET /health` reports the bound
port, `prepaid_run: false`, and `twzrd_gate: "0.9.5"`. `GET /` is the
operate desk. `GET /prescreen` is the vendor-prescreen SKU. Buyer
contract: `GET /v1/product` then `POST /v1/product/run`. Confirm on
listen stays 403. CLI pay is `product --confirm-spend` after a per-seat
refuse packet. Do not invent a key. Front film is loopback **8790**.
Public week-1-2 film: https://twzrd-sol.github.io/monid-x402/week12.json

```bash
export MONID_API_BASE_URL=http://127.0.0.1:8788
npm run decision:listen
```

`decision:listen` POSTs `$MONID_API_BASE_URL/v1/run` and exits 0 only on
402 `over_cap` signer 0. It never sends a wallet or `--confirm-spend`.
See [`docs/LISTEN-DECISION.md`](LISTEN-DECISION.md).

`127.0.0.1:8787` is a stale `node dist/server.js` (pid 915170, cwd deleted)
that 302s `/` to the tool-audit GitHub Pages film. Leave it alone. Do not
point `MONID_API_BASE_URL` at 8787.

## CATALOG

Write: `evidence/seeds.json`, `evidence/catalog-matrix.json`, `src/classify.ts`, `src/catalog.ts`, `src/drift.ts`
Job: POST each seed at `x402.monid.ai/v1/run` with empty input. Record 402 / 404 / other. Never send a payment header. `catalog` writes matrix and `evidence/catalog-drift.json`. Row count is not adoption.

## PROXY

Write: `src/proxy.ts`, `src/proxy.test.ts`
Job: local HTTP server. `POST /v1/run` uses the x402 host + policy. Discover/inspect may forward to `api.monid.ai` with the caller's key. `GET /health` reports the bound port. Listen has no wallet.

## LEDGER

Write: `evidence/ledger/` (`src/ledger.ts`)
Job: append-only refuse/pay JSON (`wx`, no overwrites). Proxy `/v1/run` and
CLI `refuse` / `pay` append. `MONID_LEDGER_DIR` overrides the path.
`INDEX.json` is derived: rebuild after each append. Count USDC only on
settled paid (HTTP 200 + PAYMENT-RESPONSE).

## FLEET

Write: `fleet/` only. Isolated workers. No shared key. Do not edit PROXY
while the listen is running.

## RETRIEVE (week 3)

Write: `src/retrieve.ts`. Job: `GET https://x402.monid.ai/v1/runs/:id` with
no payment header. Live 402 has empty `accepts[]` plus SIWX. Refuse
`siwx_no_pay_offer`. Do not sign. `--confirm-spend` is rejected. Listen
`GET /v1/runs/:id` is the same refuse. `GET /v1/runs` list stays 501.

## VERIFY

Write: `evidence/verify/` plus `src/verify.ts`. Re-fetch a 402. Check
packet fields. Output valid / not 1. `node dist/cli.js verify` rewrites
`week2.json`. Same-session grade is allowed; do not label it independent.

## DOCTOR

`node dist/cli.js doctor` reads listen `/health`, derived INDEX, and
catalog drift. No spend. No catalog crawl.

## FILM

`tool-audit` already posted. Do not add another public film. Existing
`pages/` desk files may be kept honest. Never `tool-audit/pages/`.
