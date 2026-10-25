// Minimal browser UI for entering the shared experiment password.
async function getApiKey(encrypted) {
  if (!encrypted?.salt || !encrypted?.iv || !encrypted?.ciphertext) {
    throw new Error("Encrypted API key object is required");
  }
  const form = document.createElement("form");
  form.style.cssText = "max-width:480px;margin:60px auto";
  const label = document.createElement("label");
  label.textContent = "実験用パスワード";
  const input = document.createElement("input");
  input.type = "password";
  input.required = true;
  input.style.width = "100%";
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  const button = document.createElement("button");
  button.textContent = "開始";
  label.append(input);
  form.append(label, message, button);
  document.body.append(form);
  input.focus();
  try {
    while (true) {
      const password = await new Promise(resolve => {
        form.onsubmit = event => { event.preventDefault(); resolve(input.value); };
      });
      input.value = "";
      button.disabled = true;
      message.textContent = "確認しています";
      try {
        return await decryptApiKey(encrypted, password);
      } catch (error) {
        if (error.name !== "OperationError") throw error;
        message.textContent = "パスワードが正しくありません";
      } finally {
        button.disabled = false;
        input.focus();
      }
    }
  } finally {
    form.remove();
  }
}
