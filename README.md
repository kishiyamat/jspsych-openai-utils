# jspsych-openai-utils

A small browser-side utility for decrypting an encrypted API key and sending a request to OpenAI's Responses API. It does not define jsPsych trials, participant screens, retry decisions, or study data.

Never commit a real API key, encrypted experiment key, password, participant responses, or research-specific prompts.

## Files

- `src/crypto.js`: PBKDF2-SHA256 / AES-256-GCM decryption
- `src/openai.js`: Responses API request and safe error classification
- `dist/feedback-utils.js`: browser bundle generated from those two source files
- `experiment.js`: a small Cognition example using ordinary jsPsych trials and a visible timeline
- `example.html`: minimal utility usage example
- `scripts/build-dist.js`: rebuilds the browser bundle

## Cognition example

Paste `experiment.js` into Cognition's Source code. It uses the standard `html-button-response`, `survey`, and `call-function` plugins. For the survey plugin, register the JavaScript file `https://unpkg.com/@jspsych/plugin-survey@1.0.1` as an External JS file and register its stylesheet `https://unpkg.com/@jspsych/plugin-survey@1.0.1/css/survey.css` as External CSS. Do not also enable the survey plugin selector, which would load it twice. The other two plugins can be enabled with their usual selectors. Register `encrypted-api-key.js` as External JS; it defines `window.ENCRYPTED_API_KEY`.

The example imports this utility bundle from its pinned URL before the consent screen. Declining consent skips password entry, decryption, and OpenAI requests. Conditions are `prompt_a`, `prompt_b`, and `manual`; `?system-prompt=A` or `B` selects the matching AI condition, while a missing or invalid value selects randomly among all three. Manual participants use the same standard survey screens but do not enter a password or call the API.

Study conditions, prompts, participant screens, timeline, retry choice, and research fields remain visible in `experiment.js`. This library only decrypts the key, sends the Responses API request, and returns a safe error summary. Cognition's jsPsych integration saves each trial. Actual task registration and data saving in Cognition have not been verified for this example.

## Utility API

The browser bundle exposes `decryptApiKey`, `generate`, and `classifyError` through `window.FeedbackUtils`.

```js
let apiKey = await FeedbackUtils.decryptApiKey(window.ENCRYPTED_API_KEY, password);
try {
  const result = await FeedbackUtils.generate({
    apiKey,
    model: "gpt-6-luna",
    reasoningEffort: "none",
    temperature: 0.3,
    maxOutputTokens: 1000,
    systemPrompt: "日本語で簡潔に改善案を提示してください。",
    text: "ここに対象文章を渡す"
  });
  // Use result.text in the experiment's own trial.
} finally {
  apiKey = null;
}
```

The code that collects a password and deletes it from trial data belongs to the experiment. Never put the password or decrypted API key into trial data, browser storage, or logs. Keep the submitted text unchanged when sending it. The model and generation settings must be supported together by the selected model.

The utility does not save experiment responses. Use jsPsych data collection/export as appropriate. Client-side encryption does not hide a decrypted API key from participants who can inspect their browser or network requests; use a dedicated key for a controlled study and disable it after the study.

Older releases included optional jsPsych trial factories and a client/session layer. Those APIs are not in the current bundle; an existing experiment that uses them can continue to use its previously pinned immutable release.

## Local checks

```sh
node tests/classify-error.test.js
node tests/crypto.test.js
node tests/openai.test.js
node tests/dist-build.test.js
```
