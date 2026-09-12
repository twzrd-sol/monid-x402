import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MONID_API_URL, MONID_X402_RUN_URL, TWZRD_GATE_PIN } from "./constants.js";
import { ledgerKindFromBody, tryAppendLedger } from "./ledger.js";
import { defaultPolicy, evaluatePaymentRequired } from "./policy.js";
import {
  PRODUCT_SKU,
  holdVendorPrescreenOnListen,
  productCatalog,
  quoteVendorPrescreen,
  runVendorPrescreen
} from "./product.js";
import { probeRun402 } from "./probe.js";
import { refuseReceipt, spendGatedReceipt } from "./receipt.js";
import { parseRunsPath, probeRetrieve402, retrieveRefuse } from "./retrieve.js";
import type { RunTarget } from "./types.js";

export const PREPAID_RUN_URL = `${MONID_API_URL}/run`;

export type ProxyHeaders = Record<string, string | string[] | undefined>;

export type ProxyOptions = {
  listenPort?: number;
  ledgerDir?: string;
};

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8") || "{}";
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function header(headers: ProxyHeaders, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== want) continue;
    if (Array.isArray(value)) return value[0];
    return value;
  }
  return undefined;
}

function confirmSpend(headers: ProxyHeaders): boolean {
  const raw = header(headers, "x-twzrd-confirm-spend");
  return raw === "true" || raw === "1";
}

function maxAmountMicro(headers: ProxyHeaders): bigint {
  const raw = header(headers, "x-twzrd-max-amount-micro");
  if (raw && /^\d+$/.test(raw)) return BigInt(raw);
  return 1n;
}

function guardedFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assertNotPrepaid(url);
    return fetchImpl(input, init);
  };
}

async function forwardMonid(
  path: string,
  body: unknown,
  headers: ProxyHeaders,
  fetchImpl: typeof fetch
): Promise<{ status: number; body: unknown }> {
  const auth = header(headers, "authorization");
  if (!auth) {
    return { status: 401, body: { code: 401, message: "Authorization required" } };
  }
  const url = `${MONID_API_URL}${path}`;
  assertNotPrepaid(url);
  const workspace = header(headers, "x-workspace-id");
  const outbound: Record<string, string> = {
    Authorization: auth,
    "Content-Type": "application/json"
  };
  if (workspace) outbound["x-workspace-id"] = workspace;
  const response = await guardedFetch(fetchImpl)(url, {
    method: "POST",
    headers: outbound,
    body: JSON.stringify(body ?? {})
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: { message: text.slice(0, 240) } };
  }
}

function ledgered(
  status: number,
  body: unknown,
  ledgerDir?: string
): { status: number; body: unknown } {
  tryAppendLedger(ledgerDir, {
    kind: ledgerKindFromBody(body),
    httpStatus: status,
    receipt: body
  });
  return { status, body };
}

