const assert = require("node:assert/strict");
const fs = require("node:fs");
const openaiSource = fs.readFileSync("src/openai.js", "utf8");
const { generate, classifyError } = new Function(`${openaiSource}\nreturn { generate, classifyError };`)();

async function main() {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ id: "resp-fake", status: "completed", model: "fake-model", output: [{ type: "message", content: [{ type: "output_text", text: "safe result" }] }] }), { status: 200 });
  };
  const result = await generate({ apiKey: "sk-fake-never-valid", model: "fake-model", systemPrompt: "prompt", text: "raw text", temperature: 0.3 });
  assert.equal(result.text, "safe result");
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.options.headers.Authorization, "Bearer sk-fake-never-valid");
  const body = JSON.parse(request.options.body);
  assert.equal(body.input, "raw text");
  assert.equal(body.instructions, "prompt");
  assert.equal(body.store, false);
  assert.equal("apiKey" in body, false);
  assert.equal(classifyError(Object.assign(new Error("safe"), { status: 503, code: "server_error" })).retryable, true);
  assert.equal(classifyError(Object.assign(new Error("safe"), { status: 429, code: "credit_balance_exhausted" })).retryable, false);
  assert.equal(classifyError(Object.assign(new Error("safe"), { status: 401, code: "sk-secret-shaped" })).code, "generation_failed");
  console.log("OpenAI request shape and safe classification checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
