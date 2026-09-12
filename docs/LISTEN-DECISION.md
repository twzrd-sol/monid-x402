# Listen decision (8788 hold)

Agents prove the live listen pin without a wallet:

```bash
export MONID_API_BASE_URL=http://127.0.0.1:8788
npm run decision:listen
```

Success is HTTP 402, `decision: refuse`, `code: over_cap`,
`signer_invocation_count: 0`, `usdc_spent: 0`. The command POSTs
`/v1/run` with the default `context.dev` scrape tool and no
`Authorization`, payment header, or `X-TWZRD-Confirm-Spend`.

`decision:live` still probes `x402.monid.ai`. That is a different
receipt. Listen proof is this script.

`127.0.0.1:8787` is the stale film. The command refuses that port.
