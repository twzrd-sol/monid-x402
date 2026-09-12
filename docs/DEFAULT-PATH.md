# Default Path

The long-run 1 for `monid-x402`.

`tool-audit` stays public and frozen. This is not a second Vendorapp film.
This is not a Solana pin. This is not listing TWZRD as a Monid provider.

## The 1

Every Monid execution that can 402, does 402, and nothing signs until policy
says so.

Proof, over weeks:

- a catalog matrix of live `POST https://x402.monid.ai/v1/run` outcomes
- `twzrd.gate_eval_refuse.v1` packets with `signer_invocation_count: 0`
- a proxy other agents point at via `MONID_API_BASE_URL`
- an independent verifier that did not write the proxy

Day-0 counters and prepaid `api.monid.ai/v1/run` hits are not the 1.

## Why this is the hard one

Three approaches were on the table:

| | Approach | Why not / why |
|---|---|---|
| A | Research swarm + more brochure | Maps. Does not lock a door. |
| B | Foreign Path B fleet | Real 1, but we do not have a foreign signer tonight. |
| C | Default Path (this) | Hardest thing we can start now: make x402 the default on this box, keep it honest as the catalog moves. |

C is the program. B stays a later insert if a named installer appears.

## Lanes (no shared write)

Independent nodes. The maker of a lane does not grade it.

| Lane | Owns | Does not own |
|---|---|---|
| CATALOG | `evidence/seeds.json`, matrix rows, drift vs pinned payTo/networks | proxy, pay |
| PROXY | `MONID_API_BASE_URL` server: discover/inspect pass through, run → x402 + hook | catalog copy, film |
| LEDGER | refuse/pay packets, `signer_invocation_count`, usdc_spent | policy invention |
| FLEET | isolated worker dirs, no shared key | editing PROXY while running |
| VERIFY | grade packets + live 402, never writes product code | |
| FILM | new public evidence, not `tool-audit` pages | restaging $0.2394 |

## Forbidden as success

- prepaid `tool-audit` reruns
- catalog size as adoption
- our own refuse-fixture labeled external
- Solana copy on this rail
- spend without `--confirm-spend` and a refuse packet already on disk

## Week 0 (started 2026-09-12)

1. Charter (this file)
2. Seed matrix + classifier (no wallet)
3. Proxy red: `/v1/run` must not hit prepaid `api.monid.ai`
4. Fan-out: harvest more seeds; write the proxy contract from live docs
5. Listen on `127.0.0.1:8788` (`npm run listen`). Other agents set
   `MONID_API_BASE_URL=http://127.0.0.1:8788`. `8787` is a stale tool-audit
   film process. Leave it alone.

Pay stays gated. `PRIVATE_KEY` unset is a hold, not a skip of CATALOG/PROXY.
