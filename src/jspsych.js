// Shared jsPsych trial factories. Study-specific conditions and screens stay in the experiment.
/**
 * Create a jsPsych authentication trial.
 * @param {{jsPsych: object, encryptedApiKey: object, onError?: Function}} options
 * @returns {{trial: object, getApiKey: Function, clearApiKey: Function}}
 * The decrypted key is kept in this closure and is never returned as trial data.
 */
function createAuthenticationTrial({ jsPsych, encryptedApiKey, onError = () => {} }) {
  let apiKey = null;
  const trial = {
    type: jsPsychCallFunction,
    async: true,
    data: { feedback_phase: "authentication" },
    func: async done => {
      jsPsych.getDisplayElement().textContent = "";
      try {
        apiKey = await getApiKey(encryptedApiKey);
      } catch {
        apiKey = null;
        onError();
      }
      done();
    },
    on_finish: data => {
      data.authentication_succeeded = apiKey !== null;
      delete data.value;
    }
  };
  return {
    trial,
    getApiKey: () => apiKey,
    clearApiKey: () => { apiKey = null; }
  };
}

/**
 * Create a jsPsych generation trial with an explicit allowlist of saved fields.
 * @param {{jsPsych: object, getApiKey: Function, getSystemPrompt: Function, getInput: Function, model: string, reasoningEffort?: string|null, temperature?: number|null, maxOutputTokens?: number, maxAttempts?: number, onStart?: Function, onStop?: Function}} options
 * @returns {{trial: object, getAttempt: Function, getError: Function, getFeedback: Function}}
 * The API key is used only for the request and is never included in trial data.
 */
function createGenerationTrial({
  jsPsych,
  getApiKey,
  getSystemPrompt,
  getInput,
  model,
  reasoningEffort = null,
  temperature = null,
  maxOutputTokens = 1000,
  maxAttempts = 3,
  onStart = () => {},
  onStop = () => {}
}) {
  let attempt = 0;
  let error = null;
  let feedback = null;
  const trial = {
    type: jsPsychCallFunction,
    async: true,
    data: { feedback_phase: "generation" },
    func: async done => {
      attempt += 1;
      error = null;
      feedback = null;
      onStart();
      const systemPrompt = getSystemPrompt();
      const input = getInput();
      const record = {
        generation_attempt: attempt,
        system_prompt: systemPrompt,
        api_input: input,
        model,
        reasoning_effort: reasoningEffort,
        temperature,
        max_output_tokens: maxOutputTokens,
        response_model: null,
        api_response_id: null,
        ai_feedback: null,
        api_error: null
      };
      try {
        const result = await generate({
          apiKey: getApiKey(),
          model,
          reasoningEffort,
          temperature,
          maxOutputTokens,
          systemPrompt,
          text: input
        });
        feedback = result.text;
        record.ai_feedback = feedback;
        record.response_model = result.model;
        record.api_response_id = result.responseId;
      } catch (failure) {
        const retryable = failure.message === "OpenAI network error or timeout"
          || (failure.status === 429 && failure.code !== "insufficient_quota")
          || failure.status >= 500 || failure.name === "SyntaxError";
        const knownCodes = ["insufficient_quota", "invalid_api_key", "model_not_found"];
        error = {
          http_status: failure.status ?? null,
          retryable,
          code: knownCodes.includes(failure.code) ? failure.code : "generation_failed"
        };
        record.api_error = error;
        if (!retryable) onStop("non_retryable_error");
        else if (attempt >= maxAttempts) onStop("max_attempts_reached");
      }
      done(record);
    },
    on_finish: data => {
      Object.assign(data, data.value);
      delete data.value;
    }
  };
  return {
    trial,
    getAttempt: () => attempt,
    getError: () => error,
    getFeedback: () => feedback
  };
}
