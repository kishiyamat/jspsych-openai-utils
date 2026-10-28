// CognitionのSource codeへ貼り付ける実験本体（jsPsych 7/8）。
// 必要プラグイン: html-button-response / survey-html-form / call-function。
// 条件・課題画面・研究用の記録項目と、実行順をここに置きます。

// ===== 1. 実験設定 =====
const RUNNER_URL = "https://cdn.jsdelivr.net/gh/kishiyamat/jspsych-openai-utils@27f1112f316d204fa144a3dd151603cb218442b0/dist/feedback-runner.js";

function defineStudy({ jsPsych, createFeedbackFlow }) {
  const GENERATION_SETTINGS = Object.freeze({
    model: "gpt-6-luna",
    reasoningEffort: "none",
    temperature: 0.3,
    maxOutputTokens: 1000
  });
  const MAX_ATTEMPTS = 3;
  const PROMPTS = {
    prompt_a: "あなたは文章改善を支援するAIです。対象文章の改善点と具体的な改善案（書き換え例を含む）を直接示してください。日本語で簡潔に。",
    prompt_b: "あなたは文章改善を支援するAIです。答えを直接示さず、本人が自分で改善できるよう、問い返しを中心にフィードバックしてください。書き換え例は示さないでください。日本語で簡潔に。"
  };
  const conditions = ["prompt_a", "prompt_b", "manual"];
  const requestedValue = (jsPsych.data.getURLVariable("system-prompt") || "").toLowerCase();
  const aliases = { a: "prompt_a", b: "prompt_b" };
  const requested = aliases[requestedValue] || requestedValue;
  const conditionSource = conditions.includes(requested) ? "query" : "random";
  const condition = conditionSource === "query"
    ? requested : jsPsych.randomization.sampleWithoutReplacement(conditions, 1)[0];
  const isManual = condition === "manual";

  jsPsych.data.addProperties({
    experiment_version: "2026-10-28-v11",
    feedback_session_id: crypto.randomUUID(),
    system_prompt_type: condition,
    system_prompt_source: conditionSource
  });

  let submissionText = "";
  let endReason = null;
  let feedbackFlow;
  const terminationReason = () => endReason ?? feedbackFlow?.terminationReason ?? null;
  const canContinue = () => terminationReason() === null;
  const needsRetry = () => feedbackFlow?.canRetry === true && canContinue();

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

  // ===== 3. LLMセッション =====
  feedbackFlow = createFeedbackFlow({
    getEncryptedApiKey: () => isManual ? null : window.ENCRYPTED_API_KEY,
    generationSettings: GENERATION_SETTINGS,
    getRequest: () => ({ systemPrompt: PROMPTS[condition], text: submissionText }),
    maxAttempts: MAX_ATTEMPTS
  });

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
      window.FeedbackUtils.bindNonBlankText(form, "submission");
    },
    on_finish: data => {
      submissionText = data.response.submission;
      data.submission = submissionText;
      delete data.response;
    }
  };

  // ===== 5. エラー時の再試行 =====
  const retry = {
    type: jsPsychHtmlButtonResponse, data: { feedback_phase: "retry_decision" },
    stimulus: "<p>AIの応答を取得できませんでした。再試行しますか？</p>",
    choices: ["再試行", "終了"],
    on_finish: data => {
      data.generation_attempt = feedbackFlow.attempt;
      data.retry_choice = data.response === 0 ? "retry" : "end";
      if (data.response === 1) endReason = "participant_ended_after_error";
    }
  };
  const generationLoop = {
    timeline: [feedbackFlow.generationTrial, { timeline: [retry], conditional_function: needsRetry }],
    conditional_function: () => !isManual,
    loop_function: needsRetry
  };

  // ===== 6. 原案の確認・提出 =====
  const submission = {
    type: jsPsychSurveyHtmlForm, data: { feedback_phase: "submission" },
    preamble: () => `<div><b>${isManual ? "対象文章" : "AIの原案"}</b>
        <div style="white-space:pre-wrap">${window.FeedbackUtils.escapeHtml(isManual ? submissionText : feedbackFlow.feedback)}</div></div>`,
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
            style="display:block;width:100%;box-sizing:border-box;font:inherit">${window.FeedbackUtils.escapeHtml(feedbackFlow.feedback)}</textarea>`,
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
      data.ai_feedback = isManual ? null : feedbackFlow.feedback;
      data.final_feedback = finalText;
      data.generation_attempt = feedbackFlow.attempt;
      data.text_changed = isManual ? null : finalText !== feedbackFlow.feedback;
      data.adoption = isManual ? null : response.adoption;
      delete data.response;
    }
  };

  // ===== 7. 終了 =====
  const finish = {
    type: jsPsychHtmlButtonResponse,
    stimulus: () => {
      if (terminationReason() === null) return "<p>提出を受け付けました。ご協力ありがとうございました。</p>";
      if (endReason === "declined_consent") return "<p>実験を終了します。</p>";
      return "<p>実験を途中で終了しました。実験者にお知らせください。</p>";
    },
    choices: ["終了"],
    on_finish: data => {
      data.feedback_phase = terminationReason() === null ? "complete" : "termination";
      data.termination_reason = terminationReason();
      data.generation_attempt = feedbackFlow.attempt;
    }
  };

  // ===== 8. 実行順 =====
  const preparationTimeline = {
    timeline: [feedbackFlow.preparationTrial], conditional_function: canContinue
  };
  const authenticationTimeline = {
    timeline: [feedbackFlow.authenticationTrial], conditional_function: () => !isManual && canContinue()
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
  return timeline;
}

import(RUNNER_URL)
  .then(({ runStudy }) => runStudy(defineStudy, { initJsPsych, callFunctionPlugin: jsPsychCallFunction }))
  .catch(() => {
    document.body.textContent = "実験を開始できませんでした。実験者にお知らせください。";
  });
