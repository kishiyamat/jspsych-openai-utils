const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

const distPath = "dist/feedback-utils.js";
const build = spawnSync(process.execPath, ["scripts/build-dist.js"], { encoding: "utf8" });
assert.equal(build.status, 0, build.stderr);
const bundle = fs.readFileSync(distPath, "utf8");
assert.match(bundle, /window\.FeedbackUtils = Object\.freeze\(\{ decryptApiKey, generate, clearKey \}\)/);
assert.doesNotMatch(bundle, /createClient|createFeedbackSession|createFeedbackFlow|bindNonBlankText|escapeHtml|initJsPsych|jsPsychCallFunction/);
assert.equal(fs.existsSync("dist/feedback-runner.js"), false);
console.log("minimal utility bundle source/dist checks passed");
