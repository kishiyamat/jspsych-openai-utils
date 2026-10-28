// CognitionのSource codeへ貼り付ける実験本体（jsPsych 7/8）。
// 条件と記録は実験側、LLM処理は共通ライブラリが担当します。
// 必要プラグイン: html-button-response / survey-html-form / call-function。
// AI条件ではencrypted-api-key.js（window.ENCRYPTED_API_KEY）も必要です。

// ===== 1. 実験設定 =====
const GENERATION_SETTINGS = Object.freeze({
  model: "gpt-6-luna",
  reasoningEffort: "none",
  temperature: 0.3,
  maxOutputTokens: 1000
});
const MAX_ATTEMPTS = 3;
// 調査中も同じ処理を使うため、検証済みの版を指定します。
const LIBRARY_URL = "https://cdn.jsdelivr.net/gh/kishiyamat/jspsych-openai-utils@7f05928c0129af28f5e2505a1366b83664b9ff7b/dist/feedback-utils.js";
const PROMPTS = {
  prompt_a: "あなたは文章改善を支援するAIです。対象文章の改善点と具体的な改善案（書き換え例を含む）を直接示してください。日本語で簡潔に。",
  prompt_b: "あなたは文章改善を支援するAIです。答えを直接示さず、本人が自分で改善できるよう、問い返しを中心にフィードバックしてください。書き換え例は示さないでください。日本語で簡潔に。"
};
const conditions = ["prompt_a", "prompt_b", "manual"];
const requestedValue = (new URLSearchParams(location.search).get("system-prompt") || "").toLowerCase();
const aliases = { a: "prompt_a", b: "prompt_b" };
const requested = aliases[requestedValue] || requestedValue;
const condition = conditions.includes(requested)
  ? requested : conditions[Math.floor(Math.random() * conditions.length)];
const isManual = condition === "manual";
const jsPsych = initJsPsych();
jsPsych.data.addProperties({
  experiment_version: "2026-10-28-v8",
  feedback_session_id: crypto.randomUUID(),
  system_prompt_type: condition,
  system_prompt_source: conditions.includes(requested) ? "query" : "random"
});
let submissionText = "", endReason = null;
const canContinue = () => endReason === null;
const escapeHtml = text => String(text ?? "").replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

// ===== 2. 同意 =====
const consent = {
  type: jsPsychHtmlButtonResponse, data: { feedback_phase: "consent" },
  stimulus: `<p>文章へのフィードバックに関する実験です。課題は1件です。</p>
    <p>${isManual ? "対象文章と、その文章へのフィードバックを自分で入力します。AIは使用しません。"
      : "対象文章を入力し、AIのフィードバックを確認・編集して提出します。対象文章をOpenAIへ送信します。"}</p>
    <p>入力・AIの出力（AI条件のみ）・提出文・操作を記録します。個人情報は入力しないでください。</p>`,
  choices: ["同意する", "同意しない"],
  on_finish: data => {
    if (data.response === 1) endReason = "declined_consent";
  }
};

// ===== 3. AI条件の認証 =====
let llmClient = null;
const authentication = {
  type: jsPsychCallFunction, async: true, data: { feedback_phase: "authentication" },
  func: async done => {
    jsPsych.getDisplayElement().textContent = "実験を準備しています。";
    try {
      if (!window.FeedbackUtils?.createClient) await import(LIBRARY_URL);
      llmClient = window.FeedbackUtils.createClient(window.ENCRYPTED_API_KEY);
      jsPsych.getDisplayElement().textContent = "";
      await llmClient.authenticate();
    } catch {
      endReason = "authentication_error";
    }
    done();
  },
  on_finish: data => {
    data.authentication_succeeded = Boolean(llmClient?.isAuthenticated());
    delete data.value;
  }
};

// ===== 4. 対象文章の入力 =====
const input = {
  type: jsPsychSurveyHtmlForm, data: { feedback_phase: "input" },
  preamble: `<p>${isManual ? "フィードバックの対象文章を入力してください。" : "AIに見せる文章を入力してください。"}</p>`,
  html: `<label for="submission-input">フィードバックの対象文章</label>
    <textarea id="submission-input" name="submission" rows="8" maxlength="1000" required
      placeholder="例：企業が社債を出すコストが上がっている。国債に対する金利の上乗せ幅（スプレッド）は15年ぶりの大きさになった。"
      style="display:block;width:100%;box-sizing:border-box;font:inherit"></textarea>`,
  button_label: isManual ? "フィードバックを書く" : "AIに依頼する",
  on_load: () => {
    const form = document.querySelector("#jspsych-survey-html-form");
    const text = form.querySelector("#submission-input");
    const validate = () => text.setCustomValidity(/\S/.test(text.value) ? "" : "空白以外の文字を入力してください。");
    text.addEventListener("input", validate);
    validate();
  },
  on_finish: data => {
    submissionText = data.response.submission;
    data.submission = submissionText;
    delete data.response;
  }
};