export async function handleProxyRequest(
  method: string,
  urlPath: string,
  body: unknown,
  headers: ProxyHeaders = {},
  fetchImpl: typeof fetch = globalThis.fetch,
  options: ProxyOptions = {}
): Promise<{ status: number; body: unknown }> {
  if (method === "GET" && urlPath === "/health") {
    return {
      status: 200,
      body: {
        ok: true,
        rail: "monid-x402",
        listen: String(options.listenPort ?? 8788),
        prepaid_run: false,
        twzrd_gate: TWZRD_GATE_PIN,
        desk: true,
        sku: PRODUCT_SKU
      }
    };
  }

  if (method === "GET" && urlPath.startsWith("/v1/runs")) {
    const parsed = parseRunsPath(urlPath);
    if (parsed.kind === "list") {
      return { status: 501, body: { code: 501, message: "do not forward prepaid run list" } };
    }
    if (parsed.kind === "bad") {
      return { status: 400, body: { code: 400, message: "invalid run id" } };
    }
    const probe = await probeRetrieve402(parsed.runId, guardedFetch(fetchImpl));
    return ledgered(402, retrieveRefuse(probe), options.ledgerDir);
  }

  if (method === "POST" && urlPath === "/v1/discover") {
    return forwardMonid("/discover", body, headers, fetchImpl);
  }

  if (method === "POST" && urlPath === "/v1/inspect") {
    return forwardMonid("/inspect", body, headers, fetchImpl);
  }

  if (method === "GET" && urlPath === "/v1/product") {
    return { status: 200, body: productCatalog() };
  }

  if (method === "POST" && urlPath === "/v1/product/quote") {
    const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const url = String(rec.url ?? rec.targetUrl ?? "");
    if (!url.trim()) {
      return { status: 400, body: { code: 400, message: "url required" } };
    }
    const quote = await quoteVendorPrescreen(url, { fetch: guardedFetch(fetchImpl) });
    const status = quote.nextGate === "confirm_spend" ? 200 : 402;
    return ledgered(status, quote, options.ledgerDir);
  }

  if (method === "POST" && urlPath === "/v1/product/confirm") {
    const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const url = String(rec.url ?? rec.targetUrl ?? "https://example.com");
    return ledgered(
      403,
      {
        ...spendGatedReceipt(
          { provider: PRODUCT_SKU, endpoint: "/quote" },
          MONID_X402_RUN_URL,
          "SKU quote is not enough. Listen has no wallet. Pay is CLI `product --confirm-spend` after a refuse packet."
        ),
        sku: PRODUCT_SKU,
        targetUrl: url
      },
      options.ledgerDir
    );
  }

  if (method === "POST" && urlPath === "/v1/product/run") {
    const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const url = String(rec.url ?? rec.targetUrl ?? "");
    if (!url.trim()) {
      return { status: 400, body: { code: 400, message: "url required" } };
    }
    const quoted = await runVendorPrescreen(url, { fetch: guardedFetch(fetchImpl) });
    if (confirmSpend(headers) || rec.confirmSpend === true) {
      return ledgered(
        403,
        holdVendorPrescreenOnListen(
          quoted,
          "SKU run confirm is not enough. Listen has no wallet. Buyer pays via CLI `product --confirm-spend` after a refuse packet."
        ),
        options.ledgerDir
      );
    }
    const status = quoted.quote.nextGate === "confirm_spend" ? 200 : 402;
    return ledgered(status, quoted, options.ledgerDir);
  }

  if (method === "POST" && urlPath === "/v1/run") {
    if (!body || typeof body !== "object") {
      return { status: 400, body: { code: 400, message: "run body required" } };
    }
    const rec = body as Record<string, unknown>;
    const target: RunTarget = {
      provider: String(rec.provider ?? ""),
      endpoint: String(rec.endpoint ?? ""),
      input: typeof rec.input === "object" && rec.input ? (rec.input as Record<string, unknown>) : {}
    };
    assertNotPrepaid(MONID_X402_RUN_URL);
    const probe = await probeRun402(target, guardedFetch(fetchImpl));
    const verdict = evaluatePaymentRequired(
      probe.paymentRequired,
      defaultPolicy({ maxAmountMicro: maxAmountMicro(headers) })
    );
    if (verdict.decision === "refuse") {
      return ledgered(402, refuseReceipt(target, verdict, MONID_X402_RUN_URL), options.ledgerDir);
    }
    if (!confirmSpend(headers)) {
      return ledgered(
        403,
        spendGatedReceipt(
          target,
          MONID_X402_RUN_URL,
          "policy allow; no X-TWZRD-Confirm-Spend. Listen does not sign."
        ),
        options.ledgerDir
      );
    }
    return ledgered(
      403,
      spendGatedReceipt(
        target,
        MONID_X402_RUN_URL,
        "Listen has no proxy wallet. Confirm is not enough to sign."
      ),
      options.ledgerDir
    );
  }

  return { status: 404, body: { code: 404, message: `no route ${method} ${urlPath}` } };
}

const FRONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../front");
const DESK_HTML = readFileSync(join(FRONT_DIR, "desk.html"), "utf8");
const PRESCREEN_HTML = readFileSync(join(FRONT_DIR, "prescreen.html"), "utf8");

export function startProxy(port = 0): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const bound = { port };
    const server = createServer(async (req, res) => {
      try {
        const urlPath = req.url?.split("?")[0] ?? "/";
        if ((req.method ?? "GET") === "GET" && (urlPath === "/" || urlPath === "/desk")) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(DESK_HTML);
          return;
        }
        if ((req.method ?? "GET") === "GET" && urlPath === "/prescreen") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(PRESCREEN_HTML);
          return;
        }
        const body = req.method === "POST" ? await readJson(req) : {};
        const result = await handleProxyRequest(
          req.method ?? "GET",
          urlPath,
          body,
          req.headers,
          globalThis.fetch,
          {
            listenPort: bound.port,
            ledgerDir: process.env.MONID_LEDGER_DIR ?? "evidence/ledger"
          }
        );
        send(res, result.status, result.body);
      } catch (error) {
        send(res, 500, { code: 500, message: error instanceof Error ? error.message : "proxy error" });
      }
    });
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("proxy bind failed");
      bound.port = addr.port;
      resolve({ server, port: addr.port });
    });
  });
}

export function assertNotPrepaid(url: string): void {
  if (url === PREPAID_RUN_URL || url.startsWith(`${MONID_API_URL}/run`)) {
    throw new Error("Default Path forbids prepaid api.monid.ai/v1/run");
  }
}
