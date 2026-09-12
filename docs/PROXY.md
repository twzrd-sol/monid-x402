# Proxy contract (week 0 + week 1 health)

Authority for the Default Path listen. Derived 2026-09-12 from live Monid
docs plus `src/proxy.ts`. `tool-audit` is off limits.

## Hard rules

- `POST /v1/run` never calls `https://api.monid.ai/v1/run`.
- `POST /v1/run` probes `https://x402.monid.ai/v1/run`, then policy.
- Refuse body is bare `twzrd.gate_eval_refuse.v1`. Do not echo upstream
 `PAYMENT-REQUIRED`.
- Discover/inspect may forward to `api.monid.ai` with inbound
 `Authorization` (+ `x-workspace-id` if present).
- Pay only after `X-TWZRD-Confirm-Spend: true` and a proxy wallet. Week 0
 and week 1: no wallet.

## Status map

| Code | HTTP | When |
|---|---|---|
| `GET /health` | 200 | Week 1 local listen probe; no upstream fetch |
| `over_cap` / `no_acceptable_offer` / `version_mismatch` / `resource_mismatch` | 402 | Policy refuse |
| `spend_gated` | 403 | Policy allow, no confirm header, or confirm with no proxy wallet |
| discover/inspect | upstream | Pass-through |
| `GET /v1/runs*` | 501 | Week 0; do not forward prepaid |

## Week 1: `GET /health`

Local JSON only. Does not call `api.monid.ai` or `x402.monid.ai`. Distinguishes
the Default Path listen (`8788`) from the stale `:8787` film.

```json
{ "ok": true, "rail": "monid-x402", "listen": "8788", "prepaid_run": false }
```

`prepaid_run: false` means this listen will not forward prepaid
`api.monid.ai/v1/run`. It is not a paid receipt and not a wallet.

## Week-0 gaps vs current `proxy.ts`

Closed 2026-09-12: discover/inspect forward, inspect 401, `spend_gated` 403,
`assertNotPrepaid` on outbound fetch, headers on `handleProxyRequest`.

Closed week 1: `GET /health` 200 JSON, no fetch.

Closed 2026-09-12 sprint: append-only ledger on `/v1/run`, confirm-header
still 403, CLI `decision` (no signer). Listen failures on ledger write do
not change the HTTP decision.

Still later: SIWX retrieve, prepaid list, Solana, a proxy wallet.
