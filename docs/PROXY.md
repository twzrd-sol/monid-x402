# Proxy contract (week 0)

Authority for the Default Path listen. Derived 2026-09-12 from live Monid
docs plus `src/proxy.ts`. `tool-audit` is off limits.

## Hard rules

- `POST /v1/run` never calls `https://api.monid.ai/v1/run`.
- `POST /v1/run` probes `https://x402.monid.ai/v1/run`, then policy.
- Refuse body is bare `twzrd.gate_eval_refuse.v1`. Do not echo upstream
 `PAYMENT-REQUIRED`.
- Discover/inspect may forward to `api.monid.ai` with inbound
 `Authorization` (+ `x-workspace-id` if present).
- Pay only after `X-TWZRD-Confirm-Spend: true` and a proxy wallet. Week 0:
 no wallet.

## Status map

| Code | HTTP | When |
|---|---|---|
| `over_cap` / `no_acceptable_offer` / `version_mismatch` / `resource_mismatch` | 402 | Policy refuse |
| `spend_gated` | 403 | Policy allow, no confirm header, or confirm with no proxy wallet |
| discover/inspect | upstream | Pass-through |
| `GET /v1/runs*` | 501 | Week 0; do not forward prepaid |

`POST /v1/run` appends `evidence/ledger/` (or `MONID_LEDGER_DIR`). Append-only
`wx` JSON. Listen failures there do not change the HTTP decision.

## Week-0 gaps vs current `proxy.ts`

Closed 2026-09-12: discover/inspect forward, inspect 401, `spend_gated` 403,
`assertNotPrepaid` on outbound fetch, headers on `handleProxyRequest`.

Closed 2026-09-12 sprint: append-only ledger, confirm-header still 403, CLI
`decision` (no signer).

Still later: SIWX retrieve, prepaid list, Solana, a proxy wallet.
