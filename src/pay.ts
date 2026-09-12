import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { MONID_X402_RUN_URL, NETWORK_BASE, NETWORK_MONAD } from "./constants.js";
import { createBeforePaymentCreationHook, defaultPolicy, evaluatePaymentRequired } from "./policy.js";
import { defaultTarget, probeRun402 } from "./probe.js";
import { paidReceipt, payFailedReceipt, refuseReceipt } from "./receipt.js";
import type { PaidReceipt, PayFailedReceipt, Policy, RefuseReceipt, RunTarget, X402Accept } from "./types.js";

export class PayGatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayGatedError";
  }
}

export type PayOptions = {
  confirmSpend: true;
  privateKey: `0x${string}`;
  policy?: Policy;
  target?: RunTarget;
};

export type PayResult =
  | { kind: "refused"; receipt: RefuseReceipt }
  | { kind: "paid"; receipt: PaidReceipt; body: unknown }
  | { kind: "failed"; receipt: PayFailedReceipt };

function redact(reason: string): string {
  return reason.replace(/0x[a-fA-F0-9]{8,}/g, "0x…");
}

function failCode(reason: string): string {
  const lower = reason.toLowerCase();
  if (lower.includes("insufficient") || lower.includes("exceeds the balance")) {
    return "insufficient_funds";
  }
  return "pay_failed";
}

function buildPaidFetch(privateKey: `0x${string}`, policy: Policy): typeof fetch {
  const account = privateKeyToAccount(privateKey);
  const client = new x402Client()
    .register(NETWORK_BASE, new ExactEvmScheme(account))
    .register(NETWORK_MONAD, new ExactEvmScheme(account))
    .onBeforePaymentCreation(createBeforePaymentCreationHook(policy));
  return wrapFetchWithPayment(fetch, client);
}

/**
 * Pay path. Policy runs on the 402 before a signer is constructed.
 * Hook stays registered so a swapped offer still cannot sign.
 */
export async function payRun(options: PayOptions): Promise<PayResult> {
  if (options.confirmSpend !== true) {
    throw new PayGatedError("Pay requires confirmSpend: true.");
  }
  if (!options.privateKey?.startsWith("0x")) {
    throw new PayGatedError("Pay requires a 0x PRIVATE_KEY.");
  }
  const target = options.target ?? defaultTarget();
  const policy = options.policy ?? defaultPolicy();
  const probe = await probeRun402(target);
  const verdict = evaluatePaymentRequired(probe.paymentRequired, policy);
  if (verdict.decision === "refuse") {
    return {
      kind: "refused",
      receipt: refuseReceipt(target, verdict, MONID_X402_RUN_URL)
    };
  }

  const selected: X402Accept = verdict.selected;
  try {
    const paidFetch = buildPaidFetch(options.privateKey, policy);
    const response = await paidFetch(MONID_X402_RUN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: target.provider,
        endpoint: target.endpoint,
        input: target.input ?? {}
      })
    });
    const body = await response.json().catch(() => null);
    const paymentResponse =
      response.headers.get("PAYMENT-RESPONSE") ??
      response.headers.get("payment-response") ??
      response.headers.get("Payment-Response");
    if (response.status === 402 || response.status >= 400) {
      const snippet = redact(JSON.stringify(body) ?? "").slice(0, 240);
      return {
        kind: "failed",
        receipt: payFailedReceipt(
          target,
          selected,
          MONID_X402_RUN_URL,
          `upstream HTTP ${response.status} after signer construct; body=${snippet}`,
          response.status === 402 ? "still_402" : "upstream_error"
        )
      };
    }
    return {
      kind: "paid",
      receipt: paidReceipt(target, selected, MONID_X402_RUN_URL, response.status, paymentResponse),
      body
    };
  } catch (error) {
    const reason = redact(error instanceof Error ? error.message : String(error));
    return {
      kind: "failed",
      receipt: payFailedReceipt(target, selected, MONID_X402_RUN_URL, reason, failCode(reason))
    };
  }
}
