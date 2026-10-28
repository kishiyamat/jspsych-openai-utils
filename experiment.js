// CognitionのSource codeへ貼り付ける実験本体（jsPsych 7/8）。
// 必要プラグイン: html-button-response / survey-html-form / call-function。
// 条件・画面・保存列はここに、LLM処理は共通ライブラリに置きます。

// ===== 1. 実験設定 =====
const GENERATION_SETTINGS = Object.freeze({
  model: "gpt-6-luna",
  reasoningEffort: "none",
  temperature: 0.3,
  maxOutputTokens: 1000
});
const MAX_ATTEMPTS = 3;
// 実験中に同じ共通処理を使えるよう、検証した版を固定します。
const LIBRARY_URL = "https://cdn.jsdelivr.net/gh/kishiyamat/jspsych-openai-utils@baa5b27f6750abde0afc7dcf4afe28c2f7c4ff63/dist/feedback-utils.js";
const PROMPTS = {
  prompt_a: "あなたは文章改善を支援するAIです。対象文章の改善点と具体的な改善案（書き換え例を含む）を直接示してください。日本語で簡潔に。",
  prompt_b: "あなたは文章改善を支援するAIです。答えを直接示さず、本人が自分で改善できるよう、問い返しを中心にフィードバックしてください。書き換え例は示さないでください。日本語で簡潔に。"
};
const conditions = ["prompt_a", "prompt_b", "manual"];

const jsPsych = initJsPsych();
const requestedValue = (jsPsych.data.getURLVariable("system-prompt") || "").toLowerCase();
const aliases = { a: "prompt_a", b: "prompt_b" };
const requested = aliases[requestedValue] || requestedValue;
const conditionSource = conditions.includes(requested) ? "query" : "random";
const condition = conditionSource === "query"
  ? requested : jsPsych.randomization.sampleWithoutReplacement(conditions, 1)[0];
const isManual = condition === "manual";
jsPsych.data.addProperties({
  experiment_version: "2026-10-28-v9",
  feedback_session_id: crypto.randomUUID(),
  system_prompt_type: condition,
  system_prompt_source: conditionSource
});

let llmClient = null, submissionText = "", aiText = null;
let attempt = 0, error = null, endReason = null;
const canContinue = () => endReason === null;
const needsRetry = () => error !== null && canContinue();

// ===== 2. 説明と同意 =====
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

// ===== 3. 共通ライブラリの準備 =====
const loadHelpers = {
  type: jsPsychCallFunction, async: true, data: { feedback_phase: "preparation" },
  func: async done => {
    let loaded = false;
    jsPsych.getDisplayElement().textContent = "実験を準備しています。";
    try {
      if (!window.FeedbackUtils?.createClient || !window.FeedbackUtils?.bindNonBlankText
          || !window.FeedbackUtils?.escapeHtml || !window.FeedbackUtils?.classifyError) {
        await import(LIBRARY_URL);
      }
      if (!window.FeedbackUtils?.createClient || !window.FeedbackUtils?.bindNonBlankText
          || !window.FeedbackUtils?.escapeHtml || !window.FeedbackUtils?.classifyError) {
        throw new Error("Required library functions are unavailable");
      }
      loaded = true;
    } catch {
      endReason = "helper_load_error";
    }
    jsPsych.getDisplayElement().textContent = "";
    done({ helper_loaded: loaded });
  },
  on_finish: data => {
    data.helper_loaded = data.value?.helper_loaded === true;
    delete data.value;
  }
};

// ===== 4. AI条件の認証 =====
const authentication = {
  type: jsPsychCallFunction, async: true, data: { feedback_phase: "authentication" },
  func: async done => {
    try {
      llmClient = window.FeedbackUtils.createClient(window.ENCRYPTED_API_KEY);
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

// ===== 5. 対象文章の入力 =====
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
    window.FeedbackUtils.bindNonBlankText(form, "submission");
  },
  on_finish: data => {
    submissionText = data.response.submission;
    data.submission = submissionText;
    delete data.response;
  }
};

// ===== 6. AI生成と必要な場合の再試行 =====
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

// ===== 7. 原案の確認・提出 =====
const submission = {
  type: jsPsychSurveyHtmlForm, data: { feedback_phase: "submission" },
  preamble: () => `<div><b>${isManual ? "対象文章" : "AIの原案"}</b>
      <div style="white-space:pre-wrap">${window.FeedbackUtils.escapeHtml(isManual ? submissionText : aiText)}</div></div>`,
  html: () => isManual
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
          style="display:block;width:100%;box-sizing:border-box;font:inherit">${window.FeedbackUtils.escapeHtml(aiText)}</textarea>`,
  button_label: "提出する",
  on_load: () => {
    const form = document.querySelector("#jspsych-survey-html-form");
    window.FeedbackUtils.bindNonBlankText(form, "final_feedback", {
      optionalWhen: () => form.querySelector('input[name="adoption"]:checked')?.value === "rejected"
    });
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

// ===== 8. 終了 =====
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

// ===== 9. 実行順 =====
const preparationTimeline = {
  timeline: [loadHelpers], conditional_function: canContinue
};
const authenticationTimeline = {
  timeline: [authentication], conditional_function: () => !isManual && canContinue()
};
const taskTimeline = {
  timeline: [input, generationLoop,
    { timeline: [submission], conditional_function: canContinue }],
  conditional_function: canContinue
};
const timeline = [
  consent,
  preparationTimeline,
  authenticationTimeline,
  taskTimeline,
  finish
];
jsPsych.run(timeline).catch(() => {
  llmClient?.clear();
  jsPsych.getDisplayElement().textContent = "実験を継続できませんでした。実験者にお知らせください。";
});
