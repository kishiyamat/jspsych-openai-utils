// Cognition の Source code に貼り付ける標準 jsPsych 7/8 の例。
// External JS: feedback-utils.js、encrypted-api-key.js、survey 1.0.1。
// survey CSS も External CSS に登録し、html-button-response/call-function を有効にする。
// survey selector は有効にしない（二重読込を避ける）。
const PROMPTS = {
  prompt_a: "あなたは文章改善を支援するAIです。対象文章の改善点と具体的な改善案（書き換え例を含む）を直接示してください。日本語で簡潔に。",
  prompt_b: "あなたは文章改善を支援するAIです。答えを直接示さず、本人が自分で改善できるよう、問い返しを中心にフィードバックしてください。書き換え例は示さないでください。日本語で簡潔に。"
};
const SETTINGS = { model: "gpt-6-luna", reasoningEffort: "none", temperature: 0.3, maxOutputTokens: 1000 };
const MAX_ATTEMPTS = 3;
const CONDITIONS = ["prompt_a", "prompt_b", "manual"];

const jsPsych = initJsPsych({ on_finish: () => FeedbackUtils.clearKey() });
let password = null; // 認証trialへ渡した直後に消し、trial dataには保存しません。
const aliases = { a: "prompt_a", b: "prompt_b" };
const query = (jsPsych.data.getURLVariable("system-prompt") || "").toLowerCase();
const requested = aliases[query] || query;
const conditionSource = CONDITIONS.includes(requested) ? "query" : "random";
const condition = conditionSource === "query"
  ? requested : jsPsych.randomization.sampleWithoutReplacement(CONDITIONS, 1)[0];
const isManual = condition === "manual";
jsPsych.data.addProperties({
  experiment_version: "2026-10-28-standard-trials-3",
  feedback_session_id: crypto.randomUUID(),
  system_prompt_type: condition,
  system_prompt_source: conditionSource
});

const consent = {
  type: jsPsychHtmlButtonResponse,
  data: { feedback_phase: "consent" },
  stimulus: `<p>文章へのフィードバックに関する実験です。課題は1件です。</p>
    <p>${isManual ? "対象文章と、その文章へのフィードバックを自分で入力します。AIは使用しません。"
      : "対象文章を入力し、AIのフィードバックを確認・編集して提出します。対象文章をOpenAIへ送信します。"}</p>
    <p>入力・AIの出力（AI条件のみ）・提出文・操作を記録します。個人情報は入力しないでください。</p>`,
  choices: ["同意する", "同意しない"]
};

const passwordEntry = {
  type: jsPsychSurvey,
  data: { feedback_phase: "password_entry" },
  survey_json: {
    showQuestionNumbers: "off", showCompletedPage: false, completeText: "開始",
    elements: [{ type: "text", name: "password", title: "実験用パスワード",
      inputType: "password", autocomplete: "off", isRequired: true,
      requiredErrorText: "パスワードを入力してください。" }]
  },
  on_finish: data => {
    password = data.response.password;
    delete data.response;
  }
};

const authentication = {
  type: jsPsychCallFunction,
  async: true,
  data: { feedback_phase: "authentication" },
  func: done => {
    const suppliedPassword = password;
    password = null;
    FeedbackUtils.decryptApiKey(window.ENCRYPTED_API_KEY, suppliedPassword, done);
  },
  on_finish: data => { Object.assign(data, data.value); delete data.value; }
};

const input = {
  type: jsPsychSurvey,
  data: { feedback_phase: "input" },
  survey_json: {
    showQuestionNumbers: "off", showCompletedPage: false,
    completeText: isManual ? "フィードバックを書く" : "AIに依頼する",
    elements: [{ type: "comment", name: "submission", title: "フィードバックの対象文章",
      description: isManual ? "対象文章を入力してください。" : "AIに見せる文章を入力してください。",
      rows: 8, maxLength: 1000, isRequired: true,
      requiredErrorText: "空白以外の文章を入力してください。" }]
  },
  on_finish: data => {
    data.submission = data.response.submission;
    delete data.response;
  }
};

