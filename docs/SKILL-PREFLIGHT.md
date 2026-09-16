# Preflight (x402) — skill fragment

Drop-in for [Monid SKILL.md v0.1.7](https://monid.ai/SKILL.md). Written to slot
between **Inspect** and **Run**. It does not replace `monid discover` health or
the verified badge. Those grade the endpoint. This grades the **payTo** before
a wallet signs.

Do not paste this into `tool-audit`. Do not claim TWZRD is a Monid provider.

---

## When to Use (add after inspect, before run)

The catalog `Health` column and the verified badge are **not a spend decision**.
They tell you the endpoint has been seen working. They do not score the
counterparty that collects USDC on `POST https://x402.monid.ai/v1/run`.

x402 covers **execution and retrieval only**. Discovery and inspection still
use a Monid API key. Typical loop stays:

**discover / inspect** (API key) → **preflight payTo** (no signature) → **pay and run** (wallet) → **retrieve** (SIWX, not USDC).

If the user is on prepaid `monid run`, this step does not apply. If the user
is paying per run with USDC, do not skip it.

### Why inspect is not a trust signal

`monid discover` hands an agent `providerName`, `price`, `score`, and
`tags` (often including `verified`). It does **not** hand `docUrl`. That
field exists only after `monid inspect`. Measured 2026-09-15 against the
live API (`tool-audit.selection-blindness.v1`, three queries, 30
endpoints, `paidRuns: 0`, balance `$20.68` → `$20.68`): `docUrl` is in
`fieldsOnlyAvailableAfterInspect`. The verified badge is visible at
selection; the documentation host is not.

A second free preflight (discover + inspect, `$0.00`) on 25 seed queries
surfaced 409 endpoints across 62 providers, then inspected **one listing
per provider**. Of those 62: **30** document at a host that does not
match the brand they assert, **29** of those at a single host
(`parse.bot`), **3** publish no `docUrl` at all. `verified` is on 58 of
62 listings (including 26 of the 29 that *do* document on their own
host), so the tag cannot tell an agent which side it is looking at.

That is a metadata observation, not an accusation — `parse.bot` is named
openly in each listing's own `docUrl`. We called none of those
endpoints. The point for this skill: **Health and `verified` break ties
between endpoints. They do not name `payTo`, and they are not a spend
decision.** On x402, score the counterparty after inspect and before
the signer exists.

### 2b. Preflight (x402 only)

After `monid inspect` and **before** any client constructs a signer:

1. Probe `POST https://x402.monid.ai/v1/run` with **no** payment header.
   Expect HTTP 402. Read `accepts[]`. Pick the network you intend
   (`eip155:8453` Base, `eip155:143` Monad). Do not blindly take `accepts[0]`.
2. If `accepts` is empty and the 402 carries a Sign-In-With-X extension, that
   is **identity, not a USDC offer**. Do not treat it as a pay. Retrieve stays
   unsigned unless the user confirmed a sign (`siwx_no_pay_offer`).
3. Score `payTo` with the paying-client gate. The published hook
   (`twzrdApprovePayment` in `twzrd-x402-gate`) reads `wash_flagged` only.
   Coverage (`wash_confidence` / `confidence`, `ring_evaluated`, `wash_stale`)
   lives in this adapter — there is no upstream twin. Pin the version that
   produced the receipt you will show: this listen and its settled packet
   are `0.9.5`. `monid-x402` main already pins `0.9.9` (Base is evaluated
   inside the package). Do not mix them in one judged trace. Local policy
   still runs first (amount cap, network, resource). Do not resolve
   `twzrd-x402-gate` as `^0.10` — `0.10.1` outranks `0.9.9` by semver and
   is eight days older.
4. **Refuse without a signer** when:
   - the subject has never been evaluated
   - `wash_flagged` is true
   - the quote is over **either** cap, which are two different numbers:
     - your local policy cap. `defaultPolicy` in this repo is
       `maxAmountMicro: 10_000n`, i.e. **$0.01** — not $1.00. Raise it
       deliberately; the CLI takes `--max-amount-micro`.
     - the seller's own `recommended_cap_usdc` from the readiness card, which
       the package enforces from `0.9.9`. It is server-issued and graded per
       seller, not a constant: measured on the Monid `payTo` it returns
       `min(quote, $1.00)`, so $1.00 is that seller's ceiling, while a
       never-evaluated seller comes back at $0.10.
   - intel is fail-closed and the lookup 503s / times out
     (`TWZRD_FAIL_OPEN=false` is process env on the **package**, not the
     adapter option of the same name)
5. **Allow** only then. Construct the wallet. Send `--confirm-spend` (or
   `X-TWZRD-Confirm-Spend`) after a refuse packet for that seat is already on
   disk. Minimum advertised price is $0.01 USDC.

Point other agents at the listen door, not prepaid `api.monid.ai/v1/run`:

```bash
export MONID_API_BASE_URL=http://127.0.0.1:8788
# GET /health → prepaid_run: false, sku: "vendor-prescreen"
# POST /v1/run without a wallet → 402 over_cap, signer_invocation_count: 0
```

Listen confirm stays 403 `spend_gated`. That is the door working, not a bug.

Which refusal you see depends on the order the checks run, so do not treat
`over_cap` as the wrong answer. The listen door carries its own local cap of
`--max-amount-micro 1`, i.e. one micro-USDC, well under the $0.01 x402 floor.
Every quote is therefore over that cap first, and the door answers **402
`over_cap`** with `signer_invocation_count: 0` — including when you send
`X-TWZRD-Confirm-Spend`. You only reach the 403 `spend_gated` branch by raising
the local cap above the quote. Both are refusals with nothing signed; they are
different rungs, not different verdicts.

### Workflow (x402)

Replace the prepaid `monid run` step only:

```bash
# 1–2 unchanged: discover, inspect (API key)
monid discover -q "web scrape markdown"
monid inspect -p context.dev -e /web/scrape/markdown

# 3. Preflight — no wallet
# Probe the x402 host, apply local policy, wash-check payTo.
# Expect a refuse packet (schema twzrd.gate_eval_refuse.v1) or spend_gated 403.
# Do not send PAYMENT-SIGNATURE here.

# 4. Pay and run — only after allow + confirm
# POST https://x402.monid.ai/v1/run with an x402 client.
# Save runId / pollUrl from 200 or 202.

# 5. Retrieve — SIWX from the paying wallet, not a second USDC debit
# GET https://x402.monid.ai/v1/runs/:runId
# Empty accepts[] + SIWX ≠ a pay offer.
```

`GET /v1/runs` list is workspace-scoped. x402 has no list. Do not forward it.

---

## Rules for Agents (additions)

13. **Inspect is not preflight.** `Health` and the verified badge break ties
    between endpoints. They do not authorize a USDC sign. `docUrl` is
    inspect-only (not on discover). On x402, score `payTo` after inspect
    and before the signer exists.
14. **Never sign a 402 you have not refused first.** A refuse packet on disk
    is the seat. Confirm-spend without it is a skip, not a pay.
15. **Empty `accepts[]` is not free.** SIWX retrieve is identity. Unsigned
    GET stays `siwx_no_pay_offer`.
16. **A dead intel lookup is a refuse under fail-closed.** Do not set
    `TWZRD_FAIL_OPEN` on the adapter and believe the package heard you.
    The package reads `process.env.TWZRD_FAIL_OPEN`.
17. **Prepaid `monid run` and x402 `POST /v1/run` are different rails.**
    Do not debit workspace credits to prove an x402 demo. Do not point
    `MONID_API_BASE_URL` at a film that forwards `api.monid.ai/v1/run`.

---

## Cost note (x402)

Monid raises advertised x402 price to **$0.01** if the quote is lower.
Metered (time-billed) endpoints are not on this rail. Prefer one query per
call and small limits on the first paid run — same as prepaid, but the debit
is on-chain USDC to Monid `payTo`, not a workspace balance.

TWZRD take-rate on this SKU is 0. The product is the door, not a second
subscription.
