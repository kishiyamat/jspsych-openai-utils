# jspsych-openai-utils

A tiny browser-side helper for jsPsych experiments using OpenAI's Responses API.

**Public source code only.** Never commit a real API key, encrypted experiment key, password, subject responses, or research-specific prompts.

## Files

- `dist/feedback-utils.js`: standalone browser bundle (include this in HTML)
- `src/crypto.js`: password-based decryption (PBKDF2-SHA256 / AES-256-GCM)
- `src/openai.js`: Responses API call
- `src/feedback.js`: password form
- `example.html`: minimal usage sample

## Quick start

Load the pinned version of the bundle **before** your experiment code:

```html
<script src="https://cdn.jsdelivr.net/gh/kishiyamat/jspsych-openai-utils@COMMIT_SHA/dist/feedback-utils.js"></script>
<script src="./experiment.js"></script>
```

In your experiment code, define `ENCRYPTED_API_KEY` locally (never in this repository):

```js
const apiKey = await FeedbackUtils.getApiKey(ENCRYPTED_API_KEY);
const result = await FeedbackUtils.generate({
  apiKey,
  model: "gpt-5-mini",
  systemPrompt: "日本語で短く改善案を提示してください。",
  text: "ここに対象文章を渡す",
});
console.log(result.text); // result.model, result.responseId are also available
```

For models supporting explicit reasoning effort, `reasoningEffort` can be passed. Set `temperature` **only** if the selected model supports it; this helper does not assume all models share identical parameters.

### Cognition sample

Paste `experiment.js` into Cognition Source code and enable the `html-button-response`, `survey`, and `call-function` plugins. Add these External JS files in order: `feedback-utils.js`, then `encrypted-api-key.js` (which defines `window.ENCRYPTED_API_KEY`), then the experiment Source code. The sample has `prompt_a`, `prompt_b`, and `manual` conditions. `?system-prompt=A` or `B` selects the matching AI condition; if the parameter is missing or invalid, the sample chooses randomly among all three. The shared library provides the common authentication and generation jsPsych trials; the experiment code keeps the study conditions, prompts, and screens.

The participant enters only the target submission text. Condition-specific instructions are defined in `PROMPTS`; this sample does not ask for a separate user instruction. It keeps the exact submitted text in `submission` and the generation row's `api_input` contains the exact text sent to the API. `adoption` records the participant's choice (`as_is`, `edited`, or `rejected`), while `text_changed` independently records whether the final text differs from the AI draft.

### Encryption

`getApiKey(encrypted)` accepts an object containing `salt`, `iv`, `ciphertext`, and `iterations`, from a PBKDF2-SHA256 / AES-256-GCM encryption workflow. It prompts for the password and returns the decrypted API key. `decryptApiKey(encrypted, password)` is also exposed for automated tests.

### Important security note

Client-side password encryption does **not** protect a decrypted API key from participants who inspect their browser or network requests. Use dedicated, low-budget, expiring/revoked keys for controlled studies. A server-side proxy is needed if the key must remain confidential.

### Data collection

This library does not save experiment responses. Use jsPsych data collection/export as appropriate, and avoid storing API keys or passwords in trial data.

