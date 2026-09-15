/** Monid x402 execution host. Discover/inspect stay on api.monid.ai. */
export const MONID_X402_RUN_URL = "https://x402.monid.ai/v1/run";
export const MONID_X402_RUNS_URL = "https://x402.monid.ai/v1/runs";
export const MONID_API_URL = "https://api.monid.ai/v1";

/** Live payTo from 2026-09-12 probe of POST /v1/run. Same on Base and Monad. */
export const MONID_X402_PAY_TO = "0x9D3d9410Be95fa1d230734B961997427fc61D837";

export const NETWORK_BASE = "eip155:8453";
export const NETWORK_MONAD = "eip155:143";
export const SUPPORTED_NETWORKS = [NETWORK_BASE, NETWORK_MONAD] as const;

export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_MONAD = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

/** Docs floor: Monid raises advertised x402 price to $0.01 if the quote is lower. */
export const X402_FLOOR_MICRO = 10_000n;

export const DEFAULT_PROVIDER = "context.dev";
export const DEFAULT_ENDPOINT = "/web/scrape/markdown";

export const REFUSE_SCHEMA = "twzrd.gate_eval_refuse.v1";
export const SPEND_GATED_SCHEMA = "twzrd.gate_eval_spend_gated.v1";
export const PAID_SCHEMA = "twzrd.gate_eval_paid.v1";
export const PAY_FAILED_SCHEMA = "twzrd.gate_eval_pay_failed.v1";
export const RETRIEVED_SCHEMA = "twzrd.gate_eval_retrieved.v1";
export const RAIL = "monid-x402";
export const PACKAGE_VERSION = "0.1.0";
export const TWZRD_GATE_PACKAGE = "twzrd-x402-gate";
export const TWZRD_GATE_PIN = "0.9.9";
