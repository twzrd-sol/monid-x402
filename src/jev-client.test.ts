import assert from "node:assert/strict";
import { test } from "node:test";
import {
  JEV_MODEL,
  TYPESAFE_SYSTEMONE_URL,
  classifyPrescreenSkip,
  parsePrescreenSkipResponse,
  prescreenSkipRequestBody
} from "./jev-client.js";

function jevFetch(payload: unknown, status = 200): typeof fetch {
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.equal(url, TYPESAFE_SYSTEMONE_URL);
    return new Response(JSON.stringify(payload), { status });
  };
}

test("prescreenSkipRequestBody pins the model and carries only the target URL as state", () => {
  const body = prescreenSkipRequestBody("https://api.example.com/v1/prices");
  assert.equal(body.model, JEV_MODEL);
  assert.equal(body.state, "https://api.example.com/v1/prices");
  assert.deepEqual(Object.keys(body.questions as Record<string, unknown>), [
    "security_headers",
    "cookie_consent"
  ]);
});

test("parsePrescreenSkipResponse parses a well-formed answer", () => {
  const parsed = parsePrescreenSkipResponse({
    model: "jev-1.13.0",
    answers: {
      security_headers: { choice: "keep", confidence: 0.91 },
      cookie_consent: { choice: "skip", confidence: 0.88 }
    }
  });
  assert.deepEqual(parsed, {
    model: "jev-1.13.0",
    securityHeaders: { choice: "keep", confidence: 0.91 },
    cookieConsent: { choice: "skip", confidence: 0.88 }
  });
});

test("parsePrescreenSkipResponse rejects a hallucinated choice without dropping the confidence", () => {
  const parsed = parsePrescreenSkipResponse({
    answers: {
      security_headers: { choice: "maybe", confidence: 0.7 },
      cookie_consent: { choice: "skip", confidence: 0.9 }
    }
  });
  assert.deepEqual(parsed?.securityHeaders, { choice: null, confidence: 0.7 });
  assert.deepEqual(parsed?.cookieConsent, { choice: "skip", confidence: 0.9 });
});

test("parsePrescreenSkipResponse returns null for a missing/malformed answers object", () => {
  assert.equal(parsePrescreenSkipResponse({}), null);
  assert.equal(parsePrescreenSkipResponse({ answers: "nope" }), null);
  assert.equal(parsePrescreenSkipResponse(null), null);
});

test("parsePrescreenSkipResponse rejects an out-of-range confidence instead of treating it as usable", () => {
  const parsed = parsePrescreenSkipResponse({
    answers: {
      // e.g. a provider bug returning a 0-100 scale instead of 0-1 - if
      // accepted, 88 would trivially clear PRESCREEN_SKIP_CONFIDENCE_THRESHOLD.
      security_headers: { choice: "skip", confidence: 88 },
      cookie_consent: { choice: "skip", confidence: -0.1 }
    }
  });
  assert.equal(parsed?.securityHeaders, null);
  assert.equal(parsed?.cookieConsent, null);
});

test("parsePrescreenSkipResponse returns null for a sub-answer missing confidence", () => {
  const parsed = parsePrescreenSkipResponse({
    answers: { security_headers: { choice: "keep" }, cookie_consent: { choice: "skip", confidence: 0.9 } }
  });
  assert.equal(parsed?.securityHeaders, null);
});

test("classifyPrescreenSkip returns null with no TYPESAFE_API_KEY, without calling fetch", async () => {
  let called = false;
  const result = await classifyPrescreenSkip("https://api.example.com/v1/prices", {
    env: {},
    fetch: async () => {
      called = true;
      throw new Error("must not be called");
    }
  });
  assert.equal(result, null);
  assert.equal(called, false);
});

test("classifyPrescreenSkip returns a classification on a real key and a 200 response", async () => {
  const result = await classifyPrescreenSkip("https://api.example.com/v1/prices", {
    env: { TYPESAFE_API_KEY: "test-key" },
    fetch: jevFetch({
      model: "jev-1.13.0",
      answers: {
        security_headers: { choice: "keep", confidence: 0.9 },
        cookie_consent: { choice: "skip", confidence: 0.88 }
      }
    })
  });
  assert.deepEqual(result, {
    model: "jev-1.13.0",
    securityHeaders: { choice: "keep", confidence: 0.9 },
    cookieConsent: { choice: "skip", confidence: 0.88 }
  });
});

test("classifyPrescreenSkip returns null on a non-2xx response", async () => {
  const result = await classifyPrescreenSkip("https://api.example.com/v1/prices", {
    env: { TYPESAFE_API_KEY: "test-key" },
    fetch: jevFetch({ error: "internal" }, 500)
  });
  assert.equal(result, null);
});

test("classifyPrescreenSkip returns null on malformed JSON / a fetch throw", async () => {
  const result = await classifyPrescreenSkip("https://api.example.com/v1/prices", {
    env: { TYPESAFE_API_KEY: "test-key" },
    fetch: async () => {
      throw new TypeError("network down");
    }
  });
  assert.equal(result, null);
});

test("classifyPrescreenSkip returns null on timeout", async () => {
  const result = await classifyPrescreenSkip("https://api.example.com/v1/prices", {
    env: { TYPESAFE_API_KEY: "test-key" },
    timeoutMs: 5,
    fetch: (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })
  });
  assert.equal(result, null);
});