// ===== 5. AI生成 =====
let attempt = 0, error = null, aiText = null;
const needsRetry = () => error !== null && canContinue();
const generation = {
  type: jsPsychCallFunction, async: true, data: { feedback_phase: "generation" },
  func: async done => {
    attempt += 1;
    error = null;
    aiText = null;
    jsPsych.getDisplayElement().textContent = "AIがフィードバックを作成しています。";
    const record = {
      generation_attempt: attempt, system_prompt: PROMPTS[condition],
      api_input: submissionText, model: GENERATION_SETTINGS.model,
      reasoning_effort: GENERATION_SETTINGS.reasoningEffort,
      temperature: GENERATION_SETTINGS.temperature,
      max_output_tokens: GENERATION_SETTINGS.maxOutputTokens,
      response_model: null, api_response_id: null, ai_feedback: null, api_error: null
    };
    try {
      const result = await llmClient.generate({
        ...GENERATION_SETTINGS, systemPrompt: PROMPTS[condition], text: submissionText
      });
      aiText = result.text;
      record.ai_feedback = aiText;
      record.response_model = result.model;
      record.api_response_id = result.responseId;
    } catch (failure) {
      error = window.FeedbackUtils.classifyError(failure);
      record.api_error = error;
      if (!error.retryable) endReason = "non_retryable_error";
      else if (attempt >= MAX_ATTEMPTS) endReason = "max_attempts_reached";
    }
    done(record);
  },
  on_finish: data => {
    Object.assign(data, data.value);
    delete data.value;
  }
};
const retry = {
  type: jsPsychHtmlButtonResponse, data: { feedback_phase: "retry_decision" },
  stimulus: "<p>AIの応答を取得できませんでした。再試行しますか？</p>",
  choices: ["再試行", "終了"],
  on_finish: data => {
    data.generation_attempt = attempt;
    data.retry_choice = data.response === 0 ? "retry" : "end";
    if (data.response === 1) endReason = "participant_ended_after_error";
  }
};
const generationLoop = {
  timeline: [generation, { timeline: [retry], conditional_function: needsRetry }],
  conditional_function: () => !isManual, loop_function: needsRetry
};

// ===== 6. 原案の確認・提出 =====
const submission = {
  type: jsPsychSurveyHtmlForm, data: { feedback_phase: "submission" },
  preamble: "", html: "",
  // 生成後の原案を表示するため、画面文字列は試行開始時に組み立てます。
  on_start: trial => {
    trial.preamble = `<div><b>${isManual ? "対象文章" : "AIの原案"}</b>
      <div style="white-space:pre-wrap">${escapeHtml(isManual ? submissionText : aiText)}</div></div>`;
    trial.html = isManual
      ? `<label for="final-feedback">対象文章へのフィードバックを書いてください</label>
        <textarea id="final-feedback" name="final_feedback" rows="8" required
          style="display:block;width:100%;box-sizing:border-box;font:inherit"></textarea>`
      : `<fieldset style="display:grid;gap:.35em;text-align:left">
          <legend>AIの原案をどのように扱いましたか？</legend>
          <label><input type="radio" name="adoption" value="as_is" required>そのまま採用</label>
          <label><input type="radio" name="adoption" value="edited" required>編集して採用</label>
          <label><input type="radio" name="adoption" value="rejected" required>採用しない</label>
        </fieldset>
        <label for="final-feedback">提出するフィードバック（編集できます）</label>
        <p>採用しない場合は、空欄でも自分で書いた文章でも提出できます。</p>
        <textarea id="final-feedback" name="final_feedback" rows="8" required
          style="display:block;width:100%;box-sizing:border-box;font:inherit">${escapeHtml(aiText)}</textarea>`;
  },
  button_label: "提出する",
  on_load: () => {
    const form = document.querySelector("#jspsych-survey-html-form");
    const text = form.querySelector("#final-feedback");
    const choices = form.querySelectorAll('input[name="adoption"]');
    const validate = () => {
      const adoption = form.querySelector('input[name="adoption"]:checked')?.value;
      const emptyRejected = adoption === "rejected" && text.value === "";
      text.required = adoption !== "rejected";
      text.setCustomValidity(!/\S/.test(text.value) && !emptyRejected
        ? "空白以外の文字を入力してください。" : "");
    };
    text.addEventListener("input", validate);
    choices.forEach(choice => choice.addEventListener("change", validate));
    validate();
  },
  on_finish: data => {
    const response = data.response;
    const finalText = response.final_feedback ?? "";
    data.submission = submissionText;
    data.ai_feedback = aiText;
    data.final_feedback = finalText;
    data.generation_attempt = attempt;
    data.text_changed = isManual ? null : finalText !== aiText;
    data.adoption = isManual ? null : response.adoption;
    delete data.response;
  }
};

// ===== 7. 終了 =====
const finish = {
  type: jsPsychHtmlButtonResponse,
  stimulus: () => {
    if (endReason === null) return "<p>提出を受け付けました。ご協力ありがとうございました。</p>";
    if (endReason === "declined_consent") return "<p>実験を終了します。</p>";
    return "<p>実験を途中で終了しました。実験者にお知らせください。</p>";
  },
  choices: ["終了"],
  on_finish: data => {
    data.feedback_phase = endReason === null ? "complete" : "termination";
    data.termination_reason = endReason;
    data.generation_attempt = attempt;
    llmClient?.clear();
  }
};

// ===== 8. 実行 =====
jsPsych.run([
  consent,
  { timeline: [authentication], conditional_function: () => !isManual && canContinue() },
  { timeline: [input, generationLoop,
      { timeline: [submission], conditional_function: canContinue }],
    conditional_function: canContinue },
  finish
]).catch(() => {
  llmClient?.clear();
  jsPsych.getDisplayElement().textContent = "実験を継続できませんでした。実験者にお知らせください。";
});
