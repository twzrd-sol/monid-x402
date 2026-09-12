# Lane contract

Work in a `monid-x402` worktree. Do not edit `/home/twzrd/tool-audit`.
Do not edit wzrd-final serve trees. Do not invent or commit a key.
Spend only with `--confirm-spend` after a refuse packet is on disk.

Solo build is allowed. Keep the write-scope table so two agents do not
collide. Do not claim an independent VERIFY lane unless a second process
that did not write `src/` actually graded.

## Listen

Default Path proxy is loopback **8788**. Front is loopback **8790**.

```bash
export MONID_API_BASE_URL=http://127.0.0.1:8788
```

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

Write: `evidence/ledger/`
Job: append-only refuse/pay JSON. No packet overwrites. `INDEX.json` is derived: rebuild after each append. Count USDC only on settled paid (HTTP 200 + PAYMENT-RESPONSE).

## FLEET

Write: `fleet/` only. Isolated workers. No shared key. Do not edit PROXY
while the listen is running.

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
