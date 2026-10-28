const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");
const context = {
  crypto: crypto.webcrypto, atob, TextEncoder, TextDecoder, Uint8Array, AbortSignal,
  fetch: async (_url, options) => {
    context.requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ id: "resp-fake", status: "completed", model: "fake-model", output: [{ type: "message", content: [{ type: "output_text", text: "safe result" }] }] }), { status: 200 });
  }
};
vm.runInNewContext(`${fs.readFileSync("src/crypto.js", "utf8")}\n${fs.readFileSync("src/openai.js", "utf8")}\nglobalThis.testApi = { decryptApiKey, generate, clearKey };`, context);

function call(name, ...args) {
  return new Promise(resolve => context.testApi[name](...args, resolve));
}

async function main() {
  const password = "fake-password-only-123456789";
  const plaintext = "sk-fake-never-valid";
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const material = await crypto.webcrypto.subtle.importKey("raw", Buffer.from(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.webcrypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 1000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const ciphertext = await crypto.webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, Buffer.from(plaintext));
  const encoded = value => Buffer.from(value).toString("base64");
  const encrypted = { salt: encoded(salt), iv: encoded(iv), ciphertext: encoded(ciphertext), iterations: 1000 };
  const auth = await call("decryptApiKey", encrypted, password);
  assert.equal(auth.authentication_succeeded, true);
  assert.equal(JSON.stringify(auth).includes(plaintext), false);
  const generated = await call("generate", { model: "fake-model", systemPrompt: "prompt", text: "raw text" });
  assert.equal(generated.ai_feedback, "safe result");
  assert.equal(context.requestBody.input, "raw text");
  assert.equal(context.requestBody.instructions, "prompt");
  assert.equal("apiKey" in context.requestBody, false);
  assert.equal(JSON.stringify(generated).includes(plaintext), false);
  context.testApi.clearKey();
  const cleared = await call("generate", { model: "fake-model", systemPrompt: "prompt", text: "raw text" });
  assert.equal(cleared.ai_feedback, null);
  assert.equal(cleared.api_error.retryable, false);
  const wrong = await call("decryptApiKey", encrypted, "wrong fake password that is long enough");
  assert.equal(wrong.authentication_succeeded, false);
  assert.equal(JSON.stringify(wrong).includes(plaintext), false);
  console.log("utility callback API key privacy and safe record checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
