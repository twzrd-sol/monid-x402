import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createRequire } from "node:module";
import { x402Client } from "@x402/fetch";
import {
  MONID_X402_PAY_TO,
  NETWORK_BASE,
  NETWORK_MONAD,
  PACKAGE_VERSION,
  TWZRD_GATE_PACKAGE,
  TWZRD_GATE_PIN
} from "./constants.js";
import { defaultPolicy } from "./policy.js";
import {
  composeBeforePaymentCreation,
  isTwzrdGateEnabled,
  merchantCardCoverage,
  runTwzrdGateWithTimeout,
  twzrdGateAttribution,
  twzrdGateFailOpen,
  twzrdGateTimeoutMs,
  TWZRD_GATE_TIMEOUT_MS,
  type BeforePaymentCreationResult
} from "./twzrd-gate.js";

test("gate is on by default; explicit disable wins", () => {
  assert.equal(isTwzrdGateEnabled({}), true);
  assert.equal(isTwzrdGateEnabled({ TWZRD_AUTO_GATE: "1" }), true);
  assert.equal(isTwzrdGateEnabled({ TWZRD_AUTO_GATE: "0" }), false);
  assert.equal(isTwzrdGateEnabled({ TWZRD_GATE_ENABLED: "false" }), false);
  assert.equal(isTwzrdGateEnabled({ TWZRD_AUTO_GATE: "1", TWZRD_GATE_ENABLED: "off" }), false);
});

test("wrapper fail-open defaults true; TWZRD_FAIL_OPEN=false refuses hangs", () => {
  assert.equal(twzrdGateFailOpen({}), true);
  assert.equal(twzrdGateFailOpen({ TWZRD_FAIL_OPEN: "false" }), false);
  assert.equal(twzrdGateTimeoutMs({}), TWZRD_GATE_TIMEOUT_MS);
  assert.equal(twzrdGateTimeoutMs({ TWZRD_GATE_TIMEOUT_MS: "50" }), 50);
  assert.equal(twzrdGateTimeoutMs({ TWZRD_GATE_TIMEOUT_MS: "nope" }), TWZRD_GATE_TIMEOUT_MS);
});

test("attribution is monid-x402/<version> and caller appends the gate pin", () => {
  const attr = twzrdGateAttribution({}, () => "run-1");
  assert.equal(attr.integration, `monid-x402/${PACKAGE_VERSION}`);
  assert.equal(attr.runId, "run-1");
  assert.equal(attr.caller, `monid-x402/${PACKAGE_VERSION}@${TWZRD_GATE_PIN}`);
});

test("timeout wrapper passes a verdict and refuses a hang when failOpen is false", async () => {
  const abort = { abort: true as const, reason: "wash" };
  assert.deepEqual(
    await runTwzrdGateWithTimeout(async () => abort, { timeoutMs: 200, failOpen: true }),
    abort
  );
  const hung = await runTwzrdGateWithTimeout(
    () => new Promise<BeforePaymentCreationResult>(() => {}),
    { timeoutMs: 20, failOpen: false, log: { log() {}, warn() {} } }
  );
  assert.deepEqual(hung, { abort: true, reason: "twzrd gate did not answer within 20ms" });
});

test("merchant-card coverage is wallet-keyed: full vs unknown vs flagged", () => {
  assert.equal(
    merchantCardCoverage({
      wash_flagged: false,
      wash_confidence: "full",
      ring_evaluated: true
    }),
    "full"
  );
  assert.equal(merchantCardCoverage({ wash_flagged: true, wash_confidence: "full" }), "flagged");
  assert.equal(merchantCardCoverage({ wash_flagged: false }), "unknown");
  assert.equal(
    merchantCardCoverage({ wash_flagged: false, wash_confidence: "partial" }),
    "unknown"
  );
  assert.equal(
    merchantCardCoverage({
      wash_flagged: false,
      wash_confidence: "full",
      ring_evaluated: false
    }),
    "unknown"
  );
  assert.equal(
    merchantCardCoverage({
      wash_flagged: false,
      wash_confidence: "full",
      wash_stale: true
    }),
    "unknown"
  );
  assert.equal(merchantCardCoverage({}), "unknown");
});

