# jspsych-openai-utils

A small browser-side library for using OpenAI's Responses API from a jsPsych experiment.

**Public source only.** Never commit a real API key, encrypted experiment key, password, participant responses, or research-specific prompts.

## Files

- `dist/feedback-utils.js`: browser bundle, generated from `src/`
- `dist/feedback-runner.js`: small ES module that starts a study and loads its sibling helper bundle
- `src/crypto.js`: password-based decryption (PBKDF2-SHA256 / AES-256-GCM)
- `src/openai.js`: Responses API request and response handling
- `src/feedback.js`: password form
- `src/client.js`: jsPsych-independent client and safe API-error classification
- `src/forms.js`: HTML escaping and nonblank form validation
- `src/session.js`: one fixed study request, authentication, retry attempt, and safe generation rows
- `src/runner.js`: jsPsych entry point and shared preparation/authentication/generation trials
- `scripts/build-dist.js`: rebuilds the bundle from the source files
- `example.html`: small client usage example

## Quick start

Load the pinned bundle before the experiment code:

```html
<script src="https://cdn.jsdelivr.net/gh/kishiyamat/jspsych-openai-utils@27f1112f316d204fa144a3dd151603cb218442b0/dist/feedback-utils.js"></script>
<script src="./experiment.js"></script>
```

Keep `ENCRYPTED_API_KEY` in a separate `encrypted-api-key.js` file. In an AI condition, create and use a client:

```js
const client = FeedbackUtils.createClient(ENCRYPTED_API_KEY);
try {
  await client.authenticate();
  const result = await client.generate({
    model: "gpt-6-luna",
    reasoningEffort: "none",
    temperature: 0.3,
    systemPrompt: "日本語で短く改善案を提示してください。",
    text: "ここに対象文章を渡す",
  });
  console.log(result.text);
} finally {
  client.clear();
}
```

The model and generation settings must be supported together by the selected model. Keep the model and settings used for each study in its experiment code and record them with the data.

### Cognition sample

Paste `experiment.js` into Cognition's Source code and enable `html-button-response`, `survey-html-form`, and `call-function`. The sample uses the standard `survey-html-form` plugin for participant input and submission. Study conditions, prompts, screens, retry decisions, adoption choices, saved study fields, and their order stay visible in the experiment code. The shared runner starts jsPsych and supplies standard preparation, authentication, and generation trials; the shared session handles key authentication, one frozen request across manual retries, and safe authentication/generation rows.

The sample has `prompt_a`, `prompt_b`, and `manual` conditions. `?system-prompt=A` or `B` selects the matching AI condition; if the parameter is missing or invalid, the sample chooses randomly among all three. `RUNNER_URL` is the single pinned entry URL; it loads its sibling `feedback-utils.js` from the same release, so the experiment does not need a second library URL. Before consent, the browser downloads the runner module. After consent, a preparation trial loads the core bundle and records whether it is ready. Register only `encrypted-api-key.js` (which defines `window.ENCRYPTED_API_KEY`) as an External JS file. The manual condition loads the helper but skips authentication and generation; declining consent skips core-helper loading, authentication, and generation. If the runner module itself cannot be downloaded, the experiment shows a fixed error before jsPsych starts, so there is no trial row to save.

The visible timeline is consent → helper preparation → (AI authentication when needed) → input → (generation and retry loop for AI conditions) → submission → finish. A helper-load error is recorded in the preparation row and skips authentication and task trials.

The participant enters only the target submission text. Condition-specific instructions are in `PROMPTS`; this sample does not request a separate user instruction. It preserves the submitted string in `submission` and the exact API text in `api_input`. `adoption` records the participant's choice (`as_is`, `edited`, or `rejected`); `text_changed` independently records whether the final text differs from the AI draft.

The current bundle no longer exports the optional jsPsych trial factories. Existing experiments that use `createAuthenticationTrial` or `createGenerationTrial` should continue using the older bundle pinned at `52cecba5904b1282c0de0489afa9314d93be2243`. The `getApiKey`, `generate`, and `decryptApiKey` functions remain available for existing callers.

### Encryption

`getApiKey(encrypted)` asks for the password and decrypts an object containing `salt`, `iv`, `ciphertext`, and `iterations`, using PBKDF2-SHA256 and AES-256-GCM. `decryptApiKey(encrypted, password)` is also available for automated tests.

### Security

Client-side encryption does not hide a decrypted API key from participants who can inspect their browser or network requests. Use a dedicated key with appropriate usage limits and revoke it after a controlled study. A server-side proxy is needed if the key must remain confidential from participants.

### Data collection

The library does not save experiment responses. Use jsPsych data collection/export as appropriate, and never put API keys or passwords in trial data.

## Local checks

```sh
node tests/classify-error.test.js
node tests/forms.test.js
node tests/feedback-session.test.js
node tests/dist-build.test.js
node tests/runner.test.js
```
