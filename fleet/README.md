# Fleet worker (week 1)

Isolated Default Path client. This directory does not share a key, does not
sign, and does not bind a listen port.

`POST` goes only to `MONID_API_BASE_URL + "/v1/run"`.
Unset base is `http://127.0.0.1:8788`, so the default URL is
`http://127.0.0.1:8788/v1/run`.

Default job (no payment header):

```json
{ "provider": "context.dev", "endpoint": "/web/scrape/markdown", "input": {} }
```

Expected response: HTTP 402 packet `twzrd.gate_eval_refuse.v1` with
`signer_invocation_count: 0` and `usdc_spent: 0`.

## Run

From the repo root (proxy already listening on loopback 8788):

```bash
node fleet/worker.mjs
```

Override the base without touching 8787:

```bash
MONID_API_BASE_URL=http://127.0.0.1:8788 node fleet/worker.mjs
```

## Test

```bash
node --test fleet/worker.test.mjs
```

The test injects a mock `fetch` and an ephemeral mock server (port 0). It does
not bind 8787 or 8788.

## Isolation

- No `PRIVATE_KEY`, no wallet file, no `--confirm-spend`
- No payment header on the default job
- Worker source does not name a prepaid run URL
- Worker does not import `src/`
- Leave pid 915170 / `:8787` alone
