/**
 * Jev (TypeSafe AI, jev-1.13.0) transport for the vendor-prescreen cost-skip
 * classifier. Jev answers typed Choice questions over a target URL - it is
 * not a generative model and never decides whether a step is safe, only
 * whether a step is worth attempting. product.ts's resolvePrescreenSkips is
 * the only caller of the fail-closed contract this module returns.
 */
import { PACKAGE_VERSION } from "./constants.js";

export const JEV_MODEL = "jev-1.13.0";
export const TYPESAFE_SYSTEMONE_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_PRESCREEN_TIMEOUT_MS = 1_500;

const SKIP_CHOICES = ["keep", "skip"] as const;
export type SkipChoice = (typeof SKIP_CHOICES)[number];

export type JevChoiceAnswer = {
  choice: SkipChoice | null;
  confidence: number;
};

export type JevPrescreenSkipClassification = {
  model: string;
  securityHeaders: JevChoiceAnswer | null;
  cookieConsent: JevChoiceAnswer | null;
};

export function prescreenSkipRequestBody(targetUrl: string): Record<string, unknown> {
  return {
    model: JEV_MODEL,
    state: targetUrl,
    questions: {
      security_headers: {
        type: "choice",
        instructions:
          "Would inspecting this URL's HTTP security headers (CSP, HSTS, X-Frame-Options, etc.) " +
          "plausibly surface anything for vendor risk screening? Answer `skip` ONLY when the URL " +
          "itself makes clear this has no browser-rendered HTTP surface worth header-checking " +
          "(e.g. a bare machine-to-machine REST/JSON/RPC endpoint). Default to `keep` whenever unsure.",
        criteria: {
          keep: "Worth checking headers before spend.",
          skip: "Obviously no browser-facing surface."
        }
      },
      cookie_consent: {
        type: "choice",
        instructions:
          "Would scanning this URL for cookies/consent banners plausibly surface anything for " +
          "vendor risk screening? Answer `skip` ONLY when the URL itself makes clear there is no " +
          "HTML page or browser session to set cookies on. Default to `keep` whenever unsure.",
        criteria: {
          keep: "Worth scanning before spend.",
          skip: "Obviously no HTML/cookie surface exists."
        }
      }
    }
  };
}

/** Confidence is a 0..1 probability. A finite-but-out-of-range value (e.g. a
 * provider bug returning 0-100 instead of 0-1) must never be treated as
 * usable - it would trivially clear PRESCREEN_SKIP_CONFIDENCE_THRESHOLD and
 * skip a real check on garbage data. */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function choiceAnswer(value: unknown): JevChoiceAnswer | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const confidence = num(rec.confidence);
  if (confidence === null) return null;
  const rawChoice = rec.choice;
  const choice = typeof rawChoice === "string" && (SKIP_CHOICES as readonly string[]).includes(rawChoice)
    ? (rawChoice as SkipChoice)
    // A hallucinated/garbled choice must never be treated as a real answer -
    // same principle as twzrd-intent-gate's catalog-id validation, applied
    // here to this fixed two-value choice set.
    : null;
  return { choice, confidence };
}

export function parsePrescreenSkipResponse(payload: unknown): JevPrescreenSkipClassification | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  const answers = rec.answers;
  if (!answers || typeof answers !== "object") return null;
  const answersRec = answers as Record<string, unknown>;
  const model = typeof rec.model === "string" && rec.model ? rec.model : JEV_MODEL;
  return {
    model,
    securityHeaders: choiceAnswer(answersRec.security_headers),
    cookieConsent: choiceAnswer(answersRec.cookie_consent)
  };
}

export type PrescreenClassifyFn = (
  targetUrl: string,
  options?: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv; timeoutMs?: number }
) => Promise<JevPrescreenSkipClassification | null>;

/**
 * Fail-closed: returns null on any missing key, timeout, non-2xx response,
 * or unparseable payload - never throws. `resolvePrescreenSkips` in
 * product.ts treats null exactly like "keep everything," matching this
 * feature's inverted-from-usual safe default (unlike a typical pre-spend
 * gate, here "unsure" means "run the check," not "don't spend").
 */
export const classifyPrescreenSkip: PrescreenClassifyFn = async (targetUrl, options) => {
  const env = options?.env ?? process.env;
  const apiKey = env.TYPESAFE_API_KEY?.trim() || env.JEV?.trim();
  if (!apiKey) return null;

  const fetchImpl = options?.fetch ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? JEV_PRESCREEN_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(TYPESAFE_SYSTEMONE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": `monid-x402/${PACKAGE_VERSION}`
      },
      body: JSON.stringify(prescreenSkipRequestBody(targetUrl)),
      signal: controller.signal
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return parsePrescreenSkipResponse(payload);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};
