// Optional legacy jsPsych adapters. New experiments may keep all trial logic locally.
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
        error = classifyError(failure);
        record.api_error = error;
        if (!error.retryable) onStop("non_retryable_error");
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
