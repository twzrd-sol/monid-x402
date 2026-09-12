import type { PolicyDecision } from "./types.js";

export const PAY_PATH_SCHEMA = "monid-x402.pay-path.v1" as const;

export type WashCoverage = "full" | "unknown" | "flagged";

export type PayPathInput = {
  inspectKeyPresent: boolean;
  confirmSpend: boolean;
  privateKeyPresent: boolean;
  proxyHasWallet: boolean;
  defaultCap: PolicyDecision;
  floor: PolicyDecision;
  /** Set when a 200 merchant_card was seen. Omitted on lookup failure. */
  washCoverage?: WashCoverage;
};

export type PayPathDecision = {
  schema: typeof PAY_PATH_SCHEMA;
  canPay: false | true;
  inspect: "skipped_no_key" | "available";
  defaultCap: { decision: PolicyDecision["decision"]; code?: string };
  floor: { decision: PolicyDecision["decision"]; code?: string };
  nextGate:
    | "inspect_key"
    | "over_cap"
    | "confirm_spend"
    | "private_key"
    | "proxy_wallet"
    | "wash_coverage"
    | "ready";
  blocker: string;
  nextStep: string;
  signer_invocation_count: 0;
  usdc_spent: 0;
};

/**
 * Week 0 pay-path verdict. Never constructs a signer.
 */
export function decidePayPath(input: PayPathInput): PayPathDecision {
  const inspect = input.inspectKeyPresent ? "available" : "skipped_no_key";
  const defaultCap = {
    decision: input.defaultCap.decision,
    ...(input.defaultCap.decision === "refuse" ? { code: input.defaultCap.code } : {})
  };
  const floor = {
    decision: input.floor.decision,
    ...(input.floor.decision === "refuse" ? { code: input.floor.code } : {})
  };

  if (input.defaultCap.decision === "refuse" && input.floor.decision !== "allow") {
    return pack({
      inspect,
      defaultCap,
      floor,
      nextGate: "over_cap",
      blocker: input.defaultCap.reason,
      nextStep: "Raise the cap only after a refuse receipt exists. Do not sign."
    });
  }

  if (!input.confirmSpend) {
    return pack({
      inspect,
      defaultCap,
      floor,
      nextGate: "confirm_spend",
      blocker:
        "Policy can allow the $0.01 floor, but pay is gated until --confirm-spend or X-TWZRD-Confirm-Spend.",
      nextStep:
        "Operator sets an explicit local confirm flag. Until then, stop at spend_gated. Do not spend USDC."
    });
  }

  if (!input.privateKeyPresent) {
    return pack({
      inspect,
      defaultCap,
      floor,
      nextGate: "private_key",
      blocker: "PRIVATE_KEY is unset. CLI pay refuses before a signer is constructed.",
      nextStep: "Provision a dedicated EVM key for this repo only. Do not reuse outbid or aggregator keys."
    });
  }

  if (input.washCoverage && input.washCoverage !== "full") {
    return pack({
      inspect,
      defaultCap,
      floor,
      nextGate: "wash_coverage",
      blocker:
        input.washCoverage === "flagged"
          ? "merchant_card wash_flagged=true. twzrd-x402-gate@0.9.5 aborts before the signer."
          : "merchant_card coverage is unknown (missing, partial, or stale). This client refuses twzrd_wash_unknown.",
      nextStep:
        "Do not sign. Coverage is wallet-keyed. Packet is twzrd_wash_unknown or twzrd_wash_flagged."
    });
  }

  if (!input.proxyHasWallet) {
    return pack({
      inspect,
      defaultCap,
      floor,
      nextGate: "proxy_wallet",
      blocker: "Week 0 proxy has no wallet. Confirm is not enough to sign.",
      nextStep:
        "Keep listen refuse-only. First paid attempt is CLI `pay --confirm-spend` after the operator documents that flag."
    });
  }

  return {
    schema: PAY_PATH_SCHEMA,
    canPay: true,
    inspect,
    defaultCap,
    floor,
    nextGate: "ready",
    blocker: "",
    nextStep: "CLI pay --confirm-spend with PRIVATE_KEY against x402.monid.ai. Policy still runs first.",
    signer_invocation_count: 0,
    usdc_spent: 0
  };
}

function pack(
  rest: Omit<PayPathDecision, "schema" | "canPay" | "signer_invocation_count" | "usdc_spent">
): PayPathDecision {
  return {
    schema: PAY_PATH_SCHEMA,
    canPay: false,
    signer_invocation_count: 0,
    usdc_spent: 0,
    ...rest
  };
}
