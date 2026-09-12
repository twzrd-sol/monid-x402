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
6. Company brief is the first high-TA buyer loop: brand retrieve + homepage scrape.

Pay stays gated unless `--confirm-spend` and a refuse packet already exist.
`npm run decision:live` records that hold without constructing a signer.

## Week 1 (door for other agents)

1. PROXY: `GET /health` on the listen so a fleet can tell 8788 from the 8787 film.
2. FLEET: isolated worker dir `fleet/`. Workers POST only
   `MONID_API_BASE_URL/v1/run` (default `http://127.0.0.1:8788`). No shared key.
   No prepaid `api.monid.ai/v1/run`.
3. CATALOG: drift check vs pinned payTo `0x9D3d9410Be95fa1d230734B961997427fc61D837`
   and networks `eip155:8453` + `eip155:143`. Write `evidence/catalog-drift.json`.
   Row count is not adoption.
4. LEDGER: append-only index of `evidence/ledger/` packets. No overwrites.

## Week 2 (honest grade)

1. VERIFY: re-fetch one live 402. Check refuse + paid packets. Write
   `evidence/verify/week2.json` only. Never edit `src/`. Solo grade is
   same-session; do not claim an independent lane that does not exist.
2. FILM: `tool-audit` already posted. Do not add another public film.

Live after #1 + #2 landed on `main` (verified 2026-09-12):

- door: `export MONID_API_BASE_URL=http://127.0.0.1:8788` (`GET /health` 200, `prepaid_run: false`)
- film: https://twzrd-sol.github.io/monid-x402/week12.json
- film HTML: https://twzrd-sol.github.io/monid-x402/week12.html

`31` x402 rows is inventory, not adoption. Leave `8787` alone.

## Week 3 (SIWX retrieve, no identity sign)

Live `GET https://x402.monid.ai/v1/runs/:id` returns HTTP 402 with
`accepts: []` and a `sign-in-with-x` extension. That is identity, not a
USDC offer. Policy refuses `siwx_no_pay_offer`. Signer stays 0.

1. Parse empty `accepts[]` so the 402 can be graded instead of thrown away.
2. CLI `retrieve` (no `--confirm-spend`) writes a refuse packet.
3. Listen `GET /v1/runs/:id` probes the x402 host and returns that refuse.
   `GET /v1/runs` list stays 501 (prepaid list).
4. VERIFY writes `evidence/verify/week3.json`. Same-session grade only.

Do not sign SIWX. Confirm-spend does not unlock retrieve. No new film.

## Week 4 (listen E2E door)

The week-3 routes worked by hand. Other agents had no single command that
proved the whole 8788 walk, and doctor/fleet only checked POST /v1/run.

1. `proveListenE2E` / `npm run e2e:listen`: health, over_cap refuse,
   spend_gated, confirm-still-gated, SIWX retrieve refuse, list 501.
   Signer 0. Not 8787. Not prepaid.
2. `doctor` fails if retrieve is still 501.
3. Fleet worker POSTs refuse then GETs retrieve. No spend path.

No new film. No proxy wallet. No extra spend.

Still later: SIWX identity sign (only if policy ever sees a payable
accept), proxy wallet, Solana, a second partner.
