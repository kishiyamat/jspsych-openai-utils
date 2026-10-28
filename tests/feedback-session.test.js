const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

let mode = "success";
let calls = [];
let clientCreated = 0;
let keySeen = null;
let cleared = false;
const client = {
  async authenticate() {
    if (mode === "auth_error") throw new Error("private sentinel");
  },
  isAuthenticated() { return mode !== "auth_error"; },
  async generate(request) {
    calls.push(request);
    if (mode === "503") throw Object.assign(new Error("private sentinel"), { status: 503, code: "server_error" });
    if (mode === "quota") throw Object.assign(new Error("private sentinel"), { status: 429, code: "insufficient_quota" });
    return { text: "safe feedback", model: "mock-model", responseId: "mock-response" };
  },
  clear() { cleared = true; }
};

const context = {
  createClient(encrypted) { clientCreated += 1; keySeen = encrypted; return client; },
  classifyError(failure) {
    const retryable = failure.status === 503;
    return { http_status: failure.status ?? null, retryable, code: retryable ? "server_error" : "insufficient_quota" };
  }
};
vm.runInNewContext(`${fs.readFileSync("src/session.js", "utf8")}\nglobalThis.createFeedbackSession = createFeedbackSession;`, context);

async function main() {
  const display = { textContent: "" };
  const encrypted = { ciphertext: "fake-only" };
  const settings = { model: "mock-model", reasoningEffort: "none", temperature: 0.3, maxOutputTokens: 8 };
  let currentPrompt = "prompt A";
  let currentText = "  raw input\n";
  let requestReads = 0;
  const session = context.createFeedbackSession({
    encryptedApiKey: encrypted,
    displayElement: display,
    generationSettings: settings,
    getRequest: () => { requestReads += 1; return { systemPrompt: currentPrompt, text: currentText }; },
    maxAttempts: 2
  });

  assert.equal(clientCreated, 0, "client and key access must be lazy until auth");
  const authRow = { value: await session.authenticate() };
  session.recordTrialData(authRow);
  assert.deepEqual(JSON.parse(JSON.stringify(authRow)), { authentication_succeeded: true });
  assert.equal(JSON.stringify(authRow).includes("fake-only"), false);
  assert.equal(clientCreated, 1);
  assert.equal(keySeen, encrypted);

  mode = "503";
  const failed = await session.generate();
  assert.equal(failed.generation_attempt, 1);
  assert.equal(failed.system_prompt, "prompt A");
  assert.equal(failed.api_input, "  raw input\n");
  assert.equal(failed.ai_feedback, null);
  assert.deepEqual(JSON.parse(JSON.stringify(failed.api_error)), { http_status: 503, retryable: true, code: "server_error" });
  assert.equal(JSON.stringify(failed).includes("private sentinel"), false);
  assert.equal(session.canRetry, true);

  currentPrompt = "prompt B";
  currentText = "changed input";
  mode = "success";
  const succeeded = await session.generate();
  assert.equal(succeeded.generation_attempt, 2);
  assert.equal(succeeded.system_prompt, "prompt A");
  assert.equal(succeeded.api_input, "  raw input\n");
  assert.equal(succeeded.ai_feedback, "safe feedback");
  assert.equal(session.feedback, "safe feedback");
  assert.equal(session.canRetry, false);
  assert.deepEqual(calls.map(({ systemPrompt, text }) => ({ systemPrompt, text })), [
    { systemPrompt: "prompt A", text: "  raw input\n" },
    { systemPrompt: "prompt A", text: "  raw input\n" }
  ]);
  assert.equal(requestReads, 1, "request settings are read once and frozen across retry");

  const trialData = { value: succeeded };
  session.recordTrialData(trialData);
  assert.equal("value" in trialData, false);
  assert.equal(trialData.ai_feedback, "safe feedback");
  assert.equal(JSON.stringify(trialData).includes("private sentinel"), false);
  const injectedValue = {
    value: {
      authentication_succeeded: true,
      generation_attempt: 2,
      api_input: "approved field",
      trial_index: 900,
      feedback_session_id: "private sentinel",
      apiKey: "private sentinel",
      private_sentinel: "private sentinel"
    }
  };
  session.recordTrialData(injectedValue);
  assert.equal(injectedValue.api_input, "approved field");
  assert.equal("trial_index" in injectedValue, false);
  assert.equal("feedback_session_id" in injectedValue, false);
  assert.equal("apiKey" in injectedValue, false);
  assert.equal("private_sentinel" in injectedValue, false);
  assert.equal(JSON.stringify(injectedValue).includes("private sentinel"), false);
  const callCountAfterSuccess = calls.length;
  const duplicateAfterSuccess = await session.generate();
  assert.equal(calls.length, callCountAfterSuccess, "a successful request cannot be sent again");
  assert.equal(duplicateAfterSuccess.api_error.code, "session_not_active");
  session.clear();
  assert.equal(cleared, true);
  assert.equal(session.feedback, null, "clear releases the last generated feedback");
  assert.equal(session.attempt, 2, "attempt count remains available for the finish row");
  const callCountAfterClear = calls.length;
  await session.generate();
  assert.equal(calls.length, callCountAfterClear, "clear closes the session without another request");

  mode = "quota";
  const exhausted = context.createFeedbackSession({
    encryptedApiKey: encrypted, displayElement: null, generationSettings: settings,
    getRequest: () => ({ systemPrompt: "p", text: "x" }), maxAttempts: 3
  });
  await exhausted.authenticate();
  const quotaRow = await exhausted.generate();
  assert.equal(quotaRow.api_error.retryable, false);
  assert.equal(exhausted.canRetry, false);
  assert.equal(exhausted.terminationReason, "non_retryable_error");

  mode = "503";
  const limited = context.createFeedbackSession({
    encryptedApiKey: encrypted, displayElement: null, generationSettings: settings,
    getRequest: () => ({ systemPrompt: "p", text: "x" }), maxAttempts: 1
  });
  await limited.authenticate();
  const limitedRow = await limited.generate();
  assert.equal(limitedRow.generation_attempt, 1);
  assert.equal(limited.canRetry, false);
  assert.equal(limited.terminationReason, "max_attempts_reached");

  mode = "auth_error";
  const authFailure = context.createFeedbackSession({
    encryptedApiKey: encrypted, displayElement: null, generationSettings: settings,
    getRequest: () => ({ systemPrompt: "p", text: "x" }), maxAttempts: 3
  });
  const authFailureRow = await authFailure.authenticate();
  assert.equal(authFailureRow.authentication_succeeded, false);
  assert.equal(authFailure.terminationReason, "authentication_error");

  mode = "success";
  const nullFailure = context.createFeedbackSession({
    encryptedApiKey: encrypted, displayElement: null, generationSettings: settings,
    getRequest: () => { throw null; }
  });
  await nullFailure.authenticate();
  const nullFailureRow = await nullFailure.generate();
  assert.equal(nullFailureRow.ai_feedback, null);
  assert.equal(nullFailureRow.api_error.retryable, false);
  assert.equal(nullFailure.terminationReason, "non_retryable_error");

  mode = "success";
  const manual = context.createFeedbackSession({
    encryptedApiKey: null, displayElement: null, generationSettings: settings,
    getRequest: () => ({ systemPrompt: "p", text: "x" }), maxAttempts: 3
  });
  const createdBeforeManual = clientCreated;
  assert.equal(manual.feedback, null);
  assert.equal(clientCreated, createdBeforeManual, "manual condition does not create a client unless auth is called");
  console.log("feedback session contracts passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
