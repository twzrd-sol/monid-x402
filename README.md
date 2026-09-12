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
npm run catalog:live
npm run listen
```

`refuse:live` hits the live 402, applies `--max-amount-micro 1`, and writes a
`twzrd.gate_eval_refuse.v1` packet with `signer_invocation_count: 0` and
`usdc_spent: 0`. No key. No wallet.

Pay is assembled behind `--confirm-spend` + `PRIVATE_KEY` using
`@x402/fetch` + `ExactEvmScheme`. Policy still runs on the 402 *before*
the signer is constructed, and again on `onBeforePaymentCreation`.
`decision:live` probes the live 402 and prints a `monid-x402.pay-path.v1`
verdict. It never constructs a signer.

Do not run pay for this tree unless a refuse receipt already exists.
Do not commit a key.

## Default Path (long-run)

Charter: [`docs/DEFAULT-PATH.md`](docs/DEFAULT-PATH.md). Lane contract:
[`docs/AGENTS.md`](docs/AGENTS.md).

```bash
npm run catalog:live
```

That POSTs each seed at the x402 host with no payment header and writes
`evidence/catalog-matrix.json`. Catalog size is not adoption.

Week-0 listen (loopback, no wallet):

```bash
npm run listen
# other agents:
export MONID_API_BASE_URL=http://127.0.0.1:8788
```

`POST $MONID_API_BASE_URL/v1/run` probes `x402.monid.ai` and returns a refuse
or `spend_gated` packet. It never calls prepaid `api.monid.ai/v1/run`.
Discover/inspect forward only with the caller's `Authorization`.
