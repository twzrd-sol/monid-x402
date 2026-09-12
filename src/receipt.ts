import { PAID_SCHEMA, PAY_FAILED_SCHEMA, RAIL, REFUSE_SCHEMA, SPEND_GATED_SCHEMA } from "./constants.js";
import { amountMicro, decodePaymentResponse, usdcFromMicro } from "./payment-required.js";
import type {
  OfferSlice,
  PaidReceipt,
  PayFailedReceipt,
  PolicyDecision,
  RefuseReceipt,
  RunTarget,
  SpendGatedReceipt,
  X402Accept
} from "./types.js";

export class PaidReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaidReceiptError";
  }
}

function offerSlice(accept: X402Accept): OfferSlice {
  return {
    network: accept.network,
    amount: accept.amount,
    payTo: accept.payTo,
    asset: accept.asset
  };
}

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
): SpendGatedReceipt {
  return {
    schema: SPEND_GATED_SCHEMA,
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

export function paidReceipt(
  target: RunTarget,
  selected: X402Accept,
  resourceUrl: string,
  httpStatus: number,
  paymentResponse: string | null,
  capturedAt = new Date().toISOString()
): PaidReceipt {
  if (httpStatus < 200 || httpStatus >= 300) {
    throw new PaidReceiptError(`paidReceipt requires HTTP 2xx, got ${httpStatus}`);
  }
  if (!paymentResponse) {
    throw new PaidReceiptError("paidReceipt requires PAYMENT-RESPONSE");
  }
  const proof = decodePaymentResponse(paymentResponse);
  return {
    schema: PAID_SCHEMA,
    rail: RAIL,
    resource: resourceUrl,
    provider: target.provider,
    endpoint: target.endpoint,
    selected: offerSlice(selected),
    decision: "paid",
    http_status: httpStatus,
    payment_response: paymentResponse,
    payer: proof?.payer ?? null,
    transaction: proof?.transaction ?? null,
    network: proof?.network ?? selected.network,
    signer_invocation_count: 1,
    usdc_spent: usdcFromMicro(amountMicro(selected)),
    capturedAt
  };
}

export function payFailedReceipt(
  target: RunTarget,
  selected: X402Accept | null,
  resourceUrl: string,
  reason: string,
  code: string,
  capturedAt = new Date().toISOString()
): PayFailedReceipt {
  return {
    schema: PAY_FAILED_SCHEMA,
    rail: RAIL,
    resource: resourceUrl,
    provider: target.provider,
    endpoint: target.endpoint,
    selected: selected ? offerSlice(selected) : null,
    decision: "pay_failed",
    reason,
    code,
    signer_invocation_count: 1,
    usdc_spent: 0,
    capturedAt
  };
}
