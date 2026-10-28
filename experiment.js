// Cognition の Source code に貼り付ける jsPsych 7/8 の例。
// External JS: feedback-utils.js、encrypted-api-key.js、survey 1.0.1。
// survey CSS も External CSS に登録し、html-button-response/call-function を有効にする。
const PROMPTS = {
  prompt_a: "あなたは文章改善を支援するAIです。対象文章の改善点と具体的な改善案（書き換え例を含む）を直接示してください。日本語で簡潔に。",
  prompt_b: "あなたは文章改善を支援するAIです。答えを直接示さず、本人が自分で改善できるよう、問い返しを中心にフィードバックしてください。書き換え例は示さないでください。日本語で簡潔に。"
};
const SETTINGS = { model: "gpt-6-luna", reasoningEffort: "none", temperature: 0.3, maxOutputTokens: 1000 };
const MAX_ATTEMPTS = 3;
const CONDITIONS = [
  { condition: "prompt_a" },
  { condition: "prompt_b" },
  { condition: "manual" }
];

const jsPsych = initJsPsych({ on_finish: () => FeedbackUtils.clearKey() });
let password = null; // 認証trialへ渡した直後に消し、trial dataには保存しません。
jsPsych.data.addProperties({
  experiment_version: "2026-10-28-standard-trials-4",
  feedback_session_id: crypto.randomUUID()
});

