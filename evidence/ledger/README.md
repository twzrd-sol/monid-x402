This directory is an append-only ledger of refuse, paid, pay_failed, and
spend_gated packets. New files may be added. Existing packet files are never
overwritten. `INDEX.json` is derived from those files: rebuild after each
append. Count `usdc_spent_sum` only when `http_status === 200` and a
`PAYMENT-RESPONSE` exists. A `*-paid.json` filename is not settlement.
Catalog size is not adoption. Paid packets are settlement receipts on this
rail, not a second tool-audit film.
