# jspsych-openai-utils guidance

- Prefer standard jsPsych trials, plugins, timeline, and data APIs before adding custom UI or trial control.
- Keep experiment conditions, task screens, timeline, retry choices, and research fields in the experiment; keep shared code to API-key decryption, OpenAI requests, and safe error classification.
- Do not recreate crypto or transport utilities when the shared library already provides them. Never save passwords, API keys, or raw error messages in trial data.
- GPT-6 Luna implements and verifies routine changes. Use GPT-6.1 Sol or GPT-6 Astra to review architecture decisions when needed.
