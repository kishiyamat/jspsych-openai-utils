# jspsych-openai-utils guidance

- Prefer standard jsPsych trials, plugins, timeline, and data APIs before adding custom UI or trial control.
- Keep experiment conditions, task screens, timeline, and research fields in the experiment; keep API-key decryption, OpenAI requests, automatic retries, and safe error classification in the shared code.
- Do not recreate crypto or transport utilities when the shared library already provides them. Never save passwords, API keys, or raw error messages in trial data.
- GPT-6 Luna implements and verifies routine changes. Use GPT-6.1 Sol or GPT-6 Astra to review architecture decisions when needed.

- Load the shared library as a normal required External JS file; keep experiment settings, trial definitions, and timeline at top level.
- Read prior answers from jsPsych data rows instead of duplicating them in experiment state. A temporary password variable is allowed only to remove the password from its survey row before authentication.
- Do not read conditions from URL query values. The current sample runs each `CONDITIONS` entry once in randomized order using jsPsych timeline variables.
- Keep AI and manual submission on the same required feedback field; record text comparison separately and do not infer an adoption category.
