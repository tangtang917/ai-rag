/*
  File: ai-case-02/app.js
  Purpose: Bootstrap the ai-case-02 static page and prepare DOM anchors for later chat and upload behaviors.
  Flow: Read runtime config -> wire stable DOM references -> render non-interactive defaults for the first delivery step.
  Created: 2026-03-18
*/
(function () {
  const runtimeConfig = window.AI_CASE_02_RUNTIME_CONFIG || {};

  const elements = {
    modelInput: document.getElementById("modelInput"),
    footerYear: document.getElementById("footerYear"),
    chatStatusText: document.getElementById("chatStatusText"),
    uploadStatusText: document.getElementById("uploadStatusText")
  };

  function initializeStaticDefaults() {
    if (elements.modelInput && runtimeConfig.defaultModel) {
      elements.modelInput.value = runtimeConfig.defaultModel;
    }

    if (elements.footerYear) {
      elements.footerYear.textContent = String(new Date().getFullYear());
    }

    if (elements.chatStatusText) {
      elements.chatStatusText.textContent = "等待输入";
    }

    if (elements.uploadStatusText) {
      elements.uploadStatusText.textContent = "等待提交";
    }
  }

  initializeStaticDefaults();
})();
