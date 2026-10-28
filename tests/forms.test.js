const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = { window: {} };
vm.runInNewContext(`${fs.readFileSync("src/forms.js", "utf8")}\nglobalThis.formUtils = { escapeHtml, bindNonBlankText };`, context);
const { escapeHtml, bindNonBlankText } = context.formUtils;

assert.equal(escapeHtml(`<>&"'`), "&#60;&#62;&#38;&#34;&#39;");
function fakeForm(initial = "") {
  const handlers = {};
  const field = {
    value: initial,
    validityMessage: "",
    addEventListener(name, callback) { handlers[name] = callback; },
    setCustomValidity(message) { this.validityMessage = message; }
  };
  return { field, handlers, elements: { namedItem(name) { return name === "submission" ? field : null; } }, addEventListener(name, callback) { handlers[`form:${name}`] = callback; } };
}
const required = fakeForm("  \n");
bindNonBlankText(required, "submission");
assert.equal(required.field.validityMessage, "空白以外の文字を入力してください。");
required.field.value = "  raw text\n "; required.handlers.input();
assert.equal(required.field.validityMessage, "");
const optional = fakeForm("   ");
bindNonBlankText(optional, "submission", { optionalWhen: () => true });
assert.equal(optional.field.validityMessage, "空白以外の文字を入力してください。");
assert.equal(optional.field.required, false);
assert.equal(optional.field.value, "   ", "validation must not trim or rewrite participant input");
optional.field.value = ""; optional.handlers.input();
assert.equal(optional.field.validityMessage, "");
console.log("form helper contracts passed");
