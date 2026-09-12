# VERIFY week 2

Independent grade of Default Path 1. This lane did not write the proxy.
No spend. No payment header. 8787 pid 915170 left alone.

**verdict: valid**

Every execution that can 402 does 402 and nothing signs until policy says so.

## Live 402 (re-fetch 2026-09-12T03:50:41Z)

`POST https://x402.monid.ai/v1/run`
`{"provider":"context.dev","endpoint":"/web/scrape/markdown","input":{}}`

| Field | Value |
|---|---|
| status | 402 |
| payTo | `0x9D3d9410Be95fa1d230734B961997427fc61D837` |
| payTo still pinned | yes |
| networks | `eip155:8453`, `eip155:143` |
| amount | `10000` |
| resource | `https://x402.monid.ai/v1/run` |
| x-request-id | `0dcd1c11-e035-4c2f-9842-900c4373b6e8` |

## Checks

| Check | Pass |
|---|---|
| live POST is 402 | yes |
| at least one refuse packet has `signer_invocation_count` 0 and `usdc_spent` 0 | yes (3 ledger refuse packets) |
| at least one paid packet has `signer_invocation_count` 1, `usdc_spent` > 0, `http_status` 200 | yes (3 ledger paid packets + `evidence/live-pay-200.json`) |
| no packet names `api.monid.ai/v1/run` as the resource | yes (all named resources are `https://x402.monid.ai/v1/run`) |

Machine record: `week2.json`.
