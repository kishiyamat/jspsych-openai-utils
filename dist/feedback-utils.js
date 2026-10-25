/* jspsych-openai-utils — browser bundle. No API keys are embedded. */
(()=>{
"use strict";
// Password-protected API keys: PBKDF2-SHA256 + AES-256-GCM.
function decodeBase64(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

async function decryptApiKey(encrypted, password) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("HTTPS or localhost is required.");
  }
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2", salt: decodeBase64(encrypted.salt),
      iterations: encrypted.iterations, hash: "SHA-256"
    },
    material, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
  );
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64(encrypted.iv), tagLength: 128 },
    key, decodeBase64(encrypted.ciphertext)
  );
  return new TextDecoder().decode(bytes);
}

// OpenAI Responses API. No experiment-specific prompts or keys.
async function generate({ apiKey, model = "gpt-5-mini", systemPrompt, text,
                          reasoningEffort = null, temperature = null,
                          maxOutputTokens = 1000, timeoutMs = 90000 }) {
  const body = {
    model, instructions: systemPrompt, input: text,
    max_output_tokens: maxOutputTokens, store: false
  };
  if (reasoningEffort !== null) body.reasoning = { effort: reasoningEffort };
  if (temperature !== null) body.temperature = temperature;
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw new Error("OpenAI network error or timeout", { cause: error });
  }
  const json = await response.json();
  if (!response.ok) {
    const error = new Error("OpenAI API returned HTTP " + response.status);
    error.status = response.status;
    error.code = json.error?.code ?? null;
    throw error;
  }
  if (json.status !== "completed") {
    throw new Error("OpenAI response not completed: " + (json.status ?? "unknown"));
  }
  const output = (json.output ?? []).filter(item => item.type === "message")
    .flatMap(item => item.content ?? []);
  if (output.some(item => item.type === "refusal")) {
    throw new Error("OpenAI declined the request");
  }
  const feedback = output.filter(item => item.type === "output_text")
    .map(item => item.text ?? "").join("").trim();
  if (!feedback) throw new Error("OpenAI returned empty text");
  return { text: feedback, model: json.model ?? model, responseId: json.id ?? null };
}

// Minimal browser UI for entering the shared experiment password.
async function getApiKey(encrypted) {
  if (!encrypted?.salt || !encrypted?.iv || !encrypted?.ciphertext) {
    throw new Error("Encrypted API key object is required");
  }
  const form = document.createElement("form");
  form.style.cssText = "max-width:480px;margin:60px auto";
  const label = document.createElement("label");
  label.textContent = "実験用パスワード";
  const input = document.createElement("input");
  input.type = "password";
  input.required = true;
  input.style.width = "100%";
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  const button = document.createElement("button");
  button.textContent = "開始";
  label.append(input);
  form.append(label, message, button);
  document.body.append(form);
  input.focus();
  try {
    while (true) {
      const password = await new Promise(resolve => {
        form.onsubmit = event => { event.preventDefault(); resolve(input.value); };
      });
      input.value = "";
      button.disabled = true;
      message.textContent = "確認しています";
      try {
        return await decryptApiKey(encrypted, password);
      } catch (error) {
        if (error.name !== "OperationError") throw error;
        message.textContent = "パスワードが正しくありません";
      } finally {
        button.disabled = false;
        input.focus();
      }
    }
  } finally {
    form.remove();
  }
}

window.FeedbackUtils = Object.freeze({ getApiKey, generate, decryptApiKey });
})();