test("local policy abort runs before the TWZRD hook", async () => {
  let twzrdCalls = 0;
  const hook = composeBeforePaymentCreation(defaultPolicy({ maxAmountMicro: 1n }), {
    env: { TWZRD_AUTO_GATE: "1" },
    createHook: () => async () => {
      twzrdCalls += 1;
      return undefined;
    }
  });
  const result = await hook({
    paymentRequired: {
      x402Version: 2,
      resource: { url: "https://x402.monid.ai/v1/run" },
      accepts: [
        {
          scheme: "exact",
          network: NETWORK_BASE,
          amount: "10000",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          payTo: "0x9D3d9410Be95fa1d230734B961997427fc61D837"
        }
      ]
    }
  });
  assert.ok(result && "abort" in result && result.abort);
  assert.match(result.reason, /over_cap/);
  assert.equal(twzrdCalls, 0);
});

const require = createRequire(import.meta.url);
const installed = require(`${TWZRD_GATE_PACKAGE}/package.json`) as {
  version: string;
  exports: Record<string, unknown>;
};

test(`pins ${TWZRD_GATE_PACKAGE}@${TWZRD_GATE_PIN} and does not export ./unsafe`, () => {
  const declared = (require("../package.json") as { dependencies: Record<string, string> }).dependencies[
    TWZRD_GATE_PACKAGE
  ];
  assert.equal(declared, TWZRD_GATE_PIN);
  assert.equal(installed.version, TWZRD_GATE_PIN);
  assert.equal(Object.hasOwn(installed.exports, "./unsafe"), false);
});

const INTEL = "https://intel.twzrd.xyz";
const PACKAGE_ENV = [
  "TWZRD_INTEL_BASE",
  "TWZRD_REFUSE_WASH_FLAGGED",
  "TWZRD_FAIL_OPEN",
  "TWZRD_AUTO_GATE",
  "TWZRD_GATE_ENABLED",
  "TWZRD_UNSUPPORTED_NETWORK_MODE"
] as const;

const originalEnv: Partial<Record<(typeof PACKAGE_ENV)[number], string | undefined>> = {};
for (const key of PACKAGE_ENV) {
  originalEnv[key] = process.env[key];
}

function clearPackageEnv(): void {
  for (const key of PACKAGE_ENV) {
    delete process.env[key];
  }
}

function restorePackageEnv(): void {
  for (const key of PACKAGE_ENV) {
    const prev = originalEnv[key];
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

afterEach(() => {
  restorePackageEnv();
});

type FetchCall = { url: string; init?: RequestInit };

function stubFetch(respond: (call: FetchCall) => Response | Promise<Response>): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = previous;
    }
  };
}

