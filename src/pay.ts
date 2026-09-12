import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { MONID_X402_RUN_URL, NETWORK_BASE, NETWORK_MONAD } from "./constants.js";
import { createBeforePaymentCreationHook, defaultPolicy, evaluatePaymentRequired } from "./policy.js";
import { defaultTarget, probeRun402 } from "./probe.js";
import { refuseReceipt } from "./receipt.js";
import type { Policy, RefuseReceipt, RunTarget } from "./types.js";

export class PayGatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayGatedError";
  }
}

export function assertPayAuthorized(input: {
  confirmSpend: boolean;
  privateKey?: string;
}): void {
  if (input.confirmSpend !== true) {
    throw new PayGatedError(
      "Pay is gated. Refuse is the default. Re-run with --confirm-spend and PRIVATE_KEY after a refuse receipt exists."
    );
  }
  if (!input.privateKey?.startsWith("0x")) {
    throw new PayGatedError("PRIVATE_KEY is required for pay. Do not commit it.");
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
  | { kind: "paid"; status: number; body: unknown };

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
  assertPayAuthorized({ confirmSpend: true, privateKey: options.privateKey });
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
  return { kind: "paid", status: response.status, body };
}
