export type HexAddress = `0x${string}`;

export type X402Accept = {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
};

export type PaymentRequired = {
  x402Version: number;
  error?: string;
  resource: {
    url: string;
    description?: string;
    mimeType?: string;
  };
  accepts: X402Accept[];
  extensions?: Record<string, unknown>;
};

export type RunTarget = {
  provider: string;
  endpoint: string;
  input?: Record<string, unknown>;
};

export type Policy = {
  /** Refuse if every acceptable offer is above this (USDC 6-decimal atomic). */
  maxAmountMicro: bigint;
  networks: readonly string[];
  payTo: string;
  assets: readonly string[];
  requireVersion: number;
  requireResourceUrl: string;
};

export type PolicyDecision =
  | {
      decision: "allow";
      selected: X402Accept;
      reason: string;
    }
  | {
      decision: "refuse";
      selected: X402Accept | null;
      reason: string;
      code: string;
    };

export type RefuseReceipt = {
  schema: "twzrd.gate_eval_refuse.v1";
  rail: "monid-x402";
  resource: string;
  provider: string;
  endpoint: string;
  selected: {
    network: string;
    amount: string;
    payTo: string;
    asset: string;
  } | null;
  decision: "refuse";
  reason: string;
  code: string;
  signer_invocation_count: 0;
  usdc_spent: 0;
  capturedAt: string;
};
