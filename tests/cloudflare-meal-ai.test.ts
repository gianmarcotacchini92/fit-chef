import assert from "node:assert/strict";
import test from "node:test";
import worker, { verifyFirebaseToken } from "../cloudflare/meal-ai-worker";

const env = {
  AI: { run: async () => { throw new Error("AI must not be called for unauthorized users"); } },
  FIREBASE_PROJECT_ID: "fit-test-project", ALLOWED_FIREBASE_UID: "known-user",
  ALLOWED_ORIGIN: "https://gianmarcotacchini92.github.io",
};

test("Cloudflare AI gateway rejects requests missing or mismatching Origin", async () => {
  const request = new Request("https://fit-diario-ai.workers.dev", { method: "POST",
    headers: { "Content-Type": "application/json", "x-fit-ai-consent": "true" }, body: JSON.stringify({text: "2 fette torta rustica"}) });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 403);
  const cross = await worker.fetch(new Request(request, { headers: { Origin: "https://attacker.example" } }), env);
  assert.equal(cross.status, 403);
});

test("CORS preflight is empty and scoped to the configured domain", async () => {
  const response = await worker.fetch(new Request("https://fit-diario-ai.workers.dev", {
    method: "OPTIONS", headers: { Origin: env.ALLOWED_ORIGIN },
  }), env);
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), env.ALLOWED_ORIGIN);
});

test("Cloudflare AI gateway requires explicit consent and valid user authentication", async () => {
  const request = (consent: string) => new Request("https://fit-diario-ai.workers.dev", {
    method: "POST", headers: { Origin: env.ALLOWED_ORIGIN, "Content-Type": "application/json", "X-Fit-AI-Consent": consent },
    body: JSON.stringify({text: "2 fette torta rustica"}),
  });
  assert.equal((await worker.fetch(request("false"), env)).status, 403);
  assert.equal((await worker.fetch(request("true"), env)).status, 401);
  assert.equal(await verifyFirebaseToken("malformed", env.FIREBASE_PROJECT_ID, env.ALLOWED_FIREBASE_UID), false);
});

test("Missing safety configuration prevents use, regardless of supplied headers", async () => {
  const request = new Request("https://fit-diario-ai.workers.dev", {
    method: "OPTIONS", headers: { Origin: env.ALLOWED_ORIGIN },
  });
  const response = await worker.fetch(request, { ...env, ALLOWED_FIREBASE_UID: "" });
  assert.equal(response.status, 403);
});
