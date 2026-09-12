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
```

`refuse:live` hits the live 402, applies `--max-amount-micro 1`, and writes a
`twzrd.gate_eval_refuse.v1` packet with `signer_invocation_count: 0` and
`usdc_spent: 0`. No key. No wallet.

Pay is assembled behind `--confirm-spend` + `PRIVATE_KEY` using
`@x402/fetch` + `ExactEvmScheme`. Policy still runs on the 402 *before*
the signer is constructed, and again on `onBeforePaymentCreation`.
Do not run pay for this tree unless a refuse receipt already exists.
Do not commit a key.
