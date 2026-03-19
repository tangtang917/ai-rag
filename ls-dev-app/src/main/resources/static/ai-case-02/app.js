/*
  File: ai-case-02/app.js
  Purpose: Orchestrate chat streaming and knowledge-file upload behaviors for the ai-case-02 static page.
  Flow: Read runtime config -> bind chat stream handlers -> manage tag/file upload state -> emit lightweight monitoring events.
  Created: 2026-03-18
*/
(function () {
  const runtimeConfig = window.AI_CASE_02_RUNTIME_CONFIG || {};
  const endpoints = runtimeConfig.endpoints || {};
  const successCode = runtimeConfig.feedback ? runtimeConfig.feedback.successCode : "0000";

  const elements = {
    modelInput: document.getElementById("modelInput"),
    messageInput: document.getElementById("messageInput"),
    sendChatBtn: document.getElementById("sendChatBtn"),
    stopChatBtn: document.getElementById("stopChatBtn"),
    clearChatBtn: document.getElementById("clearChatBtn"),
    chatStatusText: document.getElementById("chatStatusText"),
    transportBadge: document.getElementById("transportBadge"),
    chatList: document.getElementById("chatList"),
    footerYear: document.getElementById("footerYear"),
    tagSyncBadge: document.getElementById("tagSyncBadge"),
    uploadStatusText: document.getElementById("uploadStatusText"),
    tagFeedback: document.getElementById("tagFeedback"),
    uploadFeedback: document.getElementById("uploadFeedback"),
    refreshTagsBtn: document.getElementById("refreshTagsBtn"),
    tagSelect: document.getElementById("tagSelect"),
    tagSelectField: document.getElementById("tagSelectField"),
    tagInputField: document.getElementById("tagInputField"),
    newTagInput: document.getElementById("newTagInput"),
    fileInput: document.getElementById("fileInput"),
    fileList: document.getElementById("fileList"),
    fileEmptyState: document.getElementById("fileEmptyState"),
    submitUploadBtn: document.getElementById("submitUploadBtn"),
    tagModeInputs: document.querySelectorAll('input[name="tagMode"]')
  };

  const state = {
    eventSource: null,
    isStreaming: false,
    isUploading: false,
    isRefreshingTags: false,
    tagMode: "existing",
    tags: [],
    selectedFiles: []
  };

  function reportMetric(eventName, level, payload) {
    const metric = {
      pageId: runtimeConfig.pageId || "ai-case-02",
      eventName: eventName,
      level: level || "info",
      payload: payload || {},
      timestamp: new Date().toISOString()
    };

    if (window.console && typeof window.console.info === "function") {
      console.info((runtimeConfig.monitoring && runtimeConfig.monitoring.consolePrefix) || "[ai-case-02]", metric);
    }

    window.dispatchEvent(new CustomEvent("ai-case-02:metric", { detail: metric }));
  }

  function setFooterYear() {
    if (elements.footerYear) {
      elements.footerYear.textContent = String(new Date().getFullYear());
    }
  }

  function setChatStatus(text) {
    elements.chatStatusText.textContent = text;
  }

  function setUploadStatus(text) {
    elements.uploadStatusText.textContent = text;
  }

  function setTransportBadge(text, tone) {
    elements.transportBadge.className = "badge " + resolveBadgeToneClass(tone);
    elements.transportBadge.textContent = text;
  }

  function setTagSyncBadge(text, tone) {
    elements.tagSyncBadge.className = "badge " + resolveBadgeToneClass(tone);
    elements.tagSyncBadge.textContent = text;
  }

  function resolveBadgeToneClass(tone) {
    const toneMap = {
      idle: "badge--idle",
      busy: "badge--busy",
      direct: "badge--direct",
      session: "badge--session",
      success: "badge--success",
      error: "badge--error",
      warn: "badge--warn"
    };

    return toneMap[tone] || toneMap.idle;
  }

  function setFeedback(target, text, tone) {
    const toneMap = {
      neutral: "feedback feedback--neutral",
      success: "feedback feedback--success",
      warning: "feedback feedback--warning",
      error: "feedback feedback--error"
    };

    target.className = toneMap[tone] || toneMap.neutral;
    target.textContent = text;
  }

  function removeChatEmptyState() {
    const emptyState = document.getElementById("chatEmptyState");
    if (emptyState) {
      emptyState.remove();
    }
  }

  function ensureChatEmptyState() {
    if (document.getElementById("chatEmptyState")) {
      return;
    }

    const emptyState = document.createElement("div");
    emptyState.id = "chatEmptyState";
    emptyState.className = "empty-state";
    emptyState.textContent =
      "输入业务问题后发送，系统会自动选择合适的流式输出方式，并将结果持续渲染到对话区。";
    elements.chatList.appendChild(emptyState);
  }

  function scrollChatToBottom() {
    elements.chatList.scrollTop = elements.chatList.scrollHeight;
  }

  function createChatBubble(role, text) {
    removeChatEmptyState();

    const row = document.createElement("div");
    row.className = "chat-row " + (role === "user" ? "chat-row--user" : "chat-row--assistant");

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble " + (role === "user" ? "chat-bubble--user" : "chat-bubble--assistant");
    bubble.textContent = text || "";

    row.appendChild(bubble);
    elements.chatList.appendChild(row);
    scrollChatToBottom();

    return bubble;
  }

  function closeCurrentStream() {
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }

    state.isStreaming = false;
    elements.sendChatBtn.disabled = false;
    elements.stopChatBtn.disabled = true;
  }

  function buildDirectStreamUrl(model, message) {
    const params = new URLSearchParams({
      model: model,
      message: message
    });

    return endpoints.directStreamPath + "?" + params.toString();
  }

  function buildSessionStreamUrl(sessionId) {
    const params = new URLSearchParams({
      sessionId: sessionId
    });

    return endpoints.sessionStreamPath + "?" + params.toString();
  }

  function resolveStreamMode(model, message) {
    const directUrl = buildDirectStreamUrl(model, message);
    return directUrl.length > ((runtimeConfig.stream && runtimeConfig.stream.maxDirectUrlLength) || 1600)
      ? "session"
      : "direct";
  }

  function parseSseData(raw) {
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      reportMetric("chat_sse_parse_failed", "warn", { message: error.message });
      return [];
    }
  }

  function appendAssistantChunk(targetBubble, chunk) {
    const content = chunk && chunk.result && chunk.result.output ? chunk.result.output.content : null;
    if (typeof content === "string" && content.length > 0) {
      targetBubble.textContent += content;
    }
  }

  function isStopChunk(chunk) {
    const metadataFinishReason =
      chunk && chunk.result && chunk.result.metadata ? chunk.result.metadata.finishReason : null;
    const propertiesFinishReason =
      chunk &&
      chunk.result &&
      chunk.result.output &&
      chunk.result.output.properties
        ? chunk.result.output.properties.finishReason
        : null;

    return metadataFinishReason === "STOP" || propertiesFinishReason === "STOP";
  }

  function openStream(apiUrl, assistantBubble, mode) {
    closeCurrentStream();

    state.eventSource = new EventSource(apiUrl);
    state.isStreaming = true;
    elements.sendChatBtn.disabled = true;
    elements.stopChatBtn.disabled = false;

    setChatStatus(mode === "direct" ? "正在直连流式输出" : "正在会话流式输出");
    setTransportBadge(mode === "direct" ? "直接流式" : "会话流式", mode);
    reportMetric("chat_stream_opened", "info", { transportMode: mode });

    state.eventSource.onmessage = function (event) {
      const chunks = parseSseData(event.data);
      if (!chunks.length) {
        return;
      }

      for (const chunk of chunks) {
        appendAssistantChunk(assistantBubble, chunk);

        if (isStopChunk(chunk)) {
          setChatStatus("生成完成");
          scrollChatToBottom();
          closeCurrentStream();
          reportMetric("chat_stream_completed", "info", { transportMode: mode });
          return;
        }
      }

      scrollChatToBottom();
    };

    state.eventSource.onerror = function () {
      if (!state.isStreaming) {
        return;
      }

      setChatStatus("流式连接已结束");
      setTransportBadge("连接结束", "warn");
      reportMetric("chat_stream_interrupted", "warn", { transportMode: mode });
      closeCurrentStream();
    };
  }

  async function prepareLongTextSession(model, message) {
    const response = await fetch(endpoints.preparePath, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model,
        message: message
      })
    });

    if (!response.ok) {
      throw new Error("长文本会话准备失败，HTTP " + response.status);
    }

    const payload = await response.json();
    if (!payload || !payload.sessionId) {
      throw new Error("长文本会话准备失败，未返回 sessionId");
    }

    return payload.sessionId;
  }

  async function sendMessage() {
    if (state.isStreaming) {
      return;
    }

    const model = elements.modelInput.value.trim();
    const message = elements.messageInput.value.trim();

    if (!model) {
      setChatStatus("请先填写模型名称");
      setTransportBadge("待补充模型", "warn");
      return;
    }

    if (!message) {
      setChatStatus("请输入消息内容");
      setTransportBadge("待输入消息", "warn");
      return;
    }

    closeCurrentStream();
    createChatBubble("user", message);
    const assistantBubble = createChatBubble("assistant", "");

    elements.messageInput.value = "";
    elements.messageInput.focus();

    try {
      const streamMode = resolveStreamMode(model, message);
      reportMetric("chat_send_requested", "info", {
        transportMode: streamMode,
        messageLength: message.length
      });

      if (streamMode === "direct") {
        openStream(buildDirectStreamUrl(model, message), assistantBubble, "direct");
        return;
      }

      setChatStatus("文本较长，正在准备会话");
      setTransportBadge("准备会话流式", "busy");
      const sessionId = await prepareLongTextSession(model, message);
      openStream(buildSessionStreamUrl(sessionId), assistantBubble, "session");
    } catch (error) {
      assistantBubble.textContent =
        "请求未完成：" + (error && error.message ? error.message : "发生未知异常");
      setChatStatus("发送失败");
      setTransportBadge("发送失败", "error");
      closeCurrentStream();
      reportMetric("chat_send_failed", "error", {
        message: error && error.message ? error.message : "unknown"
      });
    }
  }

  function clearChat() {
    closeCurrentStream();
    elements.chatList.innerHTML = "";
    ensureChatEmptyState();
    setChatStatus("已清空对话");
    setTransportBadge("自动判断", "idle");
    reportMetric("chat_cleared", "info");
  }

  function formatFileSize(size) {
    if (size < 1024) {
      return size + " B";
    }
    if (size < 1024 * 1024) {
      return (size / 1024).toFixed(1) + " KB";
    }
    return (size / (1024 * 1024)).toFixed(1) + " MB";
  }

  function renderSelectedFiles() {
    elements.fileList.innerHTML = "";

    if (!state.selectedFiles.length) {
      elements.fileList.classList.remove("file-list--visible");
      elements.fileEmptyState.hidden = false;
      return;
    }

    elements.fileEmptyState.hidden = true;
    elements.fileList.classList.add("file-list--visible");

    state.selectedFiles.forEach(function (file) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const meta = document.createElement("span");

      name.className = "file-list__name";
      name.textContent = file.name;
      meta.className = "file-list__meta";
      meta.textContent = formatFileSize(file.size);

      item.appendChild(name);
      item.appendChild(meta);
      elements.fileList.appendChild(item);
    });
  }

  function clearSelectedFiles() {
    state.selectedFiles = [];
    elements.fileInput.value = "";
    renderSelectedFiles();
  }

  function setTagMode(mode) {
    state.tagMode = mode === "new" ? "new" : "existing";
    const isExistingMode = state.tagMode === "existing";

    elements.tagSelectField.classList.toggle("field--hidden", !isExistingMode);
    elements.tagInputField.classList.toggle("field--hidden", isExistingMode);
  }

  function sanitizeTagList(tags) {
    const seen = new Set();
    const normalizedTags = [];

    (Array.isArray(tags) ? tags : []).forEach(function (tag) {
      const normalized = typeof tag === "string" ? tag.trim() : "";
      if (!normalized || seen.has(normalized)) {
        return;
      }

      seen.add(normalized);
      normalizedTags.push(normalized);
    });

    return normalizedTags;
  }

  function renderTagOptions(preferredTag) {
    const previousValue = preferredTag || elements.tagSelect.value;
    elements.tagSelect.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = state.tags.length ? "请选择知识标签" : "暂无可选标签";
    elements.tagSelect.appendChild(placeholder);

    state.tags.forEach(function (tag) {
      const option = document.createElement("option");
      option.value = tag;
      option.textContent = tag;
      elements.tagSelect.appendChild(option);
    });

    if (previousValue && state.tags.indexOf(previousValue) >= 0) {
      elements.tagSelect.value = previousValue;
    }

    elements.tagSelect.disabled = !state.tags.length;
  }

  async function fetchTagList(options) {
    const requestOptions = options || {};

    if (state.isRefreshingTags) {
      return;
    }

    state.isRefreshingTags = true;
    elements.refreshTagsBtn.disabled = true;
    setTagSyncBadge("标签同步中", "busy");

    if (!requestOptions.silentFeedback) {
      setFeedback(elements.tagFeedback, "正在获取知识标签列表。", "neutral");
    }

    try {
      const response = await fetch(endpoints.ragTagListPath, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error("标签查询失败，HTTP " + response.status);
      }

      const payload = await response.json();
      if (!payload || payload.code !== successCode) {
        throw new Error(payload && payload.msg ? payload.msg : "标签查询返回异常");
      }

      state.tags = sanitizeTagList(payload.data);
      renderTagOptions(requestOptions.preferredTag);

      if (state.tags.length) {
        setTagSyncBadge("标签已同步", "success");
        setFeedback(elements.tagFeedback, "标签列表已更新，可直接选择已有标签。", "success");
      } else {
        setTagSyncBadge("暂无标签", "warn");
        setFeedback(elements.tagFeedback, "当前尚无已发布标签，可切换为录入新标签后继续上传。", "warning");
      }

      reportMetric("rag_tag_query_succeeded", "info", {
        source: requestOptions.source || "unknown",
        tagCount: state.tags.length
      });
    } catch (error) {
      setTagSyncBadge("标签同步失败", "error");
      setFeedback(
        elements.tagFeedback,
        "标签列表获取失败，请稍后重试或切换为录入新标签。错误信息：" +
          (error && error.message ? error.message : "未知异常"),
        "error"
      );
      reportMetric("rag_tag_query_failed", "error", {
        source: requestOptions.source || "unknown",
        message: error && error.message ? error.message : "unknown"
      });
    } finally {
      state.isRefreshingTags = false;
      elements.refreshTagsBtn.disabled = state.isUploading;
    }
  }

  function resolveRagTag() {
    if (state.tagMode === "new") {
      return elements.newTagInput.value.trim();
    }

    return elements.tagSelect.value.trim();
  }

  function validateUploadPayload() {
    const effectiveTag = resolveRagTag();

    if (!effectiveTag) {
      throw new Error(state.tagMode === "new" ? "请录入新的知识标签" : "请选择一个知识标签");
    }

    if (effectiveTag.length > 100) {
      throw new Error("知识标签长度不能超过 100 个字符");
    }

    if (!state.selectedFiles.length) {
      throw new Error("请至少选择一个上传文件");
    }

    return effectiveTag;
  }

  function setUploadBusyState(isBusy) {
    state.isUploading = isBusy;
    elements.submitUploadBtn.disabled = isBusy;
    elements.fileInput.disabled = isBusy;
    elements.refreshTagsBtn.disabled = isBusy || state.isRefreshingTags;
    elements.tagSelect.disabled = isBusy || !state.tags.length;
    elements.newTagInput.disabled = isBusy;
    elements.tagModeInputs.forEach(function (input) {
      input.disabled = isBusy;
    });
  }

  async function uploadFiles() {
    if (state.isUploading) {
      setFeedback(elements.uploadFeedback, "上传进行中，请勿重复提交。", "warning");
      reportMetric("file_upload_duplicate_blocked", "warn");
      return;
    }

    let ragTag = "";
    let fileCount = state.selectedFiles.length;

    try {
      ragTag = validateUploadPayload();
    } catch (error) {
      setUploadStatus("待补齐信息");
      setFeedback(elements.uploadFeedback, error.message, "error");
      return;
    }

    const formData = new FormData();
    formData.append("ragTag", ragTag);
    state.selectedFiles.forEach(function (file) {
      formData.append("files", file, file.name);
    });

    try {
      setUploadBusyState(true);
      setUploadStatus("上传中");
      setFeedback(elements.uploadFeedback, "资料正在上传，请勿重复点击提交。", "warning");
      reportMetric("file_upload_started", "info", {
        ragTag: ragTag,
        fileCount: fileCount
      });

      const response = await fetch(endpoints.fileUploadPath, {
        method: "POST",
        body: formData
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch (jsonError) {
        payload = null;
      }

      if (!response.ok) {
        throw new Error("上传失败，HTTP " + response.status);
      }

      if (!payload || payload.code !== successCode) {
        throw new Error(payload && payload.msg ? payload.msg : "上传返回异常");
      }

      setUploadStatus("上传完成");
      setFeedback(elements.uploadFeedback, "资料上传成功，标签列表正在刷新。", "success");
      clearSelectedFiles();

      reportMetric("file_upload_succeeded", "info", {
        ragTag: ragTag,
        fileCount: fileCount
      });

      await fetchTagList({
        source: "post-upload",
        preferredTag: ragTag,
        silentFeedback: false
      });
    } catch (error) {
      setUploadStatus("上传失败");
      setFeedback(
        elements.uploadFeedback,
        "资料上传失败，已保留当前标签、文件和输入状态，可直接重试。错误信息：" +
          (error && error.message ? error.message : "未知异常"),
        "error"
      );
      reportMetric("file_upload_failed", "error", {
        ragTag: ragTag,
        message: error && error.message ? error.message : "unknown"
      });
    } finally {
      setUploadBusyState(false);
    }
  }

  function validateFormalCopy() {
    const blockedTerms = Array.isArray(runtimeConfig.formalCopyBlockedTerms)
      ? runtimeConfig.formalCopyBlockedTerms
      : [];
    const pageText = document.body ? document.body.innerText : "";
    const violatedTerms = blockedTerms.filter(function (term) {
      return pageText.indexOf(term) >= 0;
    });

    if (violatedTerms.length) {
      reportMetric("formal_copy_violation_detected", "warn", {
        terms: violatedTerms
      });
    }
  }

  function bindChatEvents() {
    elements.sendChatBtn.addEventListener("click", function () {
      void sendMessage();
    });

    elements.stopChatBtn.addEventListener("click", function () {
      setChatStatus("已手动停止");
      setTransportBadge("已停止", "warn");
      closeCurrentStream();
      reportMetric("chat_stream_stopped_manually", "warn");
    });

    elements.clearChatBtn.addEventListener("click", function () {
      clearChat();
    });

    elements.messageInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void sendMessage();
      }
    });
  }

  function bindKnowledgeEvents() {
    elements.tagModeInputs.forEach(function (input) {
      input.addEventListener("change", function () {
        setTagMode(input.value);
      });
    });

    elements.refreshTagsBtn.addEventListener("click", function () {
      void fetchTagList({ source: "manual-refresh" });
    });

    elements.fileInput.addEventListener("change", function (event) {
      const files = Array.from(event.target.files || []);
      state.selectedFiles = files;
      renderSelectedFiles();

      if (files.length) {
        setFeedback(elements.uploadFeedback, "文件已就绪，请确认标签后提交上传。", "neutral");
      } else {
        setFeedback(elements.uploadFeedback, "请选择标签和文件后提交上传。", "neutral");
      }
    });

    elements.submitUploadBtn.addEventListener("click", function () {
      void uploadFiles();
    });
  }

  function initializeView() {
    if (elements.modelInput && runtimeConfig.defaultModel) {
      elements.modelInput.value = runtimeConfig.defaultModel;
    }

    setFooterYear();
    ensureChatEmptyState();
    renderSelectedFiles();
    setChatStatus("等待输入");
    setUploadStatus("等待提交");
    setTransportBadge("自动判断", "idle");
    setTagSyncBadge("标签待同步", "idle");
    setTagMode(state.tagMode);
    setFeedback(elements.tagFeedback, "页面初始化后将自动获取标签列表。", "neutral");
    setFeedback(elements.uploadFeedback, "请选择标签和文件后提交上传。", "neutral");
    validateFormalCopy();
  }

  function initialize() {
    initializeView();
    bindChatEvents();
    bindKnowledgeEvents();
    void fetchTagList({ source: "initial-load" });
    reportMetric("page_initialized", "info");
  }

  initialize();
})();
