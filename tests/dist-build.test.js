const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

const distPath = "dist/feedback-utils.js";
const before = fs.readFileSync(distPath, "utf8");
const runnerPath = "dist/feedback-runner.js";
const runnerBefore = fs.readFileSync(runnerPath, "utf8");
const build = spawnSync(process.execPath, ["scripts/build-dist.js"], { encoding: "utf8" });
assert.equal(build.status, 0, build.stderr);
assert.equal(fs.readFileSync(distPath, "utf8"), before, "dist must match its source build");
assert.equal(fs.readFileSync(runnerPath, "utf8"), runnerBefore, "runner dist must match its source");
assert.match(before, /window\.FeedbackUtils = Object\.freeze\(/);
assert.match(before, /createFeedbackSession/);
assert.doesNotMatch(before, /createAuthenticationTrial|createGenerationTrial|jsPsychCallFunction/);
assert.match(runnerBefore, /export \{ runStudy \}/);
assert.doesNotMatch(runnerBefore, /window\.FeedbackUtils\s*=.*createClient/);
console.log("dist/source consistency checks passed");