function card(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function merchantCardUrl(payTo: string): string {
  return `${INTEL}/v1/intel/merchant_card/${encodeURIComponent(payTo)}`;
}

function headerOf(call: FetchCall, name: string): string | null {
  return new Headers(call.init?.headers).get(name);
}

async function gatedClient(
  env: NodeJS.ProcessEnv = {},
  payTo = MONID_X402_PAY_TO
): Promise<{
  client: x402Client;
  signerCalls: () => number;
}> {
  const client = new x402Client();
  client.setSpendControls(false);
  let signerCalls = 0;
  const policy = defaultPolicy({ maxAmountMicro: 10_000n, payTo });
  client.onBeforePaymentCreation(
    composeBeforePaymentCreation(policy, {
      env: { ...env },
      log: { log() {}, warn() {} },
      runId: () => "run-test"
    })
  );
  for (const network of [NETWORK_BASE, NETWORK_MONAD] as const) {
    client.register(network, {
      scheme: "exact",
      async createPaymentPayload() {
        signerCalls += 1;
        return { x402Version: 2, payload: {} };
      }
    });
  }
  return { client, signerCalls: () => signerCalls };
}

function pay(client: x402Client, network: `${string}:${string}`, payTo: string) {
  return client.createPaymentPayload({
    x402Version: 2,
    resource: { url: "https://x402.monid.ai/v1/run" },
    accepts: [
      {
        scheme: "exact",
        network,
        amount: "10000",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        payTo,
        maxTimeoutSeconds: 60,
        extra: {}
      }
    ]
  });
}

/**
 * twzrd-x402-gate >= 0.9.9 scores Base from its own corpus, so a Base payment
 * now POSTs the preflight before the merchant_card wash read. Monad has no
 * corpus and still takes the unscored path with the wash read alone.
 *
 * Serves a readiness card on the preflight and the given merchant card
 * otherwise, so these cases exercise the wash behaviour they are about rather
 * than a preflight that scores 0 off a merchant-card body.
 */
function routed(cardBody: unknown): (call: FetchCall) => Response {
  return (call: FetchCall) =>
    call.url.includes("/v1/intel/preflight")
      ? card({
          readiness_card: {
            decision: "allow",
            trust_score: 80,
            score: 0.8,
            null_reason: null,
            can_spend: true
          }
        })
      : card(cardBody);
}

const NETWORKS: Array<{
  label: string;
  network: `${string}:${string}`;
  payTo: string;
  /** Base is scored, so it consults the preflight before the wash read. */
  scored: boolean;
}> = [
  { label: "Base", network: NETWORK_BASE, payTo: MONID_X402_PAY_TO, scored: true },
  { label: "Monad", network: NETWORK_MONAD, payTo: MONID_X402_PAY_TO, scored: false }
];

for (const { label, network, payTo, scored } of NETWORKS) {
  // A scored network adds the preflight POST ahead of the merchant_card GET.
  const expectedCalls = scored ? 2 : 1;
  const cardCall = (calls: FetchCall[]) =>
    calls.find((c) => c.url.includes("/v1/intel/merchant_card/"));

  test(`${label}: wash_flagged=true aborts; signer calls 0`, async () => {
    clearPackageEnv();
    const stub = stubFetch(routed({ wash_flagged: true }));
    try {
      const { client, signerCalls } = await gatedClient();
      await assert.rejects(() => pay(client, network, payTo), /twzrd_wash_flagged|Payment creation aborted/);
      assert.equal(signerCalls(), 0, "wash still refuses before any signer");
      assert.equal(stub.calls.length, expectedCalls);
      const gc = cardCall(stub.calls);
      assert.equal(gc?.url, merchantCardUrl(payTo));
      assert.equal(gc?.init?.method ?? "GET", "GET");
    } finally {
      stub.restore();
    }
  });

  test(`${label}: clean full coverage allows; one GET merchant_card; preflight only when scored`, async () => {
    clearPackageEnv();
    const stub = stubFetch(
      routed({ wash_flagged: false, wash_confidence: "full", ring_evaluated: true })
    );
    try {
      const { client, signerCalls } = await gatedClient();
      await pay(client, network, payTo);
      assert.equal(signerCalls(), 1);
      assert.equal(stub.calls.length, expectedCalls);
      const gc = cardCall(stub.calls);
      assert.equal(gc?.url, merchantCardUrl(payTo));
      assert.equal(
        stub.calls.some((c) => c.url.includes("/v1/intel/preflight")),
        scored,
        scored ? "a scored network consults its corpus" : "an unscored network must not preflight"
      );
      assert.equal(headerOf(gc!, "X-Twzrd-Caller"), `monid-x402/${PACKAGE_VERSION}@${TWZRD_GATE_PIN}`);
      assert.equal(headerOf(gc!, "X-TWZRD-Integration"), `monid-x402/${PACKAGE_VERSION}`);
      assert.equal(headerOf(gc!, "X-TWZRD-Run-Id"), "run-test");
    } finally {
      stub.restore();
    }
  });

  test(`${label}: wash_flagged=false with missing coverage aborts twzrd_wash_unknown; signer 0`, async () => {
    clearPackageEnv();
    const stub = stubFetch(() => card({ wash_flagged: false }));
    try {
      const { client, signerCalls } = await gatedClient();
      await assert.rejects(
        () => pay(client, network, payTo),
        /twzrd_wash_unknown|Payment creation aborted/
      );
      assert.equal(signerCalls(), 0);
    } finally {
      stub.restore();
    }
  });
}

/**
 * BEHAVIOUR CHANGE at twzrd-x402-gate 0.9.9, and the one operators feel.
 *
 * Base is a scored network now, so a 503 from intel is a failed preflight on
 * the scored path, and the documented default there is fail-closed. Before
 * 0.9.9 Base skipped the preflight entirely and the unscored observe path
 * allowed it, so a dead intel service never stopped a Base payment.
 *
 * Base now fails the way Solana always has. TWZRD_FAIL_OPEN=true restores the
 * old availability, asserted immediately below, and an unscored network is
 * unaffected.
 */
test("fast HTTP 503 under TWZRD_FAIL_OPEN=false now refuses on scored Base", async () => {
  clearPackageEnv();
  const stub = stubFetch(() => card({ error: "no" }, 503));
  try {
    const { client, signerCalls } = await gatedClient({ TWZRD_FAIL_OPEN: "false" });
    await assert.rejects(
      () => pay(client, NETWORK_BASE, MONID_X402_PAY_TO),
      /twzrd_fail_closed|Payment creation aborted/
    );
    assert.equal(signerCalls(), 0, "nothing is signed when the gate cannot evaluate");
  } finally {
    stub.restore();
  }
});

/**
 * The escape hatch exists, but it is a PROCESS env var, not the adapter's.
 *
 * Two different fail-open knobs read two different sources: this adapter's
 * `env` option governs its own timeout wrapper (twzrdGateFailOpen), while the
 * gate package resolves its own failOpen from process.env.TWZRD_FAIL_OPEN.
 * Passing TWZRD_FAIL_OPEN through the adapter's env therefore does NOT make
 * the gate fail open on a fast 503. An operator restoring the pre-0.9.9
 * availability has to set it in the process environment.
 */
test("TWZRD_FAIL_OPEN=true in the PROCESS env restores the pre-0.9.9 availability on Base", async () => {
  clearPackageEnv();
  const prev = process.env.TWZRD_FAIL_OPEN;
  process.env.TWZRD_FAIL_OPEN = "true";
  const stub = stubFetch(() => card({ error: "no" }, 503));
  try {
    const { client, signerCalls } = await gatedClient();
    await pay(client, NETWORK_BASE, MONID_X402_PAY_TO);
    assert.equal(signerCalls(), 1, "an operator who wants the old behaviour can have it");
  } finally {
    stub.restore();
    if (prev === undefined) delete process.env.TWZRD_FAIL_OPEN;
    else process.env.TWZRD_FAIL_OPEN = prev;
  }
});

test("the adapter's own env does NOT reach the gate's fail-open", async () => {
  clearPackageEnv();
  const stub = stubFetch(() => card({ error: "no" }, 503));
  try {
    // Same 503, TWZRD_FAIL_OPEN=true passed the way a caller would expect to.
    const { client, signerCalls } = await gatedClient({ TWZRD_FAIL_OPEN: "true" });
    await assert.rejects(
      () => pay(client, NETWORK_BASE, MONID_X402_PAY_TO),
      /twzrd_fail_closed|Payment creation aborted/,
    );
    assert.equal(signerCalls(), 0);
  } finally {
    stub.restore();
  }
});

test("an unscored network still allows on a fast 503 under TWZRD_FAIL_OPEN=false", async () => {
  clearPackageEnv();
  const stub = stubFetch(() => card({ error: "no" }, 503));
  try {
    const { client, signerCalls } = await gatedClient({ TWZRD_FAIL_OPEN: "false" });
    await pay(client, NETWORK_MONAD, MONID_X402_PAY_TO);
    assert.equal(signerCalls(), 1);
  } finally {
    stub.restore();
  }
});

test("outer timeout with TWZRD_FAIL_OPEN=false aborts; signer 0", async () => {
  clearPackageEnv();
  const stub = stubFetch(() => new Promise<Response>(() => {}));
  try {
    const { client, signerCalls } = await gatedClient({
      TWZRD_FAIL_OPEN: "false",
      TWZRD_GATE_TIMEOUT_MS: "25"
    });
    await assert.rejects(() => pay(client, NETWORK_BASE, MONID_X402_PAY_TO), /did not answer|Payment creation aborted/);
    assert.equal(signerCalls(), 0);
  } finally {
    stub.restore();
  }
});

test("outer timeout with default config allows", async () => {
  clearPackageEnv();
  const stub = stubFetch(() => new Promise<Response>(() => {}));
  try {
    const { client, signerCalls } = await gatedClient({ TWZRD_GATE_TIMEOUT_MS: "25" });
    await pay(client, NETWORK_BASE, MONID_X402_PAY_TO);
    assert.equal(signerCalls(), 1);
  } finally {
    stub.restore();
  }
});
