/** Escape participant text before placing it in an HTML fragment. */
function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
}

/** Validate nonblank text without rewriting it; an optional field may be left empty. */
function bindNonBlankText(form, fieldName, { optionalWhen = () => false } = {}) {
  const field = form.elements.namedItem(fieldName);
  const validate = () => {
    const optional = optionalWhen();
    const optionalEmpty = field.value === "" && optional;
    field.required = !optional;
    field.setCustomValidity(/\S/.test(field.value) || optionalEmpty
      ? "" : "空白以外の文字を入力してください。");
  };
  field.addEventListener("input", validate);
  form.addEventListener("change", validate);
  validate();
  return validate;
}
