import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../src/app/api/meal-language/route";

function request(text: string, consent = true, origin = "http://127.0.0.1:3000") {
  return new Request("http://127.0.0.1:3000/api/meal-language", { method: "POST", headers: {
    origin, "content-type": "application/json", ...(consent ? { "x-fit-ai-consent": "true" } : {}),
  }, body: JSON.stringify({ text }) });
}
test("meal API requires local origin, explicit consent and bounded input before calling a provider", async () => {
  assert.equal((await POST(request("due uova", false))).status, 403);
  assert.equal((await POST(request("due uova", true, "https://other.example"))).status, 403);
  assert.equal((await POST(request("x".repeat(1501)))).status, 400);
});
test("AI extracts language only and provider responses are checked before returning", async t => {
  const originalFetch = globalThis.fetch;
  const oldFlag = process.env.FIT_ENABLE_AI, oldKey = process.env.OPENAI_API_KEY;
  process.env.FIT_ENABLE_AI = "true"; process.env.OPENAI_API_KEY = "test-not-a-real-key";
  t.after(() => { globalThis.fetch = originalFetch; if (oldFlag === undefined) delete process.env.FIT_ENABLE_AI; else process.env.FIT_ENABLE_AI = oldFlag; if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; });
  const output = { segments: [{ text: "due uova", kind: "food", query: "uova" }] };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.store, false);
    assert.equal(body.messages[1].content, "due uova");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(JSON.stringify(body.response_format.json_schema.schema).includes("per100g"), false);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] });
  };
  const response = await POST(request("due uova"));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), output);
  globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ segments: [{ text: "uova", kind: "food", query: "uova" }] }) } }] });
  assert.equal((await POST(request("due uova"))).status, 502);
  globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "length", message: { content: JSON.stringify(output) } }] });
  assert.equal((await POST(request("due uova"))).status, 502);
});
