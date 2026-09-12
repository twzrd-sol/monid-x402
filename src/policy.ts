import {
  MONID_X402_PAY_TO,
  MONID_X402_RUN_URL,
  SUPPORTED_NETWORKS,
  USDC_BASE,
  USDC_MONAD
} from "./constants.js";
import { amountMicro } from "./payment-required.js";
import type { PaymentRequired, Policy, PolicyDecision, X402Accept } from "./types.js";

function norm(value: string): string {
  return value.toLowerCase();
}

export function defaultPolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    maxAmountMicro: 10_000n,
    networks: SUPPORTED_NETWORKS,
    payTo: MONID_X402_PAY_TO,
    assets: [USDC_BASE, USDC_MONAD],
    requireVersion: 2,
    requireResourceUrl: MONID_X402_RUN_URL,
    ...overrides
  };
}

function eligible(accept: X402Accept, policy: Policy): string | null {
  if (accept.scheme !== "exact") return `scheme:${accept.scheme}`;
  if (!policy.networks.map(norm).includes(norm(accept.network))) {
    return `network:${accept.network}`;
  }
  if (norm(accept.payTo) !== norm(policy.payTo)) return `payTo:${accept.payTo}`;
  if (!policy.assets.map(norm).includes(norm(accept.asset))) {
    return `asset:${accept.asset}`;
  }
  return null;
}

export function evaluatePaymentRequired(
  required: PaymentRequired,
  policy: Policy
): PolicyDecision {
  if (required.x402Version !== policy.requireVersion) {
    return {
      decision: "refuse",
      selected: null,
      reason: `x402Version ${required.x402Version} is not ${policy.requireVersion}.`,
      code: "version_mismatch"
    };
  }
  if (required.resource.url !== policy.requireResourceUrl) {
    return {
      decision: "refuse",
      selected: null,
      reason: `resource.url ${required.resource.url} is not ${policy.requireResourceUrl}.`,
      code: "resource_mismatch"
    };
  }

  const candidates: X402Accept[] = [];
  const rejected: string[] = [];
  for (const accept of required.accepts) {
    const why = eligible(accept, policy);
    if (why) rejected.push(why);
    else candidates.push(accept);
  }

  if (candidates.length === 0) {
    return {
      decision: "refuse",
      selected: required.accepts[0] ?? null,
      reason: `No acceptable offer. Rejected: ${rejected.join(", ") || "empty"}.`,
      code: "no_acceptable_offer"
    };
  }

  const selected = candidates.reduce((best, next) =>
    amountMicro(next) < amountMicro(best) ? next : best
  );
  const amount = amountMicro(selected);
  if (amount > policy.maxAmountMicro) {
    return {
      decision: "refuse",
      selected,
      reason: `amount ${amount} exceeds maxAmountMicro ${policy.maxAmountMicro} on ${selected.network}.`,
      code: "over_cap"
    };
  }

  return {
    decision: "allow",
    selected,
    reason: `allow ${selected.network} ${selected.amount} to ${selected.payTo}`
  };
}

/**
 * Official x402Client.onBeforePaymentCreation adapter.
 * Abort here and the wallet is never asked to sign.
 */
export function createBeforePaymentCreationHook(policy: Policy) {
  return async (context: {
    selectedRequirements?: Partial<X402Accept> & { extra?: Record<string, unknown> };
    paymentRequired?: PaymentRequired;
  }): Promise<void | { abort: true; reason: string }> => {
    if (context.paymentRequired) {
      const verdict = evaluatePaymentRequired(context.paymentRequired, policy);
      if (verdict.decision === "refuse") {
        return { abort: true, reason: `${verdict.code}:${verdict.reason}` };
      }
      return;
    }
    const selected = context.selectedRequirements;
    if (!selected?.network || !selected.amount || !selected.payTo || !selected.asset || !selected.scheme) {
      return { abort: true, reason: "missing_selected_requirements" };
    }
    const synthetic: PaymentRequired = {
      x402Version: 2,
      resource: { url: policy.requireResourceUrl },
      accepts: [selected as X402Accept]
    };
    const verdict = evaluatePaymentRequired(synthetic, policy);
    if (verdict.decision === "refuse") {
      return { abort: true, reason: `${verdict.code}:${verdict.reason}` };
    }
  };
}
