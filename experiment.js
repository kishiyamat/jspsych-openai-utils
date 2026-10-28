// Cognition の Source code に貼り付ける標準 jsPsych 7/8 の例。
// Cognition plugins: html-button-response / call-function。survey は以下を External JS/CSS に登録。
// JS: https://unpkg.com/@jspsych/plugin-survey@1.0.1
// CSS: https://unpkg.com/@jspsych/plugin-survey@1.0.1/css/survey.css
// これとは別に encrypted-api-key.js を External JS に登録。
import("https://cdn.jsdelivr.net/gh/kishiyamat/jspsych-openai-utils@0409e2ce280d605b915853d3c78378173d9173cb/dist/feedback-utils.js")
  .then(function () {
    // ===== 実験ごとに設定する項目 =====
    const PROMPTS = {
      prompt_a: "あなたは文章改善を支援するAIです。対象文章の改善点と具体的な改善案（書き換え例を含む）を直接示してください。日本語で簡潔に。",
      prompt_b: "あなたは文章改善を支援するAIです。答えを直接示さず、本人が自分で改善できるよう、問い返しを中心にフィードバックしてください。書き換え例は示さないでください。日本語で簡潔に。"
    };
    const SETTINGS = { model: "gpt-6-luna", reasoningEffort: "none", temperature: 0.3, maxOutputTokens: 1000 };
    const MAX_ATTEMPTS = 3;
    const CONDITIONS = ["prompt_a", "prompt_b", "manual"];

    const jsPsych = initJsPsych();
    let apiKey = null;
    let password = null;
    let authenticated = false;
    let submissionText = "";
    let aiFeedback = null;
    let lastError = null;
    let attempts = 0;
    let endReason = null;

    const aliases = { a: "prompt_a", b: "prompt_b" };
    const query = (jsPsych.data.getURLVariable("system-prompt") || "").toLowerCase();
    const requested = aliases[query] || query;
    const conditionSource = CONDITIONS.includes(requested) ? "query" : "random";
    const condition = conditionSource === "query"
      ? requested : jsPsych.randomization.sampleWithoutReplacement(CONDITIONS, 1)[0];
    const isManual = condition === "manual";
    const feedbackSessionId = crypto.randomUUID();
    jsPsych.data.addProperties({
      experiment_version: "2026-10-28-standard-survey-2",
      feedback_session_id: feedbackSessionId,
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
      choices: ["同意する", "同意しない"],
      on_finish: data => {
        if (data.response !== 0) endReason = "declined_consent";
      }
    };

    const passwordEntry = {
      type: jsPsychSurvey,
      data: { feedback_phase: "password_entry" },
      survey_json: {
        showQuestionNumbers: "off",
        showCompletedPage: false,
        completeText: "開始",
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
        FeedbackUtils.decryptApiKey(window.ENCRYPTED_API_KEY, suppliedPassword).then(key => {
          apiKey = key;
          authenticated = true;
          done({ authentication_succeeded: true, authentication_error: null });
        }).catch(error => {
          endReason = "authentication_error";
          done({ authentication_succeeded: false,
            authentication_error: error?.name === "OperationError" ? "wrong_password" : "decryption_error" });
        });
      },
      on_finish: data => { Object.assign(data, data.value); delete data.value; }
    };

    const input = {
      type: jsPsychSurvey,
      data: { feedback_phase: "input" },
      survey_json: {
        showQuestionNumbers: "off",
        showCompletedPage: false,
        completeText: isManual ? "フィードバックを書く" : "AIに依頼する",
        elements: [{ type: "comment", name: "submission", title: "フィードバックの対象文章",
          description: isManual ? "対象文章を入力してください。" : "AIに見せる文章を入力してください。",
          rows: 8, maxLength: 1000, isRequired: true,
          requiredErrorText: "空白以外の文章を入力してください。" }]
      },
      on_finish: data => {
        submissionText = data.response.submission;
        data.submission = submissionText;
        delete data.response;
      }
    };

    const generation = {
      type: jsPsychCallFunction,
      async: true,
      on_load: () => { jsPsych.getDisplayElement().textContent = "AIの応答を待っています。"; },
      data: { feedback_phase: "generation" },
      func: done => {
        attempts += 1;
        const record = {
          generation_attempt: attempts,
          system_prompt: PROMPTS[condition],
          api_input: submissionText,
          model: SETTINGS.model,
          reasoning_effort: SETTINGS.reasoningEffort,
          temperature: SETTINGS.temperature,
          max_output_tokens: SETTINGS.maxOutputTokens,
          response_model: null,
          api_response_id: null,
          ai_feedback: null,
          api_error: null
        };
        FeedbackUtils.generate({ apiKey, ...SETTINGS,
          systemPrompt: PROMPTS[condition], text: submissionText }).then(result => {
          aiFeedback = result.text;
          lastError = null;
          record.response_model = result.model;
          record.api_response_id = result.responseId;
          record.ai_feedback = result.text;
          done(record);
        }).catch(error => {
          aiFeedback = null;
          lastError = FeedbackUtils.classifyError(error ?? new Error("Unknown failure"));
          record.api_error = lastError;
          if (!lastError.retryable) endReason = "non_retryable_error";
          else if (attempts >= MAX_ATTEMPTS) endReason = "max_attempts_reached";
          done(record);
        });
      },
      on_finish: data => { Object.assign(data, data.value); delete data.value; }
    };

    const retryDecision = {
      type: jsPsychHtmlButtonResponse,
      data: { feedback_phase: "retry_decision" },
      stimulus: "<p>AIの応答を取得できませんでした。再試行しますか？</p>",
      choices: ["再試行", "終了"],
      on_finish: data => {
        data.generation_attempt = attempts;
        data.retry_choice = data.response === 0 ? "retry" : "end";
        if (data.response !== 0) endReason = "participant_ended_after_error";
      }
    };
    const canRetry = () => !aiFeedback && lastError?.retryable === true
      && attempts < MAX_ATTEMPTS && endReason === null;
    const generationLoop = {
      timeline: [generation, { timeline: [retryDecision], conditional_function: canRetry }],
      conditional_function: () => !isManual && authenticated && endReason === null,
      loop_function: canRetry
    };

    const submission = {
      type: jsPsychSurvey,
      data: { feedback_phase: "submission" },
      survey_json: {
        showQuestionNumbers: "off",
        showCompletedPage: false,
        completeText: "提出する",
        elements: isManual ? [{
          type: "comment", name: "final_feedback", title: "対象文章へのフィードバックを書いてください",
          rows: 8, isRequired: true, requiredErrorText: "フィードバックを入力してください。"
        }] : [
          { type: "comment", name: "ai_draft", title: "AIの原案", readOnly: true, rows: 8 },
          { type: "radiogroup", name: "adoption", title: "AIの原案をどのように扱いましたか？", isRequired: true,
            requiredErrorText: "採用方法を選んでください。",
            choices: [
              { value: "as_is", text: "そのまま採用" },
              { value: "edited", text: "編集して採用" },
              { value: "rejected", text: "採用しない" }
            ] },
          { type: "comment", name: "final_feedback", title: "提出するフィードバック（編集できます）",
            description: "採用しない場合は、空欄でも自分で書いた文章でも提出できます。",
            rows: 8,
            requiredErrorText: "フィードバックを入力してください。",
            requiredIf: "{adoption} notempty and {adoption} != 'rejected'" }
        ]
      },
      survey_function: survey => {
        if (!isManual) {
          survey.setValue("ai_draft", aiFeedback);
          survey.setValue("final_feedback", aiFeedback);
        }
      },
      on_finish: data => {
        const response = data.response || {};
        const finalFeedback = !isManual && response.adoption === "rejected"
          && !/\S/.test(response.final_feedback ?? "") ? "" : response.final_feedback ?? "";
        data.submission = submissionText;
        data.ai_feedback = isManual ? null : aiFeedback;
        data.final_feedback = finalFeedback;
        data.generation_attempt = isManual ? 0 : attempts;
        data.text_changed = isManual ? null : finalFeedback !== aiFeedback;
        data.adoption = isManual ? null : response.adoption ?? null;
        delete data.response;
      }
    };

    const finish = {
      type: jsPsychHtmlButtonResponse,
      stimulus: () => endReason === null
        ? "<p>提出を受け付けました。ご協力ありがとうございました。</p>"
        : endReason === "declined_consent"
          ? "<p>実験を終了します。</p>"
          : "<p>実験を途中で終了しました。実験者にお知らせください。</p>",
      choices: ["終了"],
      on_finish: data => {
        data.feedback_phase = endReason === null ? "complete" : "termination";
        data.termination_reason = endReason;
        data.generation_attempt = attempts;
      }
    };

    const timeline = [];
    timeline.push(consent);
    timeline.push({
      timeline: [passwordEntry, authentication],
      conditional_function: () => endReason === null && !isManual
    });
    timeline.push({
      timeline: [input, generationLoop,
        { timeline: [submission], conditional_function: () => isManual || aiFeedback !== null }],
      conditional_function: () => endReason === null && (isManual || authenticated)
    });
    timeline.push(finish);
    return jsPsych.run(timeline).finally(() => { apiKey = null; password = null; });
  })
  .catch(() => {
    const message = document.createElement("p");
    message.textContent = "実験を読み込めませんでした。実験者にお知らせください。";
    document.body.replaceChildren(message);
  });
