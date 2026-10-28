/**
 * Manage authentication and manual retries for one fixed study request.
 * The returned record methods never expose the API key; clear() releases the
 * client, encrypted key reference, request, and generated text.
 */
const FEEDBACK_SESSION_FIELDS = Object.freeze([
  "authentication_succeeded", "generation_attempt", "system_prompt", "api_input",
  "model", "reasoning_effort", "temperature", "max_output_tokens",
  "response_model", "api_response_id", "ai_feedback", "api_error"
]);

function createFeedbackSession({
  encryptedApiKey, displayElement, generationSettings, getRequest, maxAttempts = 3
}) {
  let encrypted = encryptedApiKey;
  let requestGetter = getRequest;
  let client = null;
  let request = null;
  let requestInitialized = false;
  let attempt = 0;
  let feedback = null;
  let lastError = null;
  let terminationReason = null;
  let generationSucceeded = false;
  let closed = false;

  const setStatus = text => {
    if (displayElement) displayElement.textContent = text;
  };
  const settings = Object.freeze({ ...generationSettings });

  return {
    async authenticate() {
      let authenticationSucceeded = false;
      setStatus("実験を準備しています。");
      try {
        if (closed || terminationReason !== null) throw new Error("Session is not active");
        client = createClient(encrypted);
        encrypted = null;
        await client.authenticate();
        authenticationSucceeded = client.isAuthenticated();
      } catch {
        terminationReason = "authentication_error";
      } finally {
        setStatus("");
      }
      return { authentication_succeeded: authenticationSucceeded };
    },

    async generate() {
      if (closed || generationSucceeded || terminationReason !== null) {
        return {
          generation_attempt: attempt,
          system_prompt: request?.systemPrompt ?? null,
          api_input: request?.text ?? null,
          model: settings.model,
          reasoning_effort: settings.reasoningEffort,
          temperature: settings.temperature,
          max_output_tokens: settings.maxOutputTokens,
          response_model: null,
          api_response_id: null,
          ai_feedback: null,
          api_error: { http_status: null, retryable: false, code: "session_not_active" }
        };
      }
      attempt += 1;
      lastError = null;
      feedback = null;
      setStatus("AIがフィードバックを作成しています。");

      const record = {
        generation_attempt: attempt,
        system_prompt: null,
        api_input: null,
        model: settings.model,
        reasoning_effort: settings.reasoningEffort,
        temperature: settings.temperature,
        max_output_tokens: settings.maxOutputTokens,
        response_model: null,
        api_response_id: null,
        ai_feedback: null,
        api_error: null
      };

      try {
        if (!requestInitialized) {
          requestInitialized = true;
          const readRequest = requestGetter;
          requestGetter = null;
          const { systemPrompt, text } = readRequest();
          request = Object.freeze({ systemPrompt, text });
        }
        record.system_prompt = request.systemPrompt;
        record.api_input = request.text;
        const result = await client.generate({ ...settings, ...request });
        feedback = result.text;
        generationSucceeded = true;
        record.ai_feedback = result.text;
        record.response_model = result.model;
        record.api_response_id = result.responseId;
      } catch (failure) {
        lastError = classifyError(failure ?? new Error("Unknown generation failure"));
        record.api_error = lastError;
        if (!lastError.retryable) terminationReason = "non_retryable_error";
        else if (attempt >= maxAttempts) terminationReason = "max_attempts_reached";
      } finally {
        setStatus("");
      }
      return record;
    },

    recordTrialData(data) {
      if (data.value && typeof data.value === "object") {
        for (const field of FEEDBACK_SESSION_FIELDS) {
          if (Object.prototype.hasOwnProperty.call(data.value, field)) data[field] = data.value[field];
        }
      }
      delete data.value;
      return data;
    },

    clear() {
      client?.clear();
      client = null;
      encrypted = null;
      requestGetter = null;
      request = null;
      feedback = null;
      lastError = null;
      closed = true;
    },

    get feedback() { return feedback; },
    get attempt() { return attempt; },
    get canRetry() {
      return lastError !== null && lastError.retryable
        && attempt < maxAttempts && terminationReason === null;
    },
    get terminationReason() { return terminationReason; }
  };
}
