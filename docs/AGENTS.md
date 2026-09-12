# Lane contract

Work in `/home/twzrd/monid-x402`. Do not edit `/home/twzrd/tool-audit`.
Do not edit wzrd-final serve trees. Do not spend USDC.

One agent per lane. If you need a file another lane owns, stop.

## CATALOG

Write: `evidence/seeds.json`, `evidence/catalog-matrix.json`, `src/classify.ts`, `src/catalog.ts`
Job: POST each seed at `x402.monid.ai/v1/run` with empty input. Record 402 / 404 / other. Never send a payment header.

## PROXY

Write: `src/proxy.ts`, `src/proxy.test.ts`
Job: local HTTP server. `POST /v1/run` uses the x402 host + policy. Discover/inspect may forward to `api.monid.ai` with the caller's key.

## LEDGER

Write: `evidence/ledger/`
Job: append-only refuse/pay JSON. No overwrites.

## VERIFY

Read only. Re-fetch a 402. Check packet fields. Output valid / not 1.

## FILM

New pages only. Never `tool-audit/pages/`.