const consent = {
  type: jsPsychHtmlButtonResponse,
  data: { feedback_phase: "consent" },
  stimulus: `<p>文章へのフィードバックに関する実験です。課題は3件で、順序はランダムです。</p>
    <p>prompt_aとprompt_bではAIの原案を確認・編集して提出し、manualでは自分でフィードバックを作成します。対象文章はAI条件でOpenAIへ送信します。</p>
    <p>各課題の入力・AIの出力（AI条件のみ）・提出文・操作を記録します。個人情報は入力しないでください。</p>`,
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
    showQuestionNumbers: "off", showCompletedPage: false, completeText: "次へ",
    elements: [{ type: "comment", name: "submission", title: "フィードバックの対象文章",
      description: "対象文章を入力してください。", rows: 8, maxLength: 1000, isRequired: true,
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
    const condition = inputRow.system_prompt_type;
    const attempts = jsPsych.data.get().filter({ feedback_phase: "generation", system_prompt_type: condition }).count();
    const systemPrompt = PROMPTS[condition];
    const record = {
      generation_attempt: attempts + 1,
      system_prompt: systemPrompt,
      api_input: inputRow.submission,
      model: SETTINGS.model,
      reasoning_effort: SETTINGS.reasoningEffort,
      temperature: SETTINGS.temperature,
      max_output_tokens: SETTINGS.maxOutputTokens
    };
    FeedbackUtils.generate({ ...SETTINGS, systemPrompt, text: inputRow.submission },
      result => done({ ...record, ...result }));
  },
  on_finish: data => { Object.assign(data, data.value); delete data.value; }
};

const retryDecision = {
  type: jsPsychHtmlButtonResponse,
  data: { feedback_phase: "retry_decision" },
  stimulus: "<p>AIの応答を取得できませんでした。再試行しますか？</p>",
  choices: ["再試行", "この課題を終了"],
  on_finish: data => { data.retry_choice = data.response === 0 ? "retry" : "end"; }
};

const generationLoop = {
  timeline: [generation, {
    timeline: [retryDecision],
    conditional_function: () => {
      const inputRow = jsPsych.data.get().filter({ feedback_phase: "input" }).last(1).values()[0];
      const rows = jsPsych.data.get().filter({ feedback_phase: "generation", system_prompt_type: inputRow.system_prompt_type });
      if (rows.count() === 0) return false;
      const last = rows.last(1).values()[0];
      return Boolean(last.api_error && last.api_error.retryable === true && rows.count() < MAX_ATTEMPTS);
    }
  }],
  conditional_function: () => {
    const inputRow = jsPsych.data.get().filter({ feedback_phase: "input" }).last(1).values()[0];
    return inputRow.system_prompt_type !== "manual";
  },
  loop_function: () => {
    const inputRow = jsPsych.data.get().filter({ feedback_phase: "input" }).last(1).values()[0];
    const condition = inputRow.system_prompt_type;
    const rows = jsPsych.data.get().filter({ feedback_phase: "generation", system_prompt_type: condition });
    if (rows.count() === 0) return false;
    const last = rows.last(1).values()[0];
    if (!last.api_error || last.api_error.retryable !== true || rows.count() >= MAX_ATTEMPTS) return false;
    const retries = jsPsych.data.get().filter({ feedback_phase: "retry_decision", system_prompt_type: condition });
    return retries.count() > 0 && retries.last(1).values()[0].response === 0;
  }
};

const manualSubmission = {
  type: jsPsychSurvey,
  data: { feedback_phase: "submission" },
  survey_json: {
    showQuestionNumbers: "off", showCompletedPage: false, completeText: "提出する",
    elements: [{ type: "comment", name: "final_feedback",
      title: "対象文章へのフィードバックを書いてください", rows: 8, isRequired: true,
      requiredErrorText: "フィードバックを入力してください。" }]
  },
  on_finish: data => {
    const inputRow = jsPsych.data.get().filter({ feedback_phase: "input" }).last(1).values()[0];
    data.submission = inputRow.submission;
    data.ai_feedback = null;
    data.final_feedback = data.response.final_feedback;
    data.generation_attempt = 0;
    data.text_changed = null;
    data.adoption = null;
    delete data.response;
  }
};

const aiSubmission = {
  type: jsPsychSurvey,
  data: { feedback_phase: "submission" },
  survey_json: {
    showQuestionNumbers: "off", showCompletedPage: false, completeText: "提出する",
    elements: [
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
    const inputRow = jsPsych.data.get().filter({ feedback_phase: "input" }).last(1).values()[0];
    const generationRow = jsPsych.data.get().filter({ feedback_phase: "generation", system_prompt_type: inputRow.system_prompt_type }).last(1).values()[0];
    survey.setValue("ai_draft", generationRow.ai_feedback);
    survey.setValue("final_feedback", generationRow.ai_feedback);
  },
  on_finish: data => {
    const response = data.response || {};
    const inputRow = jsPsych.data.get().filter({ feedback_phase: "input" }).last(1).values()[0];
    const generationRow = jsPsych.data.get().filter({ feedback_phase: "generation", system_prompt_type: inputRow.system_prompt_type }).last(1).values()[0];
    const finalFeedback = response.adoption === "rejected" && !/\S/.test(response.final_feedback ?? "")
      ? "" : response.final_feedback ?? "";
    data.submission = inputRow.submission;
    data.ai_feedback = generationRow.ai_feedback;
    data.final_feedback = finalFeedback;
    data.generation_attempt = generationRow.generation_attempt;
    data.text_changed = finalFeedback !== generationRow.ai_feedback;
    data.adoption = response.adoption ?? null;
    delete data.response;
  }
};

const conditionFinish = {
  type: jsPsychHtmlButtonResponse,
  data: { feedback_phase: "condition_finish" },
  stimulus: "<p>この課題を終了しました。次の課題へ進んでください。</p>",
  choices: ["次へ"],
  on_finish: data => {
    const condition = data.system_prompt_type;
    const submissions = jsPsych.data.get().filter({ feedback_phase: "submission", system_prompt_type: condition });
    data.feedback_phase = submissions.count() > 0 ? "complete" : "termination";
    data.termination_reason = null;
    if (submissions.count() === 0 && condition !== "manual") {
      const generations = jsPsych.data.get().filter({ feedback_phase: "generation", system_prompt_type: condition });
      const retries = jsPsych.data.get().filter({ feedback_phase: "retry_decision", system_prompt_type: condition });
      const last = generations.count() > 0 ? generations.last(1).values()[0] : null;
      if (last && last.api_error) {
        if (!last.api_error.retryable) data.termination_reason = "non_retryable_error";
        else if (last.generation_attempt >= MAX_ATTEMPTS) data.termination_reason = "max_attempts_reached";
        else if (retries.count() > 0 && retries.last(1).values()[0].response === 1) data.termination_reason = "participant_ended_after_error";
        else data.termination_reason = "generation_error";
      }
    }
  }
};

const taskTimeline = {
  timeline: [input, generationLoop,
    { timeline: [manualSubmission], conditional_function: () =>
      jsPsych.data.get().filter({ feedback_phase: "input" }).last(1).values()[0].system_prompt_type === "manual" },
    { timeline: [aiSubmission], conditional_function: () => {
      const inputRow = jsPsych.data.get().filter({ feedback_phase: "input" }).last(1).values()[0];
      if (inputRow.system_prompt_type === "manual") return false;
      const rows = jsPsych.data.get().filter({ feedback_phase: "generation", system_prompt_type: inputRow.system_prompt_type });
      return rows.count() > 0 && !rows.last(1).values()[0].api_error;
    } },
    conditionFinish
  ],
  timeline_variables: CONDITIONS,
  randomize_order: true,
  data: { system_prompt_type: jsPsych.timelineVariable("condition") },
  conditional_function: () => {
    const consentRow = jsPsych.data.get().filter({ feedback_phase: "consent" }).last(1).values()[0];
    const authRows = jsPsych.data.get().filter({ feedback_phase: "authentication" });
    return consentRow.response === 0 && authRows.count() > 0 && authRows.last(1).values()[0].authentication_succeeded;
  }
};

const authenticationTimeline = {
  timeline: [passwordEntry, authentication],
  conditional_function: () => jsPsych.data.get().filter({ feedback_phase: "consent" }).last(1).values()[0].response === 0
};

const sessionFinish = {
  type: jsPsychHtmlButtonResponse,
  data: { feedback_phase: "session_end" },
  stimulus: () => {
    const consentRow = jsPsych.data.get().filter({ feedback_phase: "consent" }).last(1).values()[0];
    if (consentRow.response !== 0) return "<p>実験を終了します。</p>";
    const authRows = jsPsych.data.get().filter({ feedback_phase: "authentication" });
    if (authRows.count() > 0 && !authRows.last(1).values()[0].authentication_succeeded)
      return "<p>実験を開始できませんでした。実験者にお知らせください。</p>";
    const submissions = jsPsych.data.get().filter({ feedback_phase: "submission" });
    if (submissions.count() === CONDITIONS.length) return "<p>提出を受け付けました。ご協力ありがとうございました。</p>";
    return "<p>実験を終了しました。実験者にお知らせください。</p>";
  },
  choices: ["終了"],
  on_finish: data => {
    const consentRow = jsPsych.data.get().filter({ feedback_phase: "consent" }).last(1).values()[0];
    const authRows = jsPsych.data.get().filter({ feedback_phase: "authentication" });
    const terminations = jsPsych.data.get().filter({ feedback_phase: "termination" });
    const submissions = jsPsych.data.get().filter({ feedback_phase: "submission" });
    data.termination_reason = null;
    if (consentRow.response !== 0) data.termination_reason = "declined_consent";
    else if (authRows.count() > 0 && !authRows.last(1).values()[0].authentication_succeeded) data.termination_reason = "authentication_error";
    else if (submissions.count() < CONDITIONS.length && terminations.count() > 0)
      data.termination_reason = terminations.last(1).values()[0].termination_reason;
  }
};

const timeline = [];
timeline.push(consent);
timeline.push(authenticationTimeline);
timeline.push(taskTimeline);
timeline.push(sessionFinish);
jsPsych.run(timeline);
