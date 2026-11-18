const assert = require("node:assert/strict");
const fs = require("node:fs");
const openaiSource = fs.readFileSync("src/openai.js", "utf8");
const { generate, classifyError } = new Function(`${openaiSource}\nreturn { generate: requestFeedback, classifyError };`)();

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

  const imageInput = [{
    role: "user",
    content: [
      { type: "input_text", text: "Read the attached manuscript" },
      { type: "input_image", image_url: "data:image/png;base64,YWJj" }
    ]
  }];
  const imageResult = await generate({
    apiKey: "sk-fake-never-valid",
    model: "fake-model",
    systemPrompt: "prompt",
    text: "legacy text must not be sent",
    input: imageInput
  });
  assert.equal(imageResult.text, "safe result");
  const imageBody = JSON.parse(request.options.body);
  assert.deepEqual(imageBody.input, imageInput);
  assert.equal(imageBody.instructions, "prompt");
  assert.equal(imageBody.store, false);
  assert.equal("text" in imageBody, false);
  assert.equal("apiKey" in imageBody, false);

  // The optional input can also carry ordinary text directly.
  await generate({ apiKey: "sk-fake-never-valid", model: "fake-model", systemPrompt: "prompt", input: "direct input" });
  assert.equal(JSON.parse(request.options.body).input, "direct input");
  assert.equal(classifyError(Object.assign(new Error("safe"), { status: 503, code: "server_error" })).retryable, true);
  assert.equal(classifyError(Object.assign(new Error("safe"), { status: 429, code: "credit_balance_exhausted" })).retryable, false);
  assert.equal(classifyError(Object.assign(new Error("safe"), { status: 401, code: "sk-secret-shaped" })).code, "generation_failed");
  console.log("OpenAI request shape and safe classification checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
