const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("src/runner.js", "utf8")
  .replace('new URL("./feedback-utils.js", import.meta.url).href', '"https://mock.test/dist/feedback-utils.js"')
  .replace("await import(coreLibraryUrl);", "await window._loadCore();")
  .replace("export { createFeedbackFlow };", "window.FeedbackRunner = { createFeedbackFlow };");
const calls = [];
const displayElement = { textContent: "" };
let helperReads = 0;
let keyReads = 0;
let importCount = 0;
let importFailure = false;
let session;
const helper = {
  createFeedbackSession(options) {
    calls.push(["create-session", options.encryptedApiKey]);
    return session;
  },
  bindNonBlankText() {},
  escapeHtml(value) { return String(value); }
};
const window = {};
window._loadCore = async () => {
  importCount += 1;
  if (importFailure) throw new Error("mock import failure");
  window.FeedbackUtils = helper;
};
Object.defineProperty(window, "FeedbackUtils", {
  get() { helperReads += 1; return this._helper; },
  set(value) { this._helper = value; }
});
const context = {
  window,
  import: async url => {
    importCount += 1;
    assert.equal(url, "https://mock.test/dist/feedback-utils.js");
    if (importFailure) throw new Error("mock import failure");
    window.FeedbackUtils = helper;
  }
};
vm.runInNewContext(source, context);

async function prepare(flow) {
  let value;
  await flow.preparationTrial.func(result => { value = result; });
  const row = { value };
  flow.preparationTrial.on_finish(row);
  assert.equal(row.helper_loaded, true);
  assert.equal("value" in row, false);
}

async function main() {
  session = {
    authenticate: async () => ({ authentication_succeeded: true }),
    generate: async () => ({ generation_attempt: 1, ai_feedback: "draft" }),
    recordTrialData: data => { calls.push(["record", data.feedback_phase]); },
    clear() { calls.push(["clear"]); },
    feedback: "draft",
    attempt: 1,
    canRetry: false,
    terminationReason: null
  };
  const display = () => { calls.push(["display"]); return displayElement; };
  const flow = window.FeedbackRunner.createFeedbackFlow({
    callFunctionPlugin: "call-function",
    getDisplayElement: display,
    getEncryptedApiKey: () => { keyReads += 1; return { version: 1 }; },
    generationSettings: { model: "mock-model" },
    getRequest: () => ({ systemPrompt: "p", text: "x" }),
    maxAttempts: 3
  });

  assert.equal(keyReads, 0, "constructing a flow does not read the key");
  assert.equal(helperReads, 0, "constructing a flow does not read the core helper");
  assert.equal(flow.preparationTrial.type, "call-function");
  assert.equal(flow.authenticationTrial.data.feedback_phase, "authentication");
  assert.equal(flow.generationTrial.data.feedback_phase, "generation");
  await prepare(flow);
  assert.equal(keyReads, 1);
  assert.equal(importCount, 1);
  assert.equal(displayElement.textContent, "");
  assert.deepEqual(calls.find(item => item[0] === "create-session"), ["create-session", { version: 1 }]);

  const authRecord = await new Promise(resolve => flow.authenticationTrial.func(resolve));
  flow.authenticationTrial.on_finish({ feedback_phase: "authentication" });
  const generationRecord = await new Promise(resolve => flow.generationTrial.func(resolve));
  flow.generationTrial.on_finish({ feedback_phase: "generation" });
  assert.equal(authRecord.authentication_succeeded, true);
  assert.equal(generationRecord.ai_feedback, "draft");
  assert.equal(flow.feedback, "draft");
  assert.equal(flow.attempt, 1);
  assert.equal(flow.canRetry, false);
  assert.equal(flow.terminationReason, null);
  flow.clear();
  assert.equal(calls.some(item => item[0] === "clear"), true);

  window.FeedbackUtils = undefined;
  importFailure = true;
  const failedFlow = window.FeedbackRunner.createFeedbackFlow({
    callFunctionPlugin: "call-function",
    getDisplayElement: display,
    getEncryptedApiKey: () => { keyReads += 1; return { version: 1 }; },
    generationSettings: {},
    getRequest: () => ({})
  });
  let failedValue;
  await failedFlow.preparationTrial.func(result => { failedValue = result; });
  const failedRow = { value: failedValue };
  failedFlow.preparationTrial.on_finish(failedRow);
  assert.equal(failedRow.helper_loaded, false);
  assert.equal(failedFlow.terminationReason, "helper_load_error");
  assert.equal(failedFlow.canRetry, false);
  assert.equal(keyReads, 1, "a failed helper import does not read the key");
  console.log("LLM flow preparation, auth/generation trials, and failure gate passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
