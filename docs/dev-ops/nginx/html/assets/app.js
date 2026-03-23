/*
  File: assets/app.js
  Purpose: Front-end controller for login gating, session management and RAG streaming.
  Flow: Restore lightweight login/session state -> gate workspace actions -> call generate_stream_rag endpoints -> persist chat sessions.
  Updated: 2026-03-23
*/
(function () {
  var config = window.AI_WORKSPACE_CONFIG || {};

  var STORAGE_KEY = config.storageKeys && config.storageKeys.sessions ? config.storageKeys.sessions : "ai_workspace_sessions_v2";
  var ACTIVE_SESSION_KEY = config.storageKeys && config.storageKeys.activeSession ? config.storageKeys.activeSession : "ai_workspace_active_session_v2";
  var AUTH_STATE_KEY = config.storageKeys && config.storageKeys.authState ? config.storageKeys.authState : "ai_workspace_auth_state_v1";

  var RAG_TAG_ENDPOINT = config.endpoints && config.endpoints.ragTags ? config.endpoints.ragTags : "/api/v1/rag/query_rag_tag_list";
  var STREAM_ENDPOINTS = config.endpoints && config.endpoints.streams ? config.endpoints.streams : {
    ollama: "/api/v1/ollama/generate_stream_rag",
    openai: "/api/v1/openai/generate_stream_rag"
  };

  var CHANNEL_MODELS = config.channelModels || {
    ollama: ["deepseek-r1:1.5b", "qwen2.5:7b", "llama3.1:8b"],
    openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"]
  };

  var DEFAULT_TAGS = config.defaults && Array.isArray(config.defaults.tags) ? config.defaults.tags : ["default", "project-docs", "product-kb"];
  var SESSION_PERSIST_DELAY_MS = config.defaults && config.defaults.persistDelayMs ? config.defaults.persistDelayMs : 150;
  var LOGIN_SESSION_TTL_MS = config.defaults && config.defaults.loginSessionTtlMs ? config.defaults.loginSessionTtlMs : 28800000;

  var elements = {
    loginView: document.getElementById("loginView"),
    workspaceView: document.getElementById("workspaceView"),
    loginForm: document.getElementById("loginForm"),
    loginAccount: document.getElementById("loginAccount"),
    loginPassword: document.getElementById("loginPassword"),
    loginStatus: document.getElementById("loginStatus"),
    loginIdentity: document.getElementById("loginIdentity"),
    logoutBtn: document.getElementById("logoutBtn"),
    sessionList: document.getElementById("sessionList"),
    newChatBtn: document.getElementById("newChatBtn"),
    restoreBtn: document.getElementById("restoreBtn"),
    channelSelect: document.getElementById("channelSelect"),
    modelSelect: document.getElementById("modelSelect"),
    knowledgeSelect: document.getElementById("knowledgeSelect"),
    chatBoard: document.getElementById("chatBoard"),
    messageInput: document.getElementById("messageInput"),
    sendBtn: document.getElementById("sendBtn"),
    stopBtn: document.getElementById("stopBtn"),
    statusStrip: document.getElementById("statusStrip")
  };

  var state = {
    auth: {
      loggedIn: false,
      account: "",
      loginAt: 0,
      expiresAt: 0
    },
    sessions: [],
    activeSessionId: null,
    knowledgeTags: DEFAULT_TAGS.slice(),
    isStreaming: false,
    eventSource: null,
    streamAbortController: null,
    persistTimer: null,
    lastTagSyncAt: null
  };

  function nowTs() {
    return Date.now();
  }

  function createId() {
    return nowTs().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function uniqueStrings(values) {
    return Array.from(new Set(values.filter(function (item) {
      return typeof item === "string" && item.trim();
    }).map(function (item) {
      return item.trim();
    })));
  }

  function safeParseJson(raw, fallback) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function formatTime(ts) {
    if (!ts) {
      return "-";
    }

    var date = new Date(ts);
    var mm = String(date.getMonth() + 1).padStart(2, "0");
    var dd = String(date.getDate()).padStart(2, "0");
    var hh = String(date.getHours()).padStart(2, "0");
    var min = String(date.getMinutes()).padStart(2, "0");
    return mm + "-" + dd + " " + hh + ":" + min;
  }

  function applyStatus(element, text, tone) {
    if (!element) {
      return;
    }

    element.classList.remove("success", "error");
    if (tone === "success") {
      element.classList.add("success");
    }
    if (tone === "error") {
      element.classList.add("error");
    }
    element.textContent = text;
  }

  function setLoginStatus(text, tone) {
    applyStatus(elements.loginStatus, text, tone);
  }

  function setWorkspaceStatus(text, tone) {
    applyStatus(elements.statusStrip, text, tone);
  }

  function normalizeChannel(rawChannel) {
    return rawChannel === "openai" ? "openai" : "ollama";
  }

  function normalizeModel(rawChannel, rawModel) {
    var channel = normalizeChannel(rawChannel);
    var modelCandidates = CHANNEL_MODELS[channel] || CHANNEL_MODELS.ollama;
    return modelCandidates.indexOf(rawModel) >= 0 ? rawModel : modelCandidates[0];
  }

  function normalizeTag(rawTag) {
    if (typeof rawTag !== "string") {
      return "";
    }
    return rawTag.trim();
  }

  function parseAuthState(rawAuth) {
    if (!rawAuth || typeof rawAuth !== "object") {
      return null;
    }

    var account = typeof rawAuth.account === "string" ? rawAuth.account.trim() : "";
    var loginAt = typeof rawAuth.loginAt === "number" ? rawAuth.loginAt : 0;
    var expiresAt = typeof rawAuth.expiresAt === "number" ? rawAuth.expiresAt : 0;

    if (!account || expiresAt <= nowTs()) {
      return null;
    }

    return {
      loggedIn: true,
      account: account,
      loginAt: loginAt,
      expiresAt: expiresAt
    };
  }

  function persistAuthState() {
    try {
      if (!state.auth.loggedIn) {
        sessionStorage.removeItem(AUTH_STATE_KEY);
        return;
      }

      var payload = {
        account: state.auth.account,
        loginAt: state.auth.loginAt,
        expiresAt: state.auth.expiresAt
      };
      sessionStorage.setItem(AUTH_STATE_KEY, JSON.stringify(payload));
    } catch (error) {
      setLoginStatus("状态：登录态保存失败，请重新登录。", "error");
    }
  }

  function clearAuthState() {
    state.auth = {
      loggedIn: false,
      account: "",
      loginAt: 0,
      expiresAt: 0
    };
    persistAuthState();
  }

  function ensureAuthState() {
    try {
      var raw = sessionStorage.getItem(AUTH_STATE_KEY);
      var parsed = parseAuthState(safeParseJson(raw || "{}", {}));

      if (parsed) {
        state.auth = parsed;
        return;
      }
    } catch (error) {
      setLoginStatus("状态：登录态读取失败，需要重新登录。", "error");
    }

    clearAuthState();
  }

  function applyAuthView() {
    var loggedIn = state.auth.loggedIn;

    if (elements.loginIdentity) {
      elements.loginIdentity.textContent = loggedIn ? "当前用户：" + state.auth.account : "未登录";
    }

    if (elements.loginView) {
      elements.loginView.classList.toggle("hidden", loggedIn);
      elements.loginView.setAttribute("aria-hidden", loggedIn ? "true" : "false");
    }

    if (elements.workspaceView) {
      elements.workspaceView.classList.toggle("hidden", !loggedIn);
      elements.workspaceView.setAttribute("aria-hidden", loggedIn ? "false" : "true");
    }
  }

  function requireLogin(actionName) {
    if (state.auth.loggedIn) {
      return true;
    }

    var label = actionName || "该操作";
    setLoginStatus("状态：未登录，执行“" + label + "”前请先完成登录。", "error");
    if (elements.loginAccount) {
      elements.loginAccount.focus();
    }
    applyAuthView();
    return false;
  }

  function extractTagList(payload) {
    if (!payload || typeof payload !== "object") {
      return [];
    }

    if (Array.isArray(payload.data)) {
      return payload.data;
    }

    if (payload.data && Array.isArray(payload.data.tags)) {
      return payload.data.tags;
    }

    return [];
  }

  function sanitizeMessage(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    var role = raw.role === "user" ? "user" : "assistant";
    var content = typeof raw.content === "string" ? raw.content : "";
    return {
      id: typeof raw.id === "string" ? raw.id : createId(),
      role: role,
      content: content,
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : nowTs()
    };
  }

  function createDefaultSession(seed) {
    var channel = normalizeChannel(seed && seed.channel ? seed.channel : "ollama");
    var model = normalizeModel(channel, seed && seed.model ? seed.model : "");
    var preferredTag = normalizeTag(seed && seed.ragTag ? seed.ragTag : "");
    var ragTag = preferredTag || state.knowledgeTags[0] || DEFAULT_TAGS[0];
    var now = nowTs();

    return {
      id: createId(),
      title: "新对话",
      channel: channel,
      model: model,
      ragTag: ragTag,
      createdAt: now,
      updatedAt: now,
      messages: [{
        id: createId(),
        role: "assistant",
        content: "新会话已创建，请输入你的问题。",
        createdAt: now
      }]
    };
  }

  function sanitizeSession(raw, index) {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    var channel = normalizeChannel(raw.channel);
    var model = normalizeModel(channel, raw.model);
    var ragTag = normalizeTag(raw.ragTag) || state.knowledgeTags[0] || DEFAULT_TAGS[0];
    var now = nowTs();

    var messages = Array.isArray(raw.messages)
      ? raw.messages.map(sanitizeMessage).filter(Boolean)
      : [];

    return {
      id: typeof raw.id === "string" ? raw.id : createId(),
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "新对话" + (index + 1),
      channel: channel,
      model: model,
      ragTag: ragTag,
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
      messages: messages.length ? messages : [{
        id: createId(),
        role: "assistant",
        content: "新会话已创建，请输入你的问题。",
        createdAt: now
      }]
    };
  }

  function persistSessions() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.sessions));
      localStorage.setItem(ACTIVE_SESSION_KEY, state.activeSessionId || "");
    } catch (error) {
      setWorkspaceStatus("状态：浏览器存储空间不足，无法保存会话。", "error");
    }
  }

  function schedulePersist() {
    if (state.persistTimer) {
      window.clearTimeout(state.persistTimer);
    }

    state.persistTimer = window.setTimeout(function () {
      persistSessions();
    }, SESSION_PERSIST_DELAY_MS);
  }

  function ensureSessionState() {
    var storedSessionsRaw = "[]";
    var activeIdRaw = "";

    try {
      storedSessionsRaw = localStorage.getItem(STORAGE_KEY) || "[]";
      activeIdRaw = localStorage.getItem(ACTIVE_SESSION_KEY) || "";
    } catch (error) {
      setWorkspaceStatus("状态：读取本地会话失败，已使用默认会话。", "error");
    }

    var storedSessions = safeParseJson(storedSessionsRaw, []);
    var parsedSessions = Array.isArray(storedSessions)
      ? storedSessions.map(sanitizeSession).filter(Boolean)
      : [];

    state.sessions = parsedSessions.length ? parsedSessions : [createDefaultSession()];

    var hasActive = state.sessions.some(function (session) {
      return session.id === activeIdRaw;
    });
    state.activeSessionId = hasActive ? activeIdRaw : state.sessions[0].id;

    var activeSession = getActiveSession();
    if (activeSession && activeSession.ragTag) {
      state.knowledgeTags = uniqueStrings([activeSession.ragTag].concat(state.knowledgeTags));
    }
  }

  function getActiveSession() {
    for (var i = 0; i < state.sessions.length; i += 1) {
      if (state.sessions[i].id === state.activeSessionId) {
        return state.sessions[i];
      }
    }
    return null;
  }

  function renderModelOptions(channel, selectedModel) {
    var models = CHANNEL_MODELS[channel] || CHANNEL_MODELS.ollama;
    elements.modelSelect.innerHTML = "";

    models.forEach(function (model) {
      var option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      elements.modelSelect.appendChild(option);
    });

    var finalModel = models.indexOf(selectedModel) >= 0 ? selectedModel : models[0];
    elements.modelSelect.value = finalModel;
    return finalModel;
  }

  function renderKnowledgeOptions(selectedTag) {
    var merged = uniqueStrings(state.knowledgeTags.concat([selectedTag || ""]));
    var fallbackTag = merged.length ? merged[0] : "default";
    var finalTag = merged.indexOf(selectedTag) >= 0 ? selectedTag : fallbackTag;

    elements.knowledgeSelect.innerHTML = "";
    (merged.length ? merged : [fallbackTag]).forEach(function (tag) {
      var option = document.createElement("option");
      option.value = tag;
      option.textContent = tag;
      elements.knowledgeSelect.appendChild(option);
    });

    elements.knowledgeSelect.value = finalTag;
    return finalTag;
  }

  function syncControlsWithActiveSession() {
    var session = getActiveSession();
    if (!session) {
      return;
    }

    elements.channelSelect.value = session.channel;
    session.model = renderModelOptions(session.channel, session.model);
    session.ragTag = renderKnowledgeOptions(session.ragTag);
  }

  function renderSessionList() {
    elements.sessionList.innerHTML = "";

    state.sessions.forEach(function (session) {
      var item = document.createElement("div");
      item.className = "session-item" + (session.id === state.activeSessionId ? " active" : "");
      item.setAttribute("data-session-id", session.id);

      var row = document.createElement("div");
      row.className = "session-row";

      var title = document.createElement("h3");
      title.className = "session-title";
      title.textContent = session.title;

      var deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "delete-btn";
      deleteBtn.textContent = "删除";
      deleteBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        deleteSession(session.id);
      });

      row.appendChild(title);
      row.appendChild(deleteBtn);

      var meta = document.createElement("div");
      meta.className = "session-meta";
      meta.textContent =
        (session.channel === "openai" ? "OpenAI" : "Ollama") +
        " | " +
        session.model +
        " | " +
        session.ragTag +
        " | " +
        formatTime(session.updatedAt);

      item.appendChild(row);
      item.appendChild(meta);
      item.addEventListener("click", function () {
        switchSession(session.id);
      });

      elements.sessionList.appendChild(item);
    });
  }

  function scrollChatBottom() {
    elements.chatBoard.scrollTop = elements.chatBoard.scrollHeight;
  }

  function renderMessages() {
    var session = getActiveSession();
    elements.chatBoard.innerHTML = "";

    if (!session || !Array.isArray(session.messages) || !session.messages.length) {
      var empty = document.createElement("div");
      empty.className = "empty-chat";
      empty.textContent = "当前会话暂无消息，开始输入你的第一个问题。";
      elements.chatBoard.appendChild(empty);
      return;
    }

    session.messages.forEach(function (message) {
      var bubble = document.createElement("div");
      bubble.className = "bubble " + (message.role === "user" ? "user" : "ai");
      bubble.textContent = message.content;
      bubble.setAttribute("data-message-id", message.id);
      elements.chatBoard.appendChild(bubble);
    });

    scrollChatBottom();
  }

  function moveSessionToTop(sessionId) {
    var index = state.sessions.findIndex(function (session) {
      return session.id === sessionId;
    });

    if (index <= 0) {
      return;
    }

    var session = state.sessions[index];
    state.sessions.splice(index, 1);
    state.sessions.unshift(session);
  }

  function switchSession(sessionId) {
    if (!requireLogin("切换会话")) {
      return;
    }

    if (state.activeSessionId === sessionId) {
      return;
    }

    stopStream(false);
    state.activeSessionId = sessionId;
    syncControlsWithActiveSession();
    renderSessionList();
    renderMessages();
    schedulePersist();
    setWorkspaceStatus("状态：已切换会话。");
  }

  function createNewSession() {
    if (!requireLogin("新建会话")) {
      return;
    }

    var current = getActiveSession();
    var seed = current ? {
      channel: current.channel,
      model: current.model,
      ragTag: current.ragTag
    } : null;

    var session = createDefaultSession(seed);
    state.sessions.unshift(session);
    state.activeSessionId = session.id;

    syncControlsWithActiveSession();
    renderSessionList();
    renderMessages();
    schedulePersist();
    setWorkspaceStatus("状态：已创建新会话。", "success");
  }

  function deleteSession(sessionId) {
    if (!requireLogin("删除会话")) {
      return;
    }

    var index = state.sessions.findIndex(function (session) {
      return session.id === sessionId;
    });

    if (index < 0) {
      return;
    }

    if (state.activeSessionId === sessionId) {
      stopStream(false);
    }

    state.sessions.splice(index, 1);

    if (!state.sessions.length) {
      var fallback = createDefaultSession();
      state.sessions.push(fallback);
      state.activeSessionId = fallback.id;
    } else if (state.activeSessionId === sessionId) {
      state.activeSessionId = state.sessions[0].id;
    }

    syncControlsWithActiveSession();
    renderSessionList();
    renderMessages();
    schedulePersist();
    setWorkspaceStatus("状态：会话已删除。");
  }

  function restoreSessionsFromStorage() {
    if (!requireLogin("刷新恢复")) {
      return;
    }

    stopStream(false);
    ensureSessionState();
    syncControlsWithActiveSession();
    renderSessionList();
    renderMessages();
    setWorkspaceStatus("状态：已从本地恢复会话。", "success");
  }

  function updateActiveSessionMeta() {
    var session = getActiveSession();
    if (!session) {
      return;
    }

    session.channel = normalizeChannel(elements.channelSelect.value);
    session.model = normalizeModel(session.channel, elements.modelSelect.value);
    session.ragTag = normalizeTag(elements.knowledgeSelect.value);
    session.updatedAt = nowTs();

    moveSessionToTop(session.id);
    renderSessionList();
    schedulePersist();
  }

  function parseSseData(raw) {
    if (!raw) {
      return [];
    }

    var normalized = String(raw).trim();
    if (!normalized) {
      return [];
    }

    if (normalized === "[DONE]") {
      return [{ done: true }];
    }

    var lines = normalized.split("\n").map(function (line) {
      return line.replace(/^data:\s*/, "").trim();
    }).filter(Boolean);

    var chunks = [];

    lines.forEach(function (line) {
      if (line === "[DONE]") {
        chunks.push({ done: true });
        return;
      }

      try {
        var parsed = JSON.parse(line);
        if (Array.isArray(parsed)) {
          chunks = chunks.concat(parsed);
        } else {
          chunks.push(parsed);
        }
      } catch (error) {
        chunks.push({
          result: {
            output: {
              content: line
            }
          }
        });
      }
    });

    return chunks;
  }

  function extractChunkContent(chunk) {
    if (!chunk) {
      return "";
    }

    if (typeof chunk.content === "string") {
      return chunk.content;
    }

    var nested = chunk.result && chunk.result.output ? chunk.result.output.content : "";
    return typeof nested === "string" ? nested : "";
  }

  function isStopChunk(chunk) {
    if (!chunk) {
      return false;
    }

    if (chunk.done) {
      return true;
    }

    var metadataReason = chunk.result && chunk.result.metadata ? chunk.result.metadata.finishReason : null;
    var propertiesReason =
      chunk.result &&
      chunk.result.output &&
      chunk.result.output.properties
        ? chunk.result.output.properties.finishReason
        : null;

    return metadataReason === "STOP" || propertiesReason === "STOP";
  }

  function refreshAssistantBubble(messageId, content) {
    var bubble = elements.chatBoard.querySelector('[data-message-id="' + messageId + '"]');
    if (bubble) {
      bubble.textContent = content;
      scrollChatBottom();
    }
  }

  function stopStream(manualStop) {
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }

    if (state.streamAbortController) {
      state.streamAbortController.abort();
      state.streamAbortController = null;
    }

    state.isStreaming = false;
    elements.sendBtn.disabled = false;
    elements.stopBtn.disabled = true;

    if (manualStop) {
      setWorkspaceStatus("状态：已手动停止输出。");
    }
  }

  function updateSessionTitleByMessage(session, question) {
    if (!session || !question) {
      return;
    }

    var userMessageCount = session.messages.filter(function (item) {
      return item.role === "user";
    }).length;

    if (userMessageCount !== 1 || session.title !== "新对话") {
      return;
    }

    var normalized = question.replace(/\s+/g, " ").trim();
    session.title = normalized.slice(0, 18) || "新对话";
  }

  function resolveStreamEndpoint(channel) {
    var normalizedChannel = normalizeChannel(channel);
    var endpoint = STREAM_ENDPOINTS[normalizedChannel] || "";
    return endpoint.indexOf("/generate_stream_rag") >= 0 ? endpoint : "";
  }

  function beginStreamingStatus() {
    stopStream(false);
    state.isStreaming = true;
    elements.sendBtn.disabled = true;
    elements.stopBtn.disabled = false;
    setWorkspaceStatus("状态：正在生成回答...");
  }

  function finishStreamingSuccess(session) {
    stopStream(false);
    session.updatedAt = nowTs();
    moveSessionToTop(session.id);
    renderSessionList();
    schedulePersist();
    setWorkspaceStatus("状态：生成完成。", "success");
  }

  function finishStreamingError(session, message) {
    if (!state.isStreaming) {
      return;
    }

    stopStream(false);
    session.updatedAt = nowTs();
    moveSessionToTop(session.id);
    renderSessionList();
    schedulePersist();
    setWorkspaceStatus(message, "error");
  }

  function applyStreamChunks(session, assistantMessage, chunks) {
    if (!chunks.length) {
      return false;
    }

    for (var i = 0; i < chunks.length; i += 1) {
      var chunk = chunks[i];
      var content = extractChunkContent(chunk);

      if (content) {
        assistantMessage.content += content;
        session.updatedAt = nowTs();
        refreshAssistantBubble(assistantMessage.id, assistantMessage.content);
        schedulePersist();
      }

      if (isStopChunk(chunk)) {
        finishStreamingSuccess(session);
        return true;
      }
    }

    return false;
  }

  function openRagEventSource(session, endpoint, params, assistantMessage) {
    state.eventSource = new EventSource(endpoint + "?" + params.toString());

    state.eventSource.onmessage = function (event) {
      var chunks = parseSseData(event.data);
      applyStreamChunks(session, assistantMessage, chunks);
    };

    state.eventSource.onerror = function () {
      finishStreamingError(session, "状态：流式连接中断或接口不可用。");
    };
  }

  async function openRagPostStream(session, endpoint, params, assistantMessage) {
    state.streamAbortController = new AbortController();
    var response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
      },
      body: params.toString(),
      signal: state.streamAbortController.signal
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    if (!response.body) {
      throw new Error("Stream body is empty");
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder("utf-8");
    var buffered = "";

    while (state.isStreaming) {
      var result = await reader.read();
      if (result.done) {
        break;
      }

      buffered += decoder.decode(result.value, { stream: true });
      var lines = buffered.split(/\r?\n/);
      buffered = lines.pop() || "";

      for (var i = 0; i < lines.length; i += 1) {
        var chunks = parseSseData(lines[i]);
        if (applyStreamChunks(session, assistantMessage, chunks)) {
          return;
        }
      }
    }

    if (buffered.trim() && state.isStreaming) {
      var finalChunks = parseSseData(buffered.trim());
      applyStreamChunks(session, assistantMessage, finalChunks);
    }

    if (state.isStreaming) {
      finishStreamingSuccess(session);
    }
  }

  function openRagStream(session, userMessage, assistantMessage) {
    var endpoint = resolveStreamEndpoint(session.channel);
    if (!endpoint) {
      setWorkspaceStatus("状态：无可用的模型通道。", "error");
      return;
    }

    var params = new URLSearchParams({
      model: session.model,
      ragTag: session.ragTag,
      message: userMessage
    });

    beginStreamingStatus();

    if (session.channel === "openai") {
      openRagPostStream(session, endpoint, params, assistantMessage).catch(function (error) {
        if (error && error.name === "AbortError") {
          return;
        }
        finishStreamingError(session, "状态：OpenAI 流式请求失败。");
      });
      return;
    }

    openRagEventSource(session, endpoint, params, assistantMessage);
  }

  function sendMessage() {
    if (!requireLogin("发送消息")) {
      return;
    }

    if (state.isStreaming) {
      setWorkspaceStatus("状态：当前会话正在生成中，请先停止或等待完成。");
      return;
    }

    var session = getActiveSession();
    if (!session) {
      return;
    }

    session.channel = normalizeChannel(elements.channelSelect.value || session.channel);
    session.model = normalizeModel(session.channel, elements.modelSelect.value || session.model);
    session.ragTag = normalizeTag(elements.knowledgeSelect.value || session.ragTag);

    var content = elements.messageInput.value.trim();
    if (!content) {
      setWorkspaceStatus("状态：请输入问题内容。");
      return;
    }

    if (!session.ragTag) {
      setWorkspaceStatus("状态：请先选择知识库。", "error");
      return;
    }

    var now = nowTs();
    var userMessage = {
      id: createId(),
      role: "user",
      content: content,
      createdAt: now
    };

    var assistantMessage = {
      id: createId(),
      role: "assistant",
      content: "",
      createdAt: now + 1
    };

    session.messages.push(userMessage);
    session.messages.push(assistantMessage);
    session.updatedAt = now;

    updateSessionTitleByMessage(session, content);
    moveSessionToTop(session.id);
    renderSessionList();
    renderMessages();
    schedulePersist();

    elements.messageInput.value = "";
    elements.messageInput.focus();

    openRagStream(session, content, assistantMessage);
  }

  async function loadKnowledgeTags() {
    try {
      var response = await fetch(RAG_TAG_ENDPOINT, { method: "GET" });
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      var payload = await response.json();
      var fetchedTags = extractTagList(payload);

      if (payload && payload.code === "0000") {
        state.knowledgeTags = uniqueStrings(fetchedTags.concat(state.knowledgeTags));
        state.lastTagSyncAt = nowTs();

        var session = getActiveSession();
        if (session) {
          session.ragTag = renderKnowledgeOptions(session.ragTag);
          schedulePersist();
        }

        if (fetchedTags.length) {
          setWorkspaceStatus("状态：知识库标签已刷新。", "success");
        } else {
          setWorkspaceStatus("状态：标签列表为空，已保留本地可用标签。");
        }

        return;
      }

      throw new Error("业务状态码非成功");
    } catch (error) {
      var activeSession = getActiveSession();
      if (activeSession) {
        activeSession.ragTag = renderKnowledgeOptions(activeSession.ragTag);
      }
      setWorkspaceStatus("状态：未获取到知识库列表，已使用本地标签。", "error");
    }
  }

  function bindUploadNavigationHints() {
    var navLinks = document.querySelectorAll("[data-upload-entry]");
    navLinks.forEach(function (link) {
      link.addEventListener("click", function () {
        if (!requireLogin("进入上传入口")) {
          return;
        }

        var target = link.getAttribute("data-upload-entry");
        var targetName = target === "code" ? "代码库上传页" : "知识库上传页";
        setWorkspaceStatus("状态：正在跳转至" + targetName + "。");
      });
    });
  }

  function handleLoginSubmit(event) {
    event.preventDefault();

    var account = elements.loginAccount.value.trim();
    var password = elements.loginPassword.value;

    if (account.length < 2) {
      setLoginStatus("状态：请输入有效账号。", "error");
      elements.loginAccount.focus();
      return;
    }

    if (password.length < 4) {
      setLoginStatus("状态：请输入有效密码。", "error");
      elements.loginPassword.focus();
      return;
    }

    var now = nowTs();
    state.auth = {
      loggedIn: true,
      account: account,
      loginAt: now,
      expiresAt: now + LOGIN_SESSION_TTL_MS
    };

    persistAuthState();
    elements.loginPassword.value = "";
    applyAuthView();
    syncControlsWithActiveSession();
    renderSessionList();
    renderMessages();

    setLoginStatus("状态：登录成功，已进入工作台。", "success");
    setWorkspaceStatus("状态：欢迎回来，" + account + "。", "success");
    elements.messageInput.focus();
  }

  function logout() {
    if (!state.auth.loggedIn) {
      return;
    }

    stopStream(false);
    clearAuthState();
    applyAuthView();

    setLoginStatus("状态：已退出登录，请重新登录后继续。", "success");
    setWorkspaceStatus("状态：已退出登录。", "success");
  }

  function bindEvents() {
    elements.loginForm.addEventListener("submit", handleLoginSubmit);

    elements.logoutBtn.addEventListener("click", function () {
      logout();
    });

    elements.newChatBtn.addEventListener("click", function () {
      createNewSession();
    });

    if (elements.restoreBtn) {
      elements.restoreBtn.addEventListener("click", function () {
        restoreSessionsFromStorage();
      });
    }

    elements.channelSelect.addEventListener("change", function () {
      if (!requireLogin("切换模型通道")) {
        return;
      }

      var session = getActiveSession();
      if (!session) {
        return;
      }

      session.channel = normalizeChannel(elements.channelSelect.value);
      session.model = renderModelOptions(session.channel, normalizeModel(session.channel, session.model));
      session.updatedAt = nowTs();
      moveSessionToTop(session.id);
      renderSessionList();
      schedulePersist();
      setWorkspaceStatus("状态：已切换模型通道。");
    });

    elements.modelSelect.addEventListener("change", function () {
      if (!requireLogin("切换模型")) {
        return;
      }

      updateActiveSessionMeta();
      setWorkspaceStatus("状态：已更新模型。");
    });

    elements.knowledgeSelect.addEventListener("change", function () {
      if (!requireLogin("切换知识库")) {
        return;
      }

      updateActiveSessionMeta();
      setWorkspaceStatus("状态：已更新知识库。");
    });

    elements.sendBtn.addEventListener("click", function () {
      sendMessage();
    });

    elements.stopBtn.addEventListener("click", function () {
      if (!requireLogin("停止输出")) {
        return;
      }
      stopStream(true);
    });

    elements.messageInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });

    window.addEventListener("beforeunload", function () {
      stopStream(false);
      persistSessions();
      persistAuthState();
    });

    bindUploadNavigationHints();
  }

  function init() {
    ensureAuthState();
    ensureSessionState();

    syncControlsWithActiveSession();
    renderSessionList();
    renderMessages();
    bindEvents();
    applyAuthView();

    loadKnowledgeTags();

    if (state.auth.loggedIn) {
      setWorkspaceStatus("状态：已恢复会话。", "success");
      setLoginStatus("状态：登录态有效。", "success");
    } else {
      setLoginStatus("状态：请先登录后使用业务功能。");
      setWorkspaceStatus("状态：未登录。", "error");
    }
  }

  init();
})();