const generation = {
  type: jsPsychCallFunction,
  async: true,
  on_load: () => { jsPsych.getDisplayElement().textContent = "AIの応答を待っています。"; },
  data: { feedback_phase: "generation" },
  func: done => {
    const inputRow = jsPsych.data.get().filter({ feedback_phase: "input" }).last(1).values()[0];
    const attempt = jsPsych.data.get().filter({ feedback_phase: "generation" }).count() + 1;
    const record = {
      generation_attempt: attempt,
      system_prompt: PROMPTS[condition],
      api_input: inputRow.submission,
      model: SETTINGS.model,
      reasoning_effort: SETTINGS.reasoningEffort,
      temperature: SETTINGS.temperature,
      max_output_tokens: SETTINGS.maxOutputTokens
    };
    FeedbackUtils.generate({ ...SETTINGS, systemPrompt: PROMPTS[condition], text: inputRow.submission },
      result => done({ ...record, ...result }));
  },
  on_finish: data => { Object.assign(data, data.value); delete data.value; }
};

const retryDecision = {
  type: jsPsychHtmlButtonResponse,
  data: { feedback_phase: "retry_decision" },
  stimulus: "<p>AIの応答を取得できませんでした。再試行しますか？</p>",
  choices: ["再試行", "終了"],
  on_finish: data => { data.retry_choice = data.response === 0 ? "retry" : "end"; }
};
const generationLoop = {
  timeline: [generation, {
    timeline: [retryDecision],
    conditional_function: () => {
      const generationRows = jsPsych.data.get().filter({ feedback_phase: "generation" });
      if (generationRows.count() === 0) return false;
      const last = generationRows.last(1).values()[0];
      if (!last.api_error) return false;
      return last.api_error.retryable === true && generationRows.count() < MAX_ATTEMPTS;
    }
  }],
  conditional_function: () => !isManual,
  loop_function: () => {
    const generationRows = jsPsych.data.get().filter({ feedback_phase: "generation" });
    if (generationRows.count() === 0) return false;
    const last = generationRows.last(1).values()[0];
    if (!last.api_error || last.api_error.retryable !== true
        || generationRows.count() >= MAX_ATTEMPTS) return false;
    const retryRows = jsPsych.data.get().filter({ feedback_phase: "retry_decision" });
    return retryRows.count() > 0 && retryRows.last(1).values()[0].response === 0;
  }
};

const submission = {
  type: jsPsychSurvey,
  data: { feedback_phase: "submission" },
  survey_json: {
    showQuestionNumbers: "off", showCompletedPage: false, completeText: "提出する",
    elements: isManual ? [{ type: "comment", name: "final_feedback",
      title: "対象文章へのフィードバックを書いてください", rows: 8, isRequired: true,
      requiredErrorText: "フィードバックを入力してください。" }] : [
      { type: "comment", name: "ai_draft", title: "AIの原案", readOnly: true, rows: 8 },
      { type: "radiogroup", name: "adoption", title: "AIの原案をどのように扱いましたか？", isRequired: true,
        requiredErrorText: "採用方法を選んでください。", choices: [
          { value: "as_is", text: "そのまま採用" },
          { value: "edited", text: "編集して採用" },
          { value: "rejected", text: "採用しない" }
        ] },
      { type: "comment", name: "final_feedback", title: "提出するフィードバック（編集できます）",
        description: "採用しない場合は、空欄でも自分で書いた文章でも提出できます。", rows: 8,
        requiredErrorText: "フィードバックを入力してください。",
        requiredIf: "{adoption} notempty and {adoption} != 'rejected'" }
    ]
  },
  survey_function: survey => {
    if (!isManual) {
      const generationRow = jsPsych.data.get().filter({ feedback_phase: "generation" }).last(1).values()[0];
      survey.setValue("ai_draft", generationRow.ai_feedback);
      survey.setValue("final_feedback", generationRow.ai_feedback);
    }
  },
  on_finish: data => {
    const response = data.response || {};
    const generationRow = jsPsych.data.get().filter({ feedback_phase: "generation" }).last(1).values()[0];
    const finalFeedback = !isManual && response.adoption === "rejected"
      && !/\S/.test(response.final_feedback ?? "") ? "" : response.final_feedback ?? "";
    data.submission = jsPsych.data.get().filter({ feedback_phase: "input" }).last(1).values()[0].submission;
    data.ai_feedback = isManual ? null : generationRow.ai_feedback;
    data.final_feedback = finalFeedback;
    data.generation_attempt = isManual ? 0 : generationRow.generation_attempt;
    data.text_changed = isManual ? null : finalFeedback !== generationRow.ai_feedback;
    data.adoption = isManual ? null : response.adoption ?? null;
    delete data.response;
  }
};

