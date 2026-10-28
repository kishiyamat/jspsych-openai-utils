function createFeedbackFlow({
  callFunctionPlugin, getEncryptedApiKey, getDisplayElement,
  generationSettings, getRequest, maxAttempts = 3
}) {
  const coreLibraryUrl = new URL("./feedback-utils.js", import.meta.url).href;
  let session = null;
  let loadError = null;
  let keyProvider = getEncryptedApiKey;

  const preparationTrial = {
    type: callFunctionPlugin,
    async: true,
    data: { feedback_phase: "preparation" },
    func: async done => {
      let helperLoaded = false;
      let currentDisplay;
      try {
        currentDisplay = getDisplayElement();
        if (!currentDisplay) throw new Error("jsPsych display is unavailable");
        currentDisplay.textContent = "実験を準備しています。";
        if (!window.FeedbackUtils?.createFeedbackSession
            || !window.FeedbackUtils?.bindNonBlankText
            || !window.FeedbackUtils?.escapeHtml) {
          await import(coreLibraryUrl);
        }
        const helper = window.FeedbackUtils;
        if (!helper?.createFeedbackSession || !helper?.bindNonBlankText || !helper?.escapeHtml) {
          throw new Error("Required library functions are unavailable");
        }
        const encrypted = keyProvider ? keyProvider() : null;
        session = helper.createFeedbackSession({
          encryptedApiKey: encrypted,
          displayElement: currentDisplay,
          generationSettings,
          getRequest,
          maxAttempts
        });
        helperLoaded = true;
      } catch {
        loadError = "helper_load_error";
      } finally {
        keyProvider = null;
        if (currentDisplay) currentDisplay.textContent = "";
      }
      done({ helper_loaded: helperLoaded });
    },
    on_finish: data => {
      data.helper_loaded = data.value?.helper_loaded === true;
      delete data.value;
    }
  };

  const authenticationTrial = {
    type: callFunctionPlugin,
    async: true,
    data: { feedback_phase: "authentication" },
    func: done => session.authenticate().then(done),
    on_finish: data => session.recordTrialData(data)
  };

  const generationTrial = {
    type: callFunctionPlugin,
    async: true,
    data: { feedback_phase: "generation" },
    func: done => session.generate().then(done),
    on_finish: data => session.recordTrialData(data)
  };

  return {
    preparationTrial,
    authenticationTrial,
    generationTrial,
    clear() { session?.clear(); },
    get feedback() { return session?.feedback ?? null; },
    get attempt() { return session?.attempt ?? 0; },
    get canRetry() { return session?.canRetry === true; },
    get terminationReason() { return loadError ?? session?.terminationReason ?? null; }
  };
}

async function runStudy(defineStudy, { initJsPsych, callFunctionPlugin }) {
  let jsPsych;
  const flows = [];
  try {
    jsPsych = initJsPsych();
    const timeline = defineStudy({
      jsPsych,
      createFeedbackFlow: options => {
        const flow = createFeedbackFlow({
          ...options,
          callFunctionPlugin,
          getDisplayElement: () => jsPsych.getDisplayElement()
        });
        flows.push(flow);
        return flow;
      }
    });
    await jsPsych.run(timeline);
  } catch {
    const display = jsPsych?.getDisplayElement?.() ?? document.body;
    display.textContent = "実験を継続できませんでした。実験者にお知らせください。";
  } finally {
    flows.forEach(flow => flow.clear());
  }
}

export { runStudy };
