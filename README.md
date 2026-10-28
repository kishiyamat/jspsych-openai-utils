# jspsych-openai-utils

A small browser-side library for using OpenAI's Responses API from a jsPsych experiment.

**Public source only.** Never commit a real API key, encrypted experiment key, password, participant responses, or research-specific prompts.

## Files

- `dist/feedback-utils.js`: browser bundle, generated from `src/`
- `src/crypto.js`: password-based decryption (PBKDF2-SHA256 / AES-256-GCM)
- `src/openai.js`: Responses API request and response handling
- `src/feedback.js`: password form
- `src/client.js`: jsPsych-independent client and safe API-error classification
- `scripts/build-dist.js`: rebuilds the bundle from the source files
- `example.html`: small client usage example

## Quick start

Load the pinned bundle before the experiment code:

```html
<script src="https://cdn.jsdelivr.net/gh/kishiyamat/jspsych-openai-utils@7f05928c0129af28f5e2505a1366b83664b9ff7b/dist/feedback-utils.js"></script>
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

Paste `experiment.js` into Cognition's Source code and enable `html-button-response`, `survey-html-form`, and `call-function`. The sample uses the standard `survey-html-form` plugin for participant input and submission. Study conditions, prompts, screens, retry decisions, and saved trial fields stay in the experiment code; this library handles key decryption, the OpenAI request, and safe error classification.

The sample has `prompt_a`, `prompt_b`, and `manual` conditions. `?system-prompt=A` or `B` selects the matching AI condition; if the parameter is missing or invalid, the sample chooses randomly among all three. In an AI condition, the experiment automatically imports the pinned `feedback-utils.js` bundle when authentication begins. Register only `encrypted-api-key.js` (which defines `window.ENCRYPTED_API_KEY`) as an External JS file. The manual condition skips authentication and generation, so it does not import the bundle.

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
node tests/dist-build.test.js
```