const finish = {
  type: jsPsychHtmlButtonResponse,
  stimulus: () => {
    const consentRow = jsPsych.data.get().filter({ feedback_phase: "consent" }).last(1).values()[0];
    const submitted = jsPsych.data.get().filter({ feedback_phase: "submission" }).count() > 0;
    if (consentRow.response !== 0) return "<p>実験を終了します。</p>";
    if (submitted) return "<p>提出を受け付けました。ご協力ありがとうございました。</p>";
    return "<p>実験を途中で終了しました。実験者にお知らせください。</p>";
  },
  choices: ["終了"],
  on_finish: data => {
    const consentRow = jsPsych.data.get().filter({ feedback_phase: "consent" }).last(1).values()[0];
    const authRows = jsPsych.data.get().filter({ feedback_phase: "authentication" });
    const generationRows = jsPsych.data.get().filter({ feedback_phase: "generation" });
    const retryRows = jsPsych.data.get().filter({ feedback_phase: "retry_decision" });
    const submissionRows = jsPsych.data.get().filter({ feedback_phase: "submission" });
    const auth = authRows.count() > 0 ? authRows.last(1).values()[0] : null;
    const generation = generationRows.count() > 0 ? generationRows.last(1).values()[0] : null;
    const retry = retryRows.count() > 0 ? retryRows.last(1).values()[0] : null;
    data.feedback_phase = submissionRows.count() > 0 ? "complete" : "termination";
    data.termination_reason = null;
    if (submissionRows.count() === 0) {
      if (consentRow.response !== 0) data.termination_reason = "declined_consent";
      else if (auth && !auth.authentication_succeeded) data.termination_reason = "authentication_error";
      else if (generation && generation.api_error) {
        if (!generation.api_error.retryable) data.termination_reason = "non_retryable_error";
        else if (retry && retry.response === 1) data.termination_reason = "participant_ended_after_error";
        else if (generation.generation_attempt >= MAX_ATTEMPTS) data.termination_reason = "max_attempts_reached";
        else data.termination_reason = "generation_error";
      }
    }
    data.generation_attempt = generation ? generation.generation_attempt : 0;
  }
};

const taskTimeline = {
  timeline: [input, generationLoop, {
    timeline: [submission],
    conditional_function: () => {
      if (isManual) return true;
      const generationRows = jsPsych.data.get().filter({ feedback_phase: "generation" });
      return generationRows.count() > 0 && generationRows.last(1).values()[0].ai_feedback !== null;
    }
  }],
  conditional_function: () => {
    const consentRow = jsPsych.data.get().filter({ feedback_phase: "consent" }).last(1).values()[0];
    if (consentRow.response !== 0) return false;
    if (isManual) return true;
    const authRows = jsPsych.data.get().filter({ feedback_phase: "authentication" });
    return authRows.count() > 0 && authRows.last(1).values()[0].authentication_succeeded;
  }
};
const authenticationTimeline = {
  timeline: [passwordEntry, authentication],
  conditional_function: () => {
    const consentRow = jsPsych.data.get().filter({ feedback_phase: "consent" }).last(1).values()[0];
    return consentRow.response === 0 && !isManual;
  }
};

const timeline = [];
timeline.push(consent);
timeline.push(authenticationTimeline);
timeline.push(taskTimeline);
timeline.push(finish);
jsPsych.run(timeline);
