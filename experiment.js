// Cognition の Source code に貼り付ける jsPsych 7/8 の例。
// External JS: feedback-utils.js、encrypted-api-key.js、survey 1.0.1。
// survey CSS も External CSS に登録し、html-button-response/call-function を有効にする。
const PROMPTS = {
  prompt_a: "あなたは文章改善を支援するAIです。対象文章の改善点と具体的な改善案（書き換え例を含む）を直接示してください。日本語で簡潔に。",
  prompt_b: "あなたは文章改善を支援するAIです。答えを直接示さず、本人が自分で改善できるよう、問い返しを中心にフィードバックしてください。書き換え例は示さないでください。日本語で簡潔に。"
};
const SETTINGS = { model: "gpt-6-luna", reasoningEffort: "none", temperature: 0.3, maxOutputTokens: 1000 };
const CONDITIONS = [
  { condition: "prompt_a" },
  { condition: "prompt_b" },
  { condition: "manual" }
];

const jsPsych = initJsPsych({ on_finish: () => FeedbackUtils.clearKey() });
let password = null; // 認証trialへ渡した直後に消し、trial dataには保存しません。

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
    const systemPrompt = PROMPTS[condition];
    const record = {
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

const generationFailure = {
  type: jsPsychHtmlButtonResponse,
  data: { feedback_phase: "generation_failure_notice" },
  stimulus: "<p>AIの応答を取得できませんでした。この課題を終了します。</p>",
  choices: ["次の課題へ"]
};

const submission = {
  type: jsPsychSurvey,
  data: { feedback_phase: "submission" },
  survey_json: {
    showQuestionNumbers: "off", showCompletedPage: false, completeText: "提出する",
    elements: [{ type: "comment", name: "final_feedback", title: "対象文章へのフィードバック",
      placeholder: "対象文章へのフィードバックを入力してください", rows: 8, isRequired: true,
      requiredErrorText: "フィードバックを入力してください。" }]
  },
  survey_function: survey => {
    const inputRow = jsPsych.data.get().filter({ feedback_phase: "input" }).last(1).values()[0];
    if (inputRow.system_prompt_type !== "manual") {
      const generationRow = jsPsych.data.get().filter({ feedback_phase: "generation", system_prompt_type: inputRow.system_prompt_type }).last(1).values()[0];
      survey.setValue("final_feedback", generationRow.ai_feedback);
    }
  },
  on_finish: data => {
    const inputRow = jsPsych.data.get().filter({ feedback_phase: "input" }).last(1).values()[0];
    const finalFeedback = data.response.final_feedback;
    data.submission = inputRow.submission;
    data.final_feedback = finalFeedback;
    if (inputRow.system_prompt_type === "manual") {
      data.ai_feedback = null;
      data.generation_attempt = 0;
      data.text_changed = null;
    } else {
      const generationRow = jsPsych.data.get().filter({ feedback_phase: "generation", system_prompt_type: inputRow.system_prompt_type }).last(1).values()[0];
      data.ai_feedback = generationRow.ai_feedback;
      data.generation_attempt = generationRow.generation_attempt;
      data.text_changed = finalFeedback !== generationRow.ai_feedback;
    }
    delete data.response;
  }
};

const aiCondition = {
  timeline: [generation,
    { timeline: [submission], conditional_function: () =>
      !jsPsych.data.get().filter({ feedback_phase: "generation" }).last(1).values()[0].api_error },
    { timeline: [generationFailure], conditional_function: () =>
      Boolean(jsPsych.data.get().filter({ feedback_phase: "generation" }).last(1).values()[0].api_error) }
  ],
  conditional_function: () =>
    jsPsych.data.get().filter({ feedback_phase: "input" }).last(1).values()[0].system_prompt_type !== "manual"
};

const manualCondition = {
  timeline: [submission],
  conditional_function: () =>
    jsPsych.data.get().filter({ feedback_phase: "input" }).last(1).values()[0].system_prompt_type === "manual"
};

const taskTimeline = {
  timeline: [input, aiCondition, manualCondition],
  timeline_variables: CONDITIONS,
  randomize_order: true,
  data: { system_prompt_type: jsPsych.timelineVariable("condition") },
  conditional_function: () => {
    const consentRow = jsPsych.data.get().filter({ feedback_phase: "consent" }).last(1).values()[0];
    if (consentRow.response !== 0) return false;
    return jsPsych.data.get().filter({ feedback_phase: "authentication" }).last(1).values()[0].authentication_succeeded;
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
    const authentication = jsPsych.data.get().filter({ feedback_phase: "authentication" }).last(1).values()[0];
    if (!authentication.authentication_succeeded)
      return "<p>実験を開始できませんでした。実験者にお知らせください。</p>";
    return "<p>ご協力ありがとうございました。</p>";
  },
  choices: ["終了"]
};

const timeline = [];
timeline.push(consent);
timeline.push(authenticationTimeline);
timeline.push(taskTimeline);
timeline.push(sessionFinish);
jsPsych.run(timeline);
