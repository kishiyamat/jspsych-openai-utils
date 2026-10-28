/* jspsych-openai-utils browser bundle. No API keys are embedded. */

(() => {

  "use strict";

// Password-protected API keys: PBKDF2-SHA256 + AES-256-GCM.
function decodeBase64(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

async function decryptKey(encrypted, password) {
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
async function requestFeedback({ apiKey, model = "gpt-5-mini", systemPrompt, text,
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
  const retryAfterMs = parseRetryAfter(response.headers?.get("Retry-After"));
  let json;
  try {
    json = await response.json();
  } catch (error) {
    if (!response.ok) {
      const failure = new Error("OpenAI API returned HTTP " + response.status);
      failure.status = response.status;
      failure.retryAfterMs = retryAfterMs;
      throw failure;
    }
    throw error;
  }
  if (!response.ok) {
    const error = new Error("OpenAI API returned HTTP " + response.status);
    error.status = response.status;
    error.code = json.error?.code ?? null;
    error.retryAfterMs = retryAfterMs;
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

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/** Classify an API error without returning its raw message or unknown code. */
function classifyError(failure) {
  const error = failure ?? {};
  const nonRetryableCodes = [
    "insufficient_quota", "credit_balance_exhausted",
    "project_spend_limit_exceeded", "organization_spend_limit_exceeded",
    "organization_usage_limit_exceeded"
  ];
  const retryable = !nonRetryableCodes.includes(error.code)
    && (error.message === "OpenAI network error or timeout"
      || error.status === 429 || error.status >= 500 || error.name === "SyntaxError");
  const knownCodes = [...nonRetryableCodes, "invalid_api_key", "model_not_found"];
  return {
    http_status: error.status ?? null,
    retryable,
    code: knownCodes.includes(error.code) ? error.code : "generation_failed"
  };
}


// Keep the decrypted key inside this utility; jsPsych receives only safe records.
let activeApiKey = null;

function decryptApiKey(encrypted, password, done) {
  decryptKey(encrypted, password).then(key => {
    activeApiKey = key;
    done({ authentication_succeeded: true, authentication_error: null });
  }, error => {
    activeApiKey = null;
    done({ authentication_succeeded: false,
      authentication_error: error?.name === "OperationError" ? "wrong_password" : "decryption_error" });
  });
}

const MAX_API_ATTEMPTS = 5;
const MAX_RETRY_AFTER_MS = 30000;
const MAX_BACKOFF_MS = 8000;

function retryDelay(error, attempt) {
  if (Number.isFinite(error?.retryAfterMs)) {
    return error.retryAfterMs <= MAX_RETRY_AFTER_MS ? error.retryAfterMs : null;
  }
  const backoff = Math.min(500 * (2 ** (attempt - 1)), MAX_BACKOFF_MS);
  return Math.round(Math.min(MAX_BACKOFF_MS, backoff * (0.5 + Math.random())));
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function generate(options, done) {
  if (!activeApiKey) {
    done({ generation_attempt: 0, api_attempts: [], response_model: null,
      api_response_id: null, ai_feedback: null,
      api_error: { http_status: null, retryable: false, code: "not_authenticated" } });
    return;
  }

  const api_attempts = [];
  let result = null;
  let api_error = null;
  for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt += 1) {
    try {
      result = await requestFeedback({ ...options, apiKey: activeApiKey });
      api_error = null;
      api_attempts.push({ attempt, error: null });
      break;
    } catch (failure) {
      api_error = classifyError(failure ?? new Error("Unknown failure"));
      api_attempts.push({ attempt, error: api_error });
      if (!api_error.retryable || attempt === MAX_API_ATTEMPTS) break;
      const delay = retryDelay(failure, attempt);
      if (delay === null) break;
      await wait(delay);
    }
  }

  if (api_error) {
    done({ generation_attempt: api_attempts.length, api_attempts,
      response_model: null, api_response_id: null, ai_feedback: null, api_error });
    return;
  }

  done({ generation_attempt: api_attempts.length, api_attempts,
    response_model: result.model, api_response_id: result.responseId,
    ai_feedback: result.text, api_error: null });
}

function clearKey() {
  activeApiKey = null;
}

  window.FeedbackUtils = Object.freeze({ decryptApiKey, generate, clearKey });

})();

