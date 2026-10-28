const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('src/client.js', 'utf8');
const classifyError = new Function(`${source}\nreturn classifyError;`)();

const nonRetryableCodes = [
  'credit_balance_exhausted',
  'project_spend_limit_exceeded',
  'organization_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'insufficient_quota'
];
for (const code of nonRetryableCodes) {
  const result = classifyError({ status: 429, code, message: 'safe mock' });
  assert.equal(result.retryable, false, `${code} must not be retried`);
  assert.equal(result.code, code, `${code} must be retained as a safe code`);
}
assert.equal(classifyError({ status: 429, code: 'rate_limit_exceeded' }).retryable, true);
assert.equal(classifyError({ status: 503, code: 'server_error' }).retryable, true);
console.log('spend exhaustion classification checks passed');
