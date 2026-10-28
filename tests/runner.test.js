const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("src/runner.js", "utf8")
  .replace('new URL("./feedback-utils.js", import.meta.url).href', '"https://mock.test/dist/feedback-utils.js"')
  .replace("export { runStudy };", "window.FeedbackRunner = { runStudy };");
const calls = [];
let helperReads = 0;
const displayElement = { textContent: "" };
let failRun = false;
let runHook = null;
const jsPsych = {
  getDisplayElement: () => displayElement,
  run(timeline) {
    calls.push(["run", timeline]);
    if (runHook) return runHook(timeline);
    return failRun ? Promise.reject(new Error("mock failure")) : Promise.resolve();
  }
};
const fakeSession = {
  authenticate: async () => ({ authentication_succeeded: true }),
  generate: async () => ({ generation_attempt: 1, ai_feedback: "draft" }),
  recordTrialData: data => data,
  clear() { calls.push(["clear"]); },
  feedback: null,
  attempt: 0,
  canRetry: false,
  terminationReason: null
};
const helper = {
    createFeedbackSession(options) {
      calls.push(["create-session", options.encryptedApiKey]);
      return fakeSession;
    },
    bindNonBlankText() {},
    escapeHtml(value) { return String(value); }
};
const window = { _helper: helper };
Object.defineProperty(window, "FeedbackUtils", {
  get() { helperReads += 1; return this._helper; },
  set(value) { this._helper = value; }
});
const document = { createElement: () => ({ textContent: "" }), body: { appendChild() {} } };
const context = { window, document };
vm.runInNewContext(source, context);

async function main() {
  let flow;
  let studyTimeline;
  runHook = async timeline => {
    let value;
    await timeline[0].func(result => { value = result; });
    timeline[0].on_finish({ value });
  };
  await window.FeedbackRunner.runStudy(({ jsPsych: received, createFeedbackFlow }) => {
    assert.equal(received, jsPsych);
    flow = createFeedbackFlow({
      getEncryptedApiKey: () => { calls.push(["read-key"]); return { version: 1 }; },
      generationSettings: { model: "mock-model" },
      getRequest: () => ({ systemPrompt: "p", text: "x" }),
      maxAttempts: 3
    });
    studyTimeline = [flow.preparationTrial, flow.authenticationTrial, flow.generationTrial];
    assert.equal(calls.filter(item => item[0] === "read-key").length, 0);
    assert.equal(helperReads, 0, "study setup does not inspect the core library");
    return studyTimeline;
  }, { initJsPsych: (...args) => { calls.push(["init", ...args]); return jsPsych; }, callFunctionPlugin: "call-function" });

  assert.deepEqual(calls[0], ["init"]);
  assert.equal(calls[1][0], "run");
  assert.equal(calls[1][1], studyTimeline);
  assert.equal(flow.preparationTrial.type, "call-function");
  assert.equal(flow.preparationTrial.async, true);
  assert.equal(flow.preparationTrial.data.feedback_phase, "preparation");
  assert.equal(flow.authenticationTrial.data.feedback_phase, "authentication");
  assert.equal(flow.generationTrial.data.feedback_phase, "generation");

  assert.equal(helperReads > 0, true, "the preparation trial reads helper methods");
  assert.deepEqual(calls.find(item => item[0] === "create-session"), ["create-session", { version: 1 }]);
  assert.equal(calls.filter(item => item[0] === "read-key").length, 1);
  assert.equal(calls.some(item => item[0] === "clear"), true, "the runner clears resources after a completed run");
  assert.equal(flow.attempt, 0);
  assert.equal(flow.canRetry, false);
  assert.equal(displayElement.textContent, "");

  let clearedOnFailure = false;
  failRun = true;
  await window.FeedbackRunner.runStudy(({ createFeedbackFlow }) => {
    const failedFlow = createFeedbackFlow({ getEncryptedApiKey: () => null, generationSettings: {}, getRequest: () => ({}) });
    failedFlow.clear = () => { clearedOnFailure = true; };
    return [];
  }, { initJsPsych: () => jsPsych, callFunctionPlugin: "call-function" });
  assert.equal(clearedOnFailure, true);
  assert.match(displayElement.textContent, /実験を継続できませんでした/);
  console.log("runner timeline, deferred setup, and cleanup contracts passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
