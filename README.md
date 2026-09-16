# monid-x402

Pre-sign spend gate for Monid's live x402 run host.

`tool-audit` stays public and frozen. That film paid a prepaid workspace
balance. This repo sits on the other rail: `POST https://x402.monid.ai/v1/run`
returns HTTP 402. Policy runs before any wallet is asked to sign.

```
inspect (optional, API key)
    → POST x402.monid.ai/v1/run
    → 402  (Base eip155:8453 / Monad eip155:143 USDC)
    → refuse or allow
    → wallet only if allow + --confirm-spend
```

This rail is EVM. It is not Solana. Client for a later pay path is
`@x402/fetch`, not `x402-solana`.

## Live offer (captured 2026-09-12, re-probe with `npm run probe:live`)

| Field | Value |
| --- | --- |
| Resource | `https://x402.monid.ai/v1/run` |
| Default tool | `context.dev:/web/scrape/markdown` |
| Networks | Base `eip155:8453`, Monad `eip155:143` |
| Amount | `10000` ($0.01 floor) |
| payTo | `0x9D3d9410Be95fa1d230734B961997427fc61D837` |

## Commands

```bash
npm ci
npm test
npm run probe:live
npm run refuse:live
npm run decision:live
npm run decision:listen
npm run catalog:live
npm run listen
npm run front
npm run doctor
npm run index
npm run verify
npm run retrieve:live
npm run e2e:listen
npm run quote:live
```

`refuse:live` hits the live 402, applies `--max-amount-micro 1`, and writes a
`twzrd.gate_eval_refuse.v1` packet with `signer_invocation_count: 0` and
`usdc_spent: 0`. No key. No wallet.

Pay is assembled behind `--confirm-spend` + `PRIVATE_KEY` using
`@x402/fetch` + `ExactEvmScheme`. Local policy still runs on the 402
*before* the signer is constructed, and again first on
`onBeforePaymentCreation`. After that, pinned `twzrd-x402-gate@0.9.9`
evaluates Base through the full preflight path and enforces the seller's
recommended cap before signing. The adapter also checks merchant-card wash
coverage before the signer exists.

On this pin: `wash_flagged=true` aborts (`twzrd_wash_flagged`). A 200
card with missing, partial, or stale coverage also aborts
(`twzrd_wash_unknown`) — 0.9.9 refuses that on a returned card; this
client still refuses after a package allow. On scored Base, fast lookup
failures (503, network, invalid JSON) fail closed by default; set the
package's `TWZRD_FAIL_OPEN=true` only when that availability tradeoff is
intentional. Lookups we send carry
`X-Twzrd-Caller: monid-x402/<version>@0.9.9` and
`X-TWZRD-Integration: monid-x402/<version>`. This rail is EVM and does
not register Solana.

Wash refuse happens after local allow and **before** the signer is
constructed. Packet: `evidence/ledger/twzrd-wash-unknown.v1.json`.

Default on. `TWZRD_AUTO_GATE=0` or `TWZRD_GATE_ENABLED=false` disables
the wash seat; local policy stays. Listen 8788 still has no wallet.

`decision:live` probes the live 402 and prints a `monid-x402.pay-path.v1`
verdict. It never constructs a signer. After confirm + key it can name
`wash_coverage` when the merchant card is not full.
`decision:listen` POSTs the 8788 pin (`MONID_API_BASE_URL`) and exits 0
only on HTTP 402 `over_cap` with `signer_invocation_count: 0`. No wallet.
Do not run pay for this tree unless a refuse receipt already exists.
Do not commit a key.

## Default Path (long-run)

Charter: [`docs/DEFAULT-PATH.md`](docs/DEFAULT-PATH.md). Lane contract:
[`docs/AGENTS.md`](docs/AGENTS.md).

```bash
npm run catalog:live
```

That POSTs each seed at the x402 host with no payment header and writes
`evidence/catalog-matrix.json` plus `evidence/catalog-drift.json`. Catalog
size is not adoption.

Listen (loopback, no wallet):

```bash
npm run listen
# other agents:
export MONID_API_BASE_URL=http://127.0.0.1:8788
```

`GET /health` reports the bound port, `prepaid_run: false`, and
`twzrd_gate: "0.9.9"`. `GET /` is the operate desk. Confirm on listen
is still 403 — no proxy wallet. Pay is CLI `pay --confirm-spend` only.
`POST $MONID_API_BASE_URL/v1/run` probes `x402.monid.ai` and returns a refuse
or `spend_gated` packet. It never calls prepaid `api.monid.ai/v1/run`.
Fleet workers live in `fleet/` and POST only that URL. Discover/inspect
forward only with the caller's `Authorization`. `--confirm-spend` requires a
refuse packet already on disk.

## High-TA loop: company brief

Akta company search is 404 on the x402 host. The live buyer job is resolve a
domain (`context.dev /brand/retrieve`) then read the homepage
(`/web/scrape/markdown`). That is the join key every research/sales agent needs.

```bash
npm run brief
npm run brief:pay   # --confirm-spend; needs PRIVATE_KEY or --key-file
```

SKU: `vendor-prescreen` is the tool-audit job on this rail (scrape +
headers + cookies). `npm run quote:live` writes the buyer envelope
(`twzrd.product_run.v1` + quote + incomplete deliver). Operate:
`http://127.0.0.1:8788/prescreen`. Buyer API: `POST /v1/product/run`.
Storefront: `pages/prescreen.html`. Pay is
`node dist/cli.js product --confirm-spend --url https://…` only after a
refuse packet exists for the seat being paid. Deliver never upgrades missing evidence to
approval. USDC settles to Monid. TWZRD take-rate is 0.

Front: `http://127.0.0.1:8790/brief.html`. Production pages deploy from `pages/`.

Pay (after a refuse packet exists):

```bash
npm run build
node dist/cli.js refuse --max-amount-micro 1
node dist/cli.js pay --confirm-spend --max-amount-micro 10000 --url https://example.com
```

`pay` reads `PRIVATE_KEY` or `--key-file` / `EVM_PRIVATE_KEY_FILE` (JSON with
`privateKey`). Do not commit a key. Front: `http://127.0.0.1:8790`.

Retrieve is week 3. `GET /v1/runs/:id` 402s with empty `accepts[]` and SIWX.
That is not a USDC offer. `retrieve` writes a refuse packet. Do not pass
`--confirm-spend`. Listen `GET /v1/runs/:id` is the same hold.

Week 4 E2E: `npm run e2e:listen` walks health → refuse → spend_gated →
confirm-still-gated → SIWX retrieve refuse → list 501 on 8788. Signer 0.

Week 5: `retrieve --confirm-sign --key-file` signs SIWX and reads the run.
That is identity, not a new USDC debit. Do not commit the key.

Week 6: the same e2e walk also requires `twzrd_gate` + `sku` on `/health`,
`GET /v1/product` 200, and `POST /v1/product/confirm` 403. A week-5 listen
that 404s the catalog is a stale door.
