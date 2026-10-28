const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createHarness(fetch) {
  const delays = [];
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0;
  const context = {
    fetch,
    setTimeout: (callback, delay) => { delays.push(delay); callback(); return 1; },
    AbortSignal, Response, Date, Math: deterministicMath, JSON, Error, SyntaxError, Promise
  };
  const source = fs.readFileSync("src/openai.js", "utf8");
  vm.runInNewContext(`${source}\nactiveApiKey = "sk-private-test"; globalThis.run = generate;`, context);
  return { run: context.run, delays };
}

function safeResponse() {
  return new Response(JSON.stringify({ id: "resp-safe", status: "completed", model: "fake-model", output: [
    { type: "message", content: [{ type: "output_text", text: "safe result" }] }
  ] }), { status: 200, headers: { "content-type": "application/json" } });
}

async function callGenerate(run) {
  let callbackCount = 0;
  const result = await new Promise(resolve => run({
    model: "fake-model", systemPrompt: "safe prompt", text: "raw input"
  }, value => { callbackCount += 1; resolve(value); }));
  return { result, callbackCount };
}

async function main() {
  const calls = [];
  const { run, delays } = createHarness(async (_url, options) => {
    calls.push(JSON.parse(options.body));
    if (calls.length < 3) {
      return new Response(JSON.stringify({ error: { code: "server_error", message: "private failure" } }), {
        status: 503,
        headers: { "content-type": "application/json", "retry-after": "0" }
      });
    }
    return safeResponse();
  });
  const { result, callbackCount } = await callGenerate(run);

  assert.equal(calls.length, 3);
  assert.equal(callbackCount, 1);
  assert.equal(result.generation_attempt, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(result.api_attempts)), [
    { attempt: 1, error: { http_status: 503, retryable: true, code: "generation_failed" } },
    { attempt: 2, error: { http_status: 503, retryable: true, code: "generation_failed" } },
    { attempt: 3, error: null }
  ]);
  assert.equal(result.ai_feedback, "safe result");
  assert.equal(delays.length, 2);
  assert.ok(delays.every(delay => delay === 0), "Retry-After takes priority over fallback backoff");
  assert.equal(JSON.stringify(result).includes("private failure"), false);
  assert.equal(JSON.stringify(result).includes("sk-private-test"), false);
  assert.deepEqual(calls.map(body => body.input), ["raw input", "raw input", "raw input"]);

  let rateLimitCalls = 0;
  const rateLimit = createHarness(async () => {
    rateLimitCalls += 1;
    if (rateLimitCalls === 1) {
      return new Response(JSON.stringify({ error: { code: "rate_limit_exceeded", message: "private rate detail" } }), {
        status: 429, headers: { "content-type": "application/json", "retry-after": "2" }
      });
    }
    return safeResponse();
  });
  const rateLimitResult = await callGenerate(rateLimit.run);
  assert.equal(rateLimitCalls, 2);
  assert.deepEqual(rateLimit.delays, [2000]);
  assert.equal(rateLimitResult.result.generation_attempt, 2);

  let longHeaderCalls = 0;
  const longHeader = createHarness(async () => {
    longHeaderCalls += 1;
    return new Response(JSON.stringify({ error: { code: "server_error", message: "private detail" } }), {
      status: 503, headers: { "content-type": "application/json", "retry-after": "31" }
    });
  });
  const longHeaderResult = await callGenerate(longHeader.run);
  assert.equal(longHeaderCalls, 1, "do not retry earlier than a Retry-After value beyond the wait bound");
  assert.equal(longHeaderResult.result.generation_attempt, 1);
  assert.equal(longHeader.delays.length, 0);
  assert.equal(longHeaderResult.result.api_error.http_status, 503);

  let exhaustedCalls = 0;
  const exhausted = createHarness(async () => {
    exhaustedCalls += 1;
    return new Response(JSON.stringify({ error: { code: "server_error", message: "private failure" } }), {
      status: 503, headers: { "content-type": "application/json" }
    });
  });
  const exhaustedResult = await callGenerate(exhausted.run);
  assert.equal(exhaustedCalls, 5);
  assert.equal(exhaustedResult.callbackCount, 1);
  assert.equal(exhaustedResult.result.generation_attempt, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(exhaustedResult.result.api_attempts.map(item => item.attempt))), [1, 2, 3, 4, 5]);
  assert.equal(exhausted.delays.length, 4);
  assert.ok(exhausted.delays.every((delay, index) => delay <= 8000 && (index === 0 || delay >= exhausted.delays[index - 1])));
  assert.equal(JSON.stringify(exhaustedResult.result).includes("private failure"), false);

  let quotaCalls = 0;
  const quota = createHarness(async () => {
    quotaCalls += 1;
    return new Response(JSON.stringify({ error: { code: "credit_balance_exhausted", message: "private quota detail" } }), {
      status: 429, headers: { "content-type": "application/json", "retry-after": "0" }
    });
  });
  const quotaResult = await callGenerate(quota.run);
  assert.equal(quotaCalls, 1);
  assert.equal(quotaResult.result.generation_attempt, 1);
  assert.equal(quotaResult.result.api_attempts[0].error.code, "credit_balance_exhausted");
  assert.equal(quota.delays.length, 0);
  assert.equal(JSON.stringify(quotaResult.result).includes("private quota detail"), false);

  console.log("Retry-After, automatic retry history, five-call ceiling, non-retryable quota, and safe callback checks passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
