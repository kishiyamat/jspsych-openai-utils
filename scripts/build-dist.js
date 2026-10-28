const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = ["crypto.js", "feedback.js", "openai.js", "client.js", "forms.js"];
const sources = files.map(file => fs.readFileSync(path.join(root, "src", file), "utf8").trim());
const bundle = [
  "/* jspsych-openai-utils browser bundle. No API keys are embedded. */",
  "(() => {",
  '  "use strict";',
  ...sources,
  "  window.FeedbackUtils = Object.freeze({ getApiKey, generate, decryptApiKey, createClient, classifyError, escapeHtml, bindNonBlankText });",
  "})();",
  ""
].join("\n\n");

fs.writeFileSync(path.join(root, "dist", "feedback-utils.js"), bundle);
