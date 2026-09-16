# Proxy contract

Authority for the Default Path listen. Derived 2026-09-12 from live Monid
docs plus `src/proxy.ts`. `tool-audit` is off limits.

## Hard rules

- `POST /v1/run` never calls `https://api.monid.ai/v1/run`.
- `POST /v1/run` probes `https://x402.monid.ai/v1/run`, then policy.
- Refuse body is bare `twzrd.gate_eval_refuse.v1`. Do not echo upstream
 `PAYMENT-REQUIRED`.
- Discover/inspect may forward to `api.monid.ai` with inbound
 `Authorization` (+ `x-workspace-id` if present).
- Pay only after `X-TWZRD-Confirm-Spend: true` and a proxy wallet. Listen
 has no wallet. Confirm is 403 `spend_gated`, schema
 `twzrd.gate_eval_spend_gated.v1`.

## Status map

| Code | HTTP | When |
|---|---|---|
| `GET /health` | 200 | Local listen probe; `listen` is the bound port; no upstream fetch |
| `GET /prescreen` | 200 | SKU operate desk |
| `GET /v1/product` | 200 | Agent SKU catalog; no wallet |
| `POST /v1/product/quote` | 200 / 402 | Live 402 quote; no wallet |
| `POST /v1/product/run` | 200 / 402 | Buyer envelope: quote + incomplete deliver; no wallet |
| `POST /v1/product/run` + confirm | 403 | Same envelope, `nextGate: proxy_wallet`; no pay |
| `POST /v1/product/confirm` | 403 | SKU confirm; no proxy wallet |
| `over_cap` / `no_acceptable_offer` / `version_mismatch` / `resource_mismatch` | 402 | Policy refuse |
| `spend_gated` | 403 | Policy allow, no confirm header, or confirm with no proxy wallet |
| discover/inspect | upstream | Pass-through |
| `GET /v1/runs` | 501 | prepaid list; do not forward |
| `GET /v1/runs/:id` | 402 | SIWX retrieve refuse (`siwx_no_pay_offer`) unless confirm-sign + listen key |

## `GET /health`

Local JSON only. Does not call `api.monid.ai` or `x402.monid.ai`. Distinguishes
the Default Path listen from the stale `:8787` film. `listen` is the bound
port, not a hardcoded 8788.

```json
{
  "ok": true,
  "rail": "monid-x402",
  "listen": "8788",
  "prepaid_run": false,
  "twzrd_gate": "0.9.9",
  "desk": true,
  "sku": "vendor-prescreen"
}
```

`prepaid_run: false` means this listen will not forward prepaid
`api.monid.ai/v1/run`. It is not a paid receipt and not a wallet.
`twzrd_gate` is the wash pin on the *paying* client. Listen still does
not sign. `GET /` serves the operate desk.

Closed 2026-09-12: discover/inspect forward, inspect 401, `spend_gated` 403,
`assertNotPrepaid` on outbound fetch, headers on `handleProxyRequest`.

Closed week 1: `GET /health` 200 JSON, no fetch. Bound port in the body.

Closed 2026-09-12 sprint: append-only ledger on `/v1/run`, confirm-header
still 403, CLI `decision` (no signer). Listen failures on ledger write do
not change the HTTP decision. `INDEX.json` is derived. `--confirm-spend`
requires a refuse packet on disk.

Closed week 3: unsigned `GET /v1/runs/:id` refuses SIWX. List stays 501.

Closed week 5: confirm-sign + `MONID_LISTEN_PRIVATE_KEY` signs SIWX.
Default listen still has no wallet.

Week 6: `/health` must name `twzrd_gate` and `sku`. `GET /v1/product` is
part of the door. Confirm stays 403.

Still later: default listen wallet, prepaid list, Solana.
