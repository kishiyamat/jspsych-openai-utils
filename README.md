# jspsych-openai-utils

A small browser utility for decrypting an encrypted API key, sending requests to OpenAI's Responses API, and retrying transient failures. It does not define jsPsych trials, participant screens, or study data.

Never commit a real API key, encrypted experiment key, password, participant responses, or research-specific prompts.

## Files

- `src/crypto.js`: PBKDF2-SHA256 / AES-256-GCM decryption
- `src/openai.js`: Responses API requests, bounded automatic retries, and safe error classification
- `dist/feedback-utils.js`: browser bundle generated from those two source files
- `experiment.js`: Cognition example using ordinary jsPsych trials and a visible timeline
- `example.html`: minimal utility usage example
- `scripts/build-dist.js`: rebuilds the browser bundle

## Cognition example

Paste `experiment.js` into Cognition's Source code. Register `feedback-utils.js` and `encrypted-api-key.js` as External JS files. The experiment calls the utility's callback API directly. For the survey plugin, register `https://unpkg.com/@jspsych/plugin-survey@1.0.1` as External JS and `https://unpkg.com/@jspsych/plugin-survey@1.0.1/css/survey.css` as External CSS. Do not also enable the survey plugin selector, which would load it twice. Enable the usual `html-button-response` and `call-function` selectors.

Each participant completes `prompt_a`, `prompt_b`, and `manual` once each, in a randomized order. The standard jsPsych timeline variables hold the three conditions, and native trial indices show their order. Consent and password entry happen once before the three task trials. Each AI condition has one generation trial; the utility retries the same request for retryable failures, up to five API calls, and returns a safe `api_attempts` history on that trial. A final generation failure displays a short notice and moves to the next condition. The manual trial does not generate an API request. Declining consent skips password entry and API use.

Cognition's jsPsych integration saves each trial. Actual task registration and data saving in Cognition have not been verified for this example.

## Utility API

`window.FeedbackUtils` exposes three methods:

- `decryptApiKey(encrypted, password, done)` decrypts the key and keeps it private inside the utility. `done` receives only `authentication_succeeded` and `authentication_error`.
- `generate(options, done)` sends a Responses API request using that private key. It retries retryable failures up to five calls, stopping on success or a non-retryable error. `done` receives the response fields, total API call count, and a safe `api_attempts` history; neither the key nor raw error messages are returned.
- `clearKey()` releases the private key.

Both methods call `done` when processing finishes; use the jsPsych `call-function` plugin for asynchronous trials. For example:

```js
const authentication = {
  type: jsPsychCallFunction,
  async: true,
  func: done => FeedbackUtils.decryptApiKey(window.ENCRYPTED_API_KEY, password, done)
};

const generation = {
  type: jsPsychCallFunction,
  async: true,
  func: done => FeedbackUtils.generate({
    model: "gpt-6-luna",
    reasoningEffort: "none",
    temperature: 0.3,
    maxOutputTokens: 1000,
    systemPrompt: "Study-specific instruction",
    text: rawSubmission
  }, done)
};
```

The experiment must remove the password from trial data and must never put the password or decrypted API key in browser storage or logs. Keep submitted text unchanged when sending it. The model and generation settings must be supported together by the selected model.

The sample uses one required feedback field for AI and manual conditions. In AI conditions the generated text is its initial value; `text_changed` is a strict comparison with the submitted text, not a self-reported adoption category.

The utility does not save experiment responses. Use jsPsych data collection/export as appropriate. Client-side encryption does not hide a decrypted API key from participants who can inspect their browser or network requests; use a dedicated key for a controlled study and disable it after the study.

An older release included a Promise-based API and optional jsPsych trial factories. Existing experiments using those interfaces can continue to use their pinned immutable release.

## Local checks

```sh
node tests/classify-error.test.js
node tests/crypto.test.js
node tests/openai.test.js
node tests/retry.test.js
node tests/util-api.test.js
node tests/dist-build.test.js
```
