const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");
const context = { crypto: crypto.webcrypto, atob, TextEncoder, TextDecoder, Uint8Array };
vm.runInNewContext(`${fs.readFileSync("src/crypto.js", "utf8")}\nglobalThis.decryptApiKeyForTest = decryptApiKey;`, context);

async function main() {
  const password = "fake-password-only-123456789";
  const plaintext = "sk-fake-never-valid";
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const material = await crypto.webcrypto.subtle.importKey("raw", Buffer.from(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.webcrypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 1000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const ciphertext = await crypto.webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, Buffer.from(plaintext));
  const encoded = value => Buffer.from(value).toString("base64");
  const decrypted = await context.decryptApiKeyForTest({ salt: encoded(salt), iv: encoded(iv), ciphertext: encoded(ciphertext), iterations: 1000 }, password);
  assert.equal(decrypted, plaintext);
  await assert.rejects(() => context.decryptApiKeyForTest({ salt: encoded(salt), iv: encoded(iv), ciphertext: encoded(ciphertext), iterations: 1000 }, "different-fake-password"));
  console.log("API-key decrypt helper success/failure checks passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
