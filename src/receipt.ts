import { RAIL, REFUSE_SCHEMA } from "./constants.js";
import type { PolicyDecision, RefuseReceipt, RunTarget } from "./types.js";

export function refuseReceipt(
  target: RunTarget,
  verdict: Extract<PolicyDecision, { decision: "refuse" }>,
  resourceUrl: string,
  capturedAt = new Date().toISOString()
): RefuseReceipt {
  return {
    schema: REFUSE_SCHEMA,
    rail: RAIL,
    resource: resourceUrl,
    provider: target.provider,
    endpoint: target.endpoint,
    selected: verdict.selected
      ? {
          network: verdict.selected.network,
          amount: verdict.selected.amount,
          payTo: verdict.selected.payTo,
          asset: verdict.selected.asset
        }
      : null,
    decision: "refuse",
    reason: verdict.reason,
    code: verdict.code,
    signer_invocation_count: 0,
    usdc_spent: 0,
    capturedAt
  };
}

export function spendGatedReceipt(
  target: RunTarget,
  resourceUrl: string,
  reason: string,
  capturedAt = new Date().toISOString()
): Record<string, unknown> {
  return {
    schema: REFUSE_SCHEMA,
    rail: RAIL,
    resource: resourceUrl,
    provider: target.provider,
    endpoint: target.endpoint,
    decision: "spend_gated",
    reason,
    code: "spend_gated",
    signer_invocation_count: 0,
    usdc_spent: 0,
    capturedAt
  };
}
