/* jspsych-openai-utils browser bundle. No API keys are embedded. */

(() => {

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

/**
 * Create an LLM client that keeps a decrypted key in a private closure.
 * This API is independent of jsPsych and returns no key value.
 * @param {object} encryptedApiKey
 * @returns {{authenticate: Function, generate: Function, clear: Function, isAuthenticated: Function}}
 */
function createClient(encryptedApiKey) {
  let apiKey = null;
  return {
    async authenticate() {
      apiKey = await getApiKey(encryptedApiKey);
      return true;
    },
    generate(options) {
      if (apiKey === null) throw new Error("Client is not authenticated");
      return generate({ ...options, apiKey });
    },
    clear() {
      apiKey = null;
    },
    isAuthenticated() {
      return apiKey !== null;
    }
  };
}

/** Convert an API failure to safe status fields for study data. */
function classifyError(failure) {
  const nonRetryableCodes = [
    "insufficient_quota",
    "credit_balance_exhausted",
    "project_spend_limit_exceeded",
    "organization_spend_limit_exceeded",
    "organization_usage_limit_exceeded"
  ];
  const retryable = failure.message === "OpenAI network error or timeout"
    || (failure.status === 429 && !nonRetryableCodes.includes(failure.code))
    || failure.status >= 500 || failure.name === "SyntaxError";
  const knownCodes = [...nonRetryableCodes, "invalid_api_key", "model_not_found"];
  return {
    http_status: failure.status ?? null,
    retryable,
    code: knownCodes.includes(failure.code) ? failure.code : "generation_failed"
  };
}

/** Escape participant text before placing it in an HTML fragment. */
function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
}

/** Validate nonblank text without rewriting it; an optional field may be left empty. */
function bindNonBlankText(form, fieldName, { optionalWhen = () => false } = {}) {
  const field = form.elements.namedItem(fieldName);
  const validate = () => {
    const optional = optionalWhen();
    const optionalEmpty = field.value === "" && optional;
    field.required = !optional;
    field.setCustomValidity(/\S/.test(field.value) || optionalEmpty
      ? "" : "空白以外の文字を入力してください。");
  };
  field.addEventListener("input", validate);
  form.addEventListener("change", validate);
  validate();
  return validate;
}

  window.FeedbackUtils = Object.freeze({ getApiKey, generate, decryptApiKey, createClient, classifyError, escapeHtml, bindNonBlankText });

})();

