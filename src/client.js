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
