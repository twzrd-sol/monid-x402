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
| `over_cap` / `no_acceptable_offer` / `version_mismatch` / `resource_mismatch` | 402 | Policy refuse |
| `spend_gated` | 403 | Policy allow, no confirm header, or confirm with no proxy wallet |
| discover/inspect | upstream | Pass-through |
| `GET /v1/runs` | 501 | prepaid list; do not forward |
| `GET /v1/runs/:id` | 402 | SIWX retrieve refuse (`siwx_no_pay_offer`); no signer |

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
  "twzrd_gate": "0.9.5",
  "desk": true
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

Closed week 3: `GET /v1/runs/:id` probes `x402.monid.ai/v1/runs/:id`,
refuses SIWX with empty `accepts[]`, never signs. List stays 501.

Still later: SIWX identity sign, prepaid list, Solana, a proxy wallet.
