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
