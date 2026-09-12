# Lane contract

Work in a `monid-x402` worktree. Do not edit `/home/twzrd/tool-audit`.
Do not edit wzrd-final serve trees. Do not invent or commit a key.
Spend only with `--confirm-spend` after a refuse packet is on disk.

One agent per lane. If you need a file another lane owns, stop.

## Listen (week 0, f4d5bdf)

Default Path proxy is loopback **8788** only. Front is loopback **8790**.

```bash
export MONID_API_BASE_URL=http://127.0.0.1:8788
```

`127.0.0.1:8787` is a stale `node dist/server.js` (pid 915170, cwd deleted)
that 302s `/` to the tool-audit GitHub Pages film. Leave it alone. Do not
point `MONID_API_BASE_URL` at 8787.

## CATALOG

Write: `evidence/seeds.json`, `evidence/catalog-matrix.json`, `src/classify.ts`, `src/catalog.ts`
Job: POST each seed at `x402.monid.ai/v1/run` with empty input. Record 402 / 404 / other. Never send a payment header.

## PROXY

Write: `src/proxy.ts`, `src/proxy.test.ts`
Job: local HTTP server. `POST /v1/run` uses the x402 host + policy. Discover/inspect may forward to `api.monid.ai` with the caller's key.

## LEDGER

Write: `evidence/ledger/` (`src/ledger.ts`)
Job: append-only refuse/pay JSON (`wx`, no overwrites). Proxy `/v1/run` and
CLI `refuse` / `pay` append. `MONID_LEDGER_DIR` overrides the path.

## VERIFY

Read only. Re-fetch a 402. Check packet fields. Output valid / not 1.

## FLEET

Write: `fleet/` only. Isolated workers. No shared key. Do not edit PROXY
while the listen is running.

## VERIFY

Write: `evidence/verify/` only. Re-fetch a 402. Check packet fields.
Output valid / not 1. Never edit `src/`.

## FILM

Write: `pages/` in this repo only. Never `tool-audit/pages/`. Week 1-2:
`pages/week12.html` and `pages/week12.json` only unless you already own
another pages file.
