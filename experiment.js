// CognitionのSource codeへ貼り付ける実験本体（jsPsych 7/8）。
// External JS: encrypted-api-key.js（window.ENCRYPTED_API_KEYを定義）。
// プラグイン: html-button-response / survey / call-function。
// 共通JSはAI条件の認証時に取得。キー・パスワードは実験データへ記録しない。

// ===== 1. 実験設定 =====
const LIBRARY_URL = "https://cdn.jsdelivr.net/gh/kishiyamat/jspsych-openai-utils@d069ffd8f3da18c9d1562b94a47b1ecee4ee1510/dist/feedback-utils.js";
const MODEL = "gpt-6-luna";
const MAX_ATTEMPTS = 3;
const PROMPTS = {
  prompt_a: "あなたは文章改善を支援するAIです。対象文章の改善点と具体的な改善案（書き換え例を含む）を直接示してください。日本語で簡潔に。",
  prompt_b: "あなたは文章改善を支援するAIです。答えを直接示さず、本人が自分で改善できるよう、問い返しを中心にフィードバックしてください。書き換え例は示さないでください。日本語で簡潔に。"
};
const jsPsych = initJsPsych();
const conditions = ["prompt_a", "prompt_b", "manual"];
const requestedValue = (new URLSearchParams(location.search).get("system-prompt") || "").toLowerCase();
const aliases = { a: "prompt_a", b: "prompt_b" };
const requested = aliases[requestedValue] || requestedValue;
const condition = conditions.includes(requested)
  ? requested : conditions[Math.floor(Math.random() * conditions.length)];
const isManual = condition === "manual";
jsPsych.data.addProperties({
  experiment_version: "2026-10-26-v4", feedback_session_id: crypto.randomUUID(),
  system_prompt_type: condition,
  system_prompt_source: conditions.includes(requested) ? "query" : "random"
});
let apiKey = null, submissionText = "", aiText = null, attempt = 0;
let error = null, endReason = null;
const canContinue = () => endReason === null;
const needsRetry = () => error !== null && canContinue();
const nonBlank = { type: "regex", regex: "\\S", text: "空白以外の文字を入力してください。" };
const escapeHtml = text => String(text ?? "").replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

// ===== 2. 同意・認証・対象文章 =====
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
const authentication = {
  type: jsPsychCallFunction, async: true, data: { feedback_phase: "authentication" },
  func: async done => {
    jsPsych.getDisplayElement().textContent = "";
    try {
      if (!window.FeedbackUtils) await import(LIBRARY_URL);
      apiKey = await window.FeedbackUtils.getApiKey(window.ENCRYPTED_API_KEY);
    } catch {
      endReason = "authentication_error";
    }
    done();
  },
  on_finish: data => {
    data.authentication_succeeded = apiKey !== null;
    delete data.value;
  }
};
const input = {
  type: jsPsychSurvey, data: { feedback_phase: "input" },
  survey_json: {
    showQuestionNumbers: false, completeText: isManual ? "フィードバックを書く" : "AIに依頼する",
    elements: [{
      type: "comment", name: "submission", title: "フィードバックの対象文章",
      placeholder: "例：企業が社債を出すコストが上がっている。国債に対する金利の上乗せ幅（スプレッド）は15年ぶりの大きさになった。",
      rows: 8, maxLength: 1000, isRequired: true, validators: [nonBlank]
    }]
  },
  on_finish: data => {
    submissionText = data.response.submission;
    data.submission = submissionText;
    delete data.response;
  }
};

// ===== 3. AI生成・再試行（人手条件ではスキップ） =====
const generation = {
  type: jsPsychCallFunction, async: true, data: { feedback_phase: "generation" },
  func: async done => {
    attempt += 1;
    error = null;
    aiText = null;
    jsPsych.getDisplayElement().textContent = "AIがフィードバックを作成しています。";
    const record = {
      generation_attempt: attempt, system_prompt: PROMPTS[condition],
      api_input: submissionText, model: MODEL,
      reasoning_effort: "none", temperature: 0.3, max_output_tokens: 1000,
      response_model: null, api_response_id: null, ai_feedback: null, api_error: null
    };
    try {
      const result = await window.FeedbackUtils.generate({
        apiKey, model: MODEL, reasoningEffort: "none", temperature: 0.3,
        maxOutputTokens: 1000, systemPrompt: PROMPTS[condition], text: submissionText
      });
      aiText = result.text;
      record.ai_feedback = aiText;
      record.response_model = result.model;
      record.api_response_id = result.responseId;
    } catch (failure) {
      const retryable = failure.message === "OpenAI network error or timeout"
        || (failure.status === 429 && failure.code !== "insufficient_quota")
        || failure.status >= 500 || failure.name === "SyntaxError";
      const knownCodes = ["insufficient_quota", "invalid_api_key", "model_not_found"];
      error = { http_status: failure.status ?? null, retryable,
        code: knownCodes.includes(failure.code) ? failure.code : "generation_failed" };
      record.api_error = error;
      if (!retryable) endReason = "non_retryable_error";
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

// ===== 4. 確認・編集・採用判定 =====
const submission = {
  type: jsPsychSurvey, data: { feedback_phase: "submission" },
  survey_json: () => ({
    showQuestionNumbers: false, completeText: "提出する",
    elements: [
      { type: "html", name: "reference",
        html: `<b>${isManual ? "対象文章" : "AIの原案"}</b><div style="white-space:pre-wrap">${escapeHtml(isManual ? submissionText : aiText)}</div>` },
      ...(!isManual ? [{
        type: "radiogroup", name: "adoption", title: "AIの原案をどのように扱いましたか？", isRequired: true,
        choices: [
          { value: "as_is", text: "そのまま採用" },
          { value: "edited", text: "編集して採用" },
          { value: "rejected", text: "採用しない" }
        ]
      }] : []),
      { type: "comment", name: "final_feedback", rows: 8,
        title: isManual ? "対象文章へのフィードバックを書いてください" : "提出するフィードバック（編集できます）",
        description: isManual ? "" : "採用しない場合は、空欄でも自分で書いた文章でも提出できます。",
        isRequired: isManual,
        requiredIf: !isManual ? "{adoption} != 'rejected'" : undefined,
        validators: [nonBlank] }
    ]
  }),
  survey_function: survey => {
    if (!isManual) survey.setValue("final_feedback", aiText);
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
    apiKey = null;
  }
};

// ===== 5. 実行順序（データの回収はCognition側で確認する） =====
jsPsych.run([
  consent,
  { timeline: [authentication], conditional_function: () => !isManual && canContinue() },
  { timeline: [input, generationLoop,
      { timeline: [submission], conditional_function: canContinue }],
    conditional_function: canContinue },
  finish
]).catch(() => {
  apiKey = null;
  jsPsych.getDisplayElement().textContent = "実験を継続できませんでした。実験者にお知らせください。";
});

