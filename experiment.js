// Cognition の Source code に貼り付ける jsPsych 8 / Survey 4 の例。
// External JS: encrypted-api-key.js。survey/html-button-response/call-function を有効にします。
// 条件ごとのAIへの指示と生成設定を、このファイルでまとめます。
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

// Survey 4 の画面を読みやすく整えます。
const experimentStyle = document.createElement("style");
experimentStyle.textContent = `
  .jspsych-content { box-sizing: border-box; width: calc(100% - 2rem); max-width: 48rem; }
  .sd-root-modern { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Yu Gothic", "Meiryo", sans-serif; }
  .sd-body { box-sizing: border-box; width: 100%; max-width: 48rem; padding: 1rem; }
  .sd-page__row { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; }
  .sd-element__title { line-height: 1.4; }
  .sd-input { font-size: 1rem; line-height: 1.5; }
  .sd-input--readonly { background-color: #f3f5f7; }
  textarea.sd-input { min-height: 6rem; max-width: 100%; }
  .sd-btn--action { min-height: 2.75rem; background-color: #23395d; border-color: #23395d; color: #fff; }
  @media (max-width: 600px) {
    .jspsych-content { width: calc(100% - 1rem); }
    .sd-body { padding: 0.75rem; }
  }
`;

// 実験終了時にAPIキーを消去し、担当者への連絡案内を表示します。
const jsPsych = initJsPsych({ on_finish: () => {
  FeedbackUtils.clearKey();
  jsPsych.getDisplayElement().textContent = "お疲れさまでした。実験担当者に連絡してください。";
} });
let password = null; // 認証trialへ渡した直後に消し、trial dataには保存しません。

// 最初に同意を確認し、同意しない場合は後続のtrialを条件分岐で省きます。
const consent = {
  type: jsPsychHtmlButtonResponse,
  data: { feedback_phase: "consent" },
  stimulus: `<p>文章へのフィードバックに関する実験です。課題は3件で、順序はランダムです。</p>
    <p>prompt_aとprompt_bではAIの原案を確認・編集して提出し、manualでは自分でフィードバックを作成します。対象文章はAI条件でOpenAIへ送信します。</p>
    <p>各課題の入力・AIの出力（AI条件のみ）・提出文・操作を記録します。個人情報は入力しないでください。</p>`,
  choices: ["同意する", "同意しない"]
};

// パスワードは復号にだけ使います。Surveyの回答をtrialへ残さないため、
// on_finishで一時変数へ移した後、data.responseごと削除します。
const passwordEntry = {
  type: jsPsychSurvey,
  min_width: "0px",
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

// async:trueではdone(結果)まで次へ進まず、結果はdata.valueへ入ります。
// on_finishで列へ展開し、パスワードや復号したAPIキーは記録しません。
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

// 入力した対象文章を、後続の生成・提出trialで使うsubmission列へ保存します。
const input = {
  type: jsPsychSurvey,
  min_width: "0px",
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

// 保存済みの直前input行と条件から依頼内容を作り、通信と再試行は共通ライブラリに任せます。
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

// 生成できなかった条件では提出欄を出さず、次の条件へ進みます。
const generationFailure = {
  type: jsPsychHtmlButtonResponse,
  data: { feedback_phase: "generation_failure_notice" },
  stimulus: "<p>AIの応答を取得できませんでした。この課題を終了します。</p>",
  choices: ["次の課題へ"]
};

// AI条件とmanual条件が同じ提出欄を使い、manualでは空欄から入力します。
const submission = {
  type: jsPsychSurvey,
  min_width: "0px",
  data: { feedback_phase: "submission" },
  survey_json: {
    showQuestionNumbers: "off", showCompletedPage: false, completeText: "提出する",
    elements: [
      { type: "comment", name: "source_text", title: "対象文章", rows: 7, readOnly: true },
      { type: "comment", name: "final_feedback", title: "対象文章へのフィードバック",
        placeholder: "対象文章へのフィードバックを入力してください", rows: 8, isRequired: true,
        requiredErrorText: "フィードバックを入力してください。" }
    ]
  },
  // 直近のinput trialを標準のjsPsych.dataから読み、対象文章とAI原文を欄へ設定します。
  survey_function: survey => {
    const inputRow = jsPsych.data.get().filter({ feedback_phase: "input" }).last(1).values()[0];
    survey.setValue("source_text", inputRow.submission);
    if (inputRow.system_prompt_type !== "manual") {
      const generationRow = jsPsych.data.get().filter({ feedback_phase: "generation", system_prompt_type: inputRow.system_prompt_type }).last(1).values()[0];
      survey.setValue("final_feedback", generationRow.ai_feedback);
    }
  },
  // 提出文は現在の回答から保存し、AI条件では保存済み原文と文字列で厳密に比べます。
  // manualには比較するAI原文がないため、ai_feedbackとtext_changedをnullにします。
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

// 同じ課題の中で、AI条件は生成後に成功なら提出、失敗なら案内を表示します。
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

// manual条件はAI生成を通らず、同じ提出欄だけを使います。
const manualCondition = {
  timeline: [submission],
  conditional_function: () =>
    jsPsych.data.get().filter({ feedback_phase: "input" }).last(1).values()[0].system_prompt_type === "manual"
};

// randomize_orderが3条件の提示順を無作為化し、親timelineの条件データは子trialへ引き継がれます。
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

// 同意した場合だけ、最初に1回パスワードを入力し、APIキーを復号します。
const authenticationTimeline = {
  timeline: [passwordEntry, authentication],
  conditional_function: () => jsPsych.data.get().filter({ feedback_phase: "consent" }).last(1).values()[0].response === 0
};

// セッションの記録を見て、同意拒否・認証失敗・完了に応じた終了案内を出します。
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

// 標準のjsPsych timelineへ、同意→認証→条件別課題→終了の順で登録します。
const timeline = [];
timeline.push(consent);
timeline.push(authenticationTimeline);
timeline.push(taskTimeline);
timeline.push(sessionFinish);

// 公式のSurvey CSSとGitHubの共通ライブラリを読み込んでから、実験を開始します。
const surveyStylesheet = document.createElement("link");
surveyStylesheet.rel = "stylesheet";
surveyStylesheet.href = "https://unpkg.com/@jspsych/plugin-survey@4.0.0/css/survey.min.css";
const feedbackUtilsScript = document.createElement("script");
feedbackUtilsScript.src = "https://cdn.jsdelivr.net/gh/kishiyamat/jspsych-openai-utils@1eb526cda0aad424f3efb4ddb1da926d099f5df1/dist/feedback-utils.js";
feedbackUtilsScript.onload = () => jsPsych.run(timeline);
feedbackUtilsScript.onerror = () => {
  document.body.textContent = "共通ライブラリを読み込めませんでした。ページを再読み込みしてください。";
};
surveyStylesheet.onload = () => {
  document.head.append(experimentStyle);
  document.head.append(feedbackUtilsScript);
};
surveyStylesheet.onerror = () => {
  document.body.textContent = "Surveyのスタイルを読み込めませんでした。ページを再読み込みしてください。";
};
document.head.append(surveyStylesheet);
