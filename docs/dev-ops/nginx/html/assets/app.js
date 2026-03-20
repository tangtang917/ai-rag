/*
  File: assets/app.js
  Purpose: Front-end controller for chat streaming, session persistence and knowledge-tag bootstrap.
  Flow: Restore session state -> bind UI events -> call stream_rag endpoints -> persist local sessions.
  Updated: 2026-03-20
*/
const STORAGE_KEY = "ai_workspace_sessions_v1";
const ACTIVE_SESSION_KEY = "ai_workspace_active_session_v1";
const RAG_TAG_ENDPOINT = "/api/v1/rag/query_rag_tag_list";
const SESSION_PERSIST_DELAY_MS = 150;

const CHANNEL_MODELS = {
  ollama: ["deepseek-r1:1.5b", "qwen2.5:7b", "llama3.1:8b"],
  openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"]
};

const STREAM_ENDPOINTS = {
  ollama: "/api/v1/ollama/generate_stream_rag",
  openai: "/api/v1/openai/generate_stream_rag"
};

const DEFAULT_TAGS = ["default", "project-docs", "product-kb"];

const elements = {
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

const state = {
  sessions: [],
  activeSessionId: null,
  knowledgeTags: [...DEFAULT_TAGS],
  eventSource: null,
  streamAbortController: null,
  isStreaming: false,
  persistTimer: null,
  lastTagSyncAt: null
};

function createId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((item) => typeof item === "string" && item.trim()))];
}

function normalizeChannel(rawChannel) {
  return rawChannel === "openai" ? "openai" : "ollama";
}

function normalizeModel(rawChannel, rawModel) {
  const channel = normalizeChannel(rawChannel);
  const modelCandidates = CHANNEL_MODELS[channel] || CHANNEL_MODELS.ollama;
  return modelCandidates.includes(rawModel) ? rawModel : modelCandidates[0];
}

function normalizeTag(rawTag) {
  if (typeof rawTag !== "string") {
    return "";
  }
  return rawTag.trim();
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

  const date = new Date(ts);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return mm + "-" + dd + " " + hh + ":" + min;
}

function createDefaultSession(seed) {
  const channel = normalizeChannel(seed && seed.channel ? seed.channel : "ollama");
  const model = normalizeModel(channel, seed && seed.model ? seed.model : "");
  const preferredTag = normalizeTag(seed && seed.ragTag ? seed.ragTag : "");
  const ragTag = preferredTag || state.knowledgeTags[0] || DEFAULT_TAGS[0];
  const now = Date.now();

  return {
    id: createId(),
    title: "新对话",
    channel: channel,
    model: model,
    ragTag: ragTag,
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: createId(),
        role: "assistant",
        content: "新会话已创建，请输入你的问题。",
        createdAt: now
      }
    ]
  };
}

function sanitizeMessage(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const role = raw.role === "user" ? "user" : "assistant";
  const content = typeof raw.content === "string" ? raw.content : "";
  return {
    id: typeof raw.id === "string" ? raw.id : createId(),
    role: role,
    content: content,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now()
  };
}

function sanitizeSession(raw, index) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const channel = normalizeChannel(raw.channel);
  const model = normalizeModel(channel, raw.model);
  const ragTag = normalizeTag(raw.ragTag) || state.knowledgeTags[0] || DEFAULT_TAGS[0];
  const now = Date.now();

  const messages = Array.isArray(raw.messages)
    ? raw.messages.map(sanitizeMessage).filter(Boolean)
    : [];

  return {
    id: typeof raw.id === "string" ? raw.id : createId(),
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "新对话 " + (index + 1),
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

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.sessions));
    localStorage.setItem(ACTIVE_SESSION_KEY, state.activeSessionId || "");
  } catch (error) {
    setStatus("状态：浏览器存储空间不足，无法继续保存会话。", "error");
  }
}

function schedulePersist() {
  if (state.persistTimer) {
    window.clearTimeout(state.persistTimer);
  }

  state.persistTimer = window.setTimeout(function () {
    persistState();
  }, SESSION_PERSIST_DELAY_MS);
}

function setStatus(text, tone) {
  elements.statusStrip.classList.remove("success", "error");
  if (tone === "success") {
    elements.statusStrip.classList.add("success");
  } else if (tone === "error") {
    elements.statusStrip.classList.add("error");
  }
  elements.statusStrip.textContent = text;
}

function getActiveSession() {
  return state.sessions.find((session) => session.id === state.activeSessionId) || null;
}

function ensureSessionState() {
  let storedSessionsRaw = "[]";
  let activeIdRaw = "";

  try {
    storedSessionsRaw = localStorage.getItem(STORAGE_KEY) || "[]";
    activeIdRaw = localStorage.getItem(ACTIVE_SESSION_KEY) || "";
  } catch (error) {
    setStatus("状态：读取本地会话失败，已使用默认会话。", "error");
  }

  const storedSessions = safeParseJson(storedSessionsRaw, []);
  const parsed = Array.isArray(storedSessions)
    ? storedSessions.map(sanitizeSession).filter(Boolean)
    : [];

  state.sessions = parsed.length ? parsed : [createDefaultSession()];

  const activeId = activeIdRaw;
  const hasActive = state.sessions.some((session) => session.id === activeId);
  state.activeSessionId = hasActive ? activeId : state.sessions[0].id;

  const activeSession = getActiveSession();
  if (activeSession && activeSession.ragTag) {
    state.knowledgeTags = uniqueStrings([activeSession.ragTag, ...state.knowledgeTags]);
  }
}

function restoreSessionsFromStorage() {
  stopStream(false);
  ensureSessionState();
  syncControlsWithActiveSession();
  renderSessionList();
  renderMessages();
  setStatus("状态：已从本地恢复会话。", "success");
}

function renderModelOptions(channel, selectedModel) {
  const models = CHANNEL_MODELS[channel] || CHANNEL_MODELS.ollama;
  elements.modelSelect.innerHTML = "";

  models.forEach(function (model) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    elements.modelSelect.appendChild(option);
  });

  const finalModel = models.includes(selectedModel) ? selectedModel : models[0];
  elements.modelSelect.value = finalModel;
  return finalModel;
}

function renderKnowledgeOptions(selectedTag) {
  const tags = uniqueStrings([...state.knowledgeTags, selectedTag || ""]);
  const fallbackTag = tags.length ? tags[0] : "default";
  const finalTag = tags.includes(selectedTag) ? selectedTag : fallbackTag;

  elements.knowledgeSelect.innerHTML = "";
  (tags.length ? tags : [fallbackTag]).forEach(function (tag) {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = tag;
    elements.knowledgeSelect.appendChild(option);
  });

  elements.knowledgeSelect.value = finalTag;
  return finalTag;
}

function syncControlsWithActiveSession() {
  const session = getActiveSession();
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
    const item = document.createElement("div");
    item.className = "session-item" + (session.id === state.activeSessionId ? " active" : "");
    item.setAttribute("data-session-id", session.id);

    const row = document.createElement("div");
    row.className = "session-row";

    const title = document.createElement("h3");
    title.className = "session-title";
    title.textContent = session.title;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "删除";
    deleteBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      deleteSession(session.id);
    });

    row.appendChild(title);
    row.appendChild(deleteBtn);

    const meta = document.createElement("div");
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
  const session = getActiveSession();
  elements.chatBoard.innerHTML = "";

  if (!session || !Array.isArray(session.messages) || !session.messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-chat";
    empty.textContent = "当前会话暂无消息，开始输入你的第一个问题。";
    elements.chatBoard.appendChild(empty);
    return;
  }

  session.messages.forEach(function (message) {
    const bubble = document.createElement("div");
    bubble.className = "bubble " + (message.role === "user" ? "user" : "ai");
    bubble.textContent = message.content;
    bubble.setAttribute("data-message-id", message.id);
    elements.chatBoard.appendChild(bubble);
  });

  scrollChatBottom();
}

function moveSessionToTop(sessionId) {
  const index = state.sessions.findIndex((session) => session.id === sessionId);
  if (index <= 0) {
    return;
  }

  const session = state.sessions[index];
  state.sessions.splice(index, 1);
  state.sessions.unshift(session);
}

function switchSession(sessionId) {
  if (state.activeSessionId === sessionId) {
    return;
  }

  stopStream(false);
  state.activeSessionId = sessionId;
  syncControlsWithActiveSession();
  renderSessionList();
  renderMessages();
  schedulePersist();
  setStatus("状态：已切换会话。");
}

function createNewSession() {
  const current = getActiveSession();
  const seed = current ? { channel: current.channel, model: current.model, ragTag: current.ragTag } : null;
  const session = createDefaultSession(seed);

  state.sessions.unshift(session);
  state.activeSessionId = session.id;

  syncControlsWithActiveSession();
  renderSessionList();
  renderMessages();
  schedulePersist();
  setStatus("状态：已创建新会话。", "success");
}

function deleteSession(sessionId) {
  const targetIndex = state.sessions.findIndex((session) => session.id === sessionId);
  if (targetIndex < 0) {
    return;
  }

  if (state.activeSessionId === sessionId) {
    stopStream(false);
  }

  state.sessions.splice(targetIndex, 1);

  if (!state.sessions.length) {
    const fallback = createDefaultSession();
    state.sessions.push(fallback);
    state.activeSessionId = fallback.id;
  } else if (state.activeSessionId === sessionId) {
    state.activeSessionId = state.sessions[0].id;
  }

  syncControlsWithActiveSession();
  renderSessionList();
  renderMessages();
  schedulePersist();
  setStatus("状态：会话已删除。");
}

function updateActiveSessionMeta() {
  const session = getActiveSession();
  if (!session) {
    return;
  }

  session.channel = normalizeChannel(elements.channelSelect.value);
  session.model = normalizeModel(session.channel, elements.modelSelect.value);
  session.ragTag = normalizeTag(elements.knowledgeSelect.value);
  session.updatedAt = Date.now();

  moveSessionToTop(session.id);
  renderSessionList();
  schedulePersist();
}

function parseSseData(raw) {
  if (!raw) {
    return [];
  }

  if (raw === "[DONE]") {
    return [{ done: true }];
  }

  const lines = String(raw)
    .split("\n")
    .map(function (line) {
      return line.replace(/^data:\s*/, "").trim();
    })
    .filter(Boolean);

  const normalizedChunks = lines.length ? lines : [String(raw).trim()];
  const parsedChunks = [];

  for (const item of normalizedChunks) {
    if (item === "[DONE]") {
      parsedChunks.push({ done: true });
      continue;
    }

    try {
      const parsed = JSON.parse(item);
      if (Array.isArray(parsed)) {
        parsedChunks.push.apply(parsedChunks, parsed);
      } else {
        parsedChunks.push(parsed);
      }
    } catch (error) {
      parsedChunks.push({
        result: {
          output: {
            content: item
          }
        }
      });
    }
  }

  if (parsedChunks.length) {
    return parsedChunks;
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    return [];
  }
}

function extractChunkContent(chunk) {
  if (!chunk) {
    return "";
  }

  if (typeof chunk.content === "string") {
    return chunk.content;
  }

  const content = chunk.result && chunk.result.output ? chunk.result.output.content : "";
  return typeof content === "string" ? content : "";
}

function isStopChunk(chunk) {
  if (!chunk) {
    return false;
  }

  if (chunk.done) {
    return true;
  }

  const metadataReason = chunk.result && chunk.result.metadata ? chunk.result.metadata.finishReason : null;
  const propertiesReason =
    chunk.result &&
    chunk.result.output &&
    chunk.result.output.properties
      ? chunk.result.output.properties.finishReason
      : null;

  return metadataReason === "STOP" || propertiesReason === "STOP";
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
    setStatus("状态：已手动停止输出。");
  }
}

function refreshAssistantBubble(messageId, content) {
  const bubble = elements.chatBoard.querySelector("[data-message-id=\"" + messageId + "\"]");
  if (bubble) {
    bubble.textContent = content;
    scrollChatBottom();
  }
}

function updateSessionTitleByMessage(session, message) {
  if (!session || !message) {
    return;
  }

  const userMessageCount = session.messages.filter((item) => item.role === "user").length;
  if (userMessageCount !== 1 || session.title !== "新对话") {
    return;
  }

  const normalized = message.replace(/\s+/g, " ").trim();
  session.title = normalized.slice(0, 18) || "新对话";
}

function resolveStreamEndpoint(channel) {
  const normalizedChannel = normalizeChannel(channel);
  const endpoint = STREAM_ENDPOINTS[normalizedChannel];
  if (!endpoint || endpoint.indexOf("/generate_stream_rag") < 0) {
    return "";
  }
  return endpoint;
}

function beginStreamingStatus() {
  stopStream(false);
  state.isStreaming = true;
  elements.sendBtn.disabled = true;
  elements.stopBtn.disabled = false;
  setStatus("状态：正在生成回答...");
}

function finishStreamingSuccess(session) {
  stopStream(false);
  setStatus("状态：生成完成。", "success");
  session.updatedAt = Date.now();
  moveSessionToTop(session.id);
  renderSessionList();
  schedulePersist();
}

function finishStreamingError(session, message) {
  if (!state.isStreaming) {
    return;
  }

  stopStream(false);
  setStatus(message, "error");
  session.updatedAt = Date.now();
  moveSessionToTop(session.id);
  renderSessionList();
  schedulePersist();
}

function applyStreamChunks(session, assistantMessage, chunks) {
  if (!chunks.length) {
    return false;
  }

  for (const chunk of chunks) {
    const content = extractChunkContent(chunk);
    if (content) {
      assistantMessage.content += content;
      session.updatedAt = Date.now();
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
    const chunks = parseSseData(event.data);
    applyStreamChunks(session, assistantMessage, chunks);
  };

  state.eventSource.onerror = function () {
    finishStreamingError(session, "状态：流式连接中断或接口不可用。");
  };
}

async function openRagPostStream(session, endpoint, params, assistantMessage) {
  state.streamAbortController = new AbortController();
  const response = await fetch(endpoint, {
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

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffered = "";

  while (state.isStreaming) {
    const result = await reader.read();
    if (result.done) {
      break;
    }

    buffered += decoder.decode(result.value, { stream: true });
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || "";

    for (const line of lines) {
      const chunks = parseSseData(line);
      if (applyStreamChunks(session, assistantMessage, chunks)) {
        return;
      }
    }
  }

  if (buffered.trim() && state.isStreaming) {
    const chunks = parseSseData(buffered.trim());
    applyStreamChunks(session, assistantMessage, chunks);
  }

  if (state.isStreaming) {
    finishStreamingSuccess(session);
  }
}

function openRagStream(session, userMessage, assistantMessage) {
  const endpoint = resolveStreamEndpoint(session.channel);
  if (!endpoint) {
    setStatus("状态：无可用的模型通道。", "error");
    return;
  }

  const params = new URLSearchParams({
    model: session.model,
    ragTag: session.ragTag,
    message: userMessage
  });

  beginStreamingStatus();

  if (session.channel === "openai") {
    void openRagPostStream(session, endpoint, params, assistantMessage).catch(function (error) {
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
  if (state.isStreaming) {
    setStatus("状态：当前会话正在生成中，请先停止或等待完成。");
    return;
  }

  const session = getActiveSession();
  if (!session) {
    return;
  }

  session.channel = normalizeChannel(elements.channelSelect.value || session.channel);
  session.model = normalizeModel(session.channel, elements.modelSelect.value || session.model);
  session.ragTag = normalizeTag(elements.knowledgeSelect.value || session.ragTag);

  const content = elements.messageInput.value.trim();
  if (!content) {
    setStatus("状态：请输入问题内容。");
    return;
  }

  if (!session.ragTag) {
    setStatus("状态：请先选择知识库。", "error");
    return;
  }

  const now = Date.now();
  const userMessage = {
    id: createId(),
    role: "user",
    content: content,
    createdAt: now
  };

  const assistantMessage = {
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
    const response = await fetch(RAG_TAG_ENDPOINT, { method: "GET" });
    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    const payload = await response.json();
    const fetchedTags = extractTagList(payload);
    if (payload && payload.code === "0000") {
      state.knowledgeTags = uniqueStrings([...fetchedTags, ...state.knowledgeTags]);
      state.lastTagSyncAt = Date.now();
      const session = getActiveSession();
      if (session) {
        session.ragTag = renderKnowledgeOptions(session.ragTag);
        schedulePersist();
      }

      if (fetchedTags.length) {
        setStatus("状态：知识库标签已刷新。", "success");
      } else {
        setStatus("状态：标签列表为空，已保留本地可用标签。");
      }
      return;
    }

    throw new Error("业务状态码非成功");
  } catch (error) {
    const session = getActiveSession();
    if (session) {
      session.ragTag = renderKnowledgeOptions(session.ragTag);
    }
    setStatus("状态：未获取到知识库列表，已使用本地标签。", "error");
  }
}

function bindUploadNavigationHints() {
  const navLinks = document.querySelectorAll("[data-upload-entry]");
  navLinks.forEach(function (link) {
    link.addEventListener("click", function () {
      const target = link.getAttribute("data-upload-entry");
      const targetName = target === "code" ? "代码库上传页" : "知识库上传页";
      setStatus("状态：正在跳转至" + targetName + "。");
    });
  });
}

function bindEvents() {
  elements.newChatBtn.addEventListener("click", function () {
    createNewSession();
  });

  if (elements.restoreBtn) {
    elements.restoreBtn.addEventListener("click", function () {
      restoreSessionsFromStorage();
    });
  }

  elements.channelSelect.addEventListener("change", function () {
    const session = getActiveSession();
    if (!session) {
      return;
    }

    session.channel = normalizeChannel(elements.channelSelect.value);
    session.model = renderModelOptions(session.channel, normalizeModel(session.channel, session.model));
    session.updatedAt = Date.now();
    moveSessionToTop(session.id);
    renderSessionList();
    schedulePersist();
    setStatus("状态：已切换模型通道。");
  });

  elements.modelSelect.addEventListener("change", function () {
    updateActiveSessionMeta();
    setStatus("状态：已更新模型。");
  });

  elements.knowledgeSelect.addEventListener("change", function () {
    updateActiveSessionMeta();
    setStatus("状态：已更新知识库。");
  });

  elements.sendBtn.addEventListener("click", function () {
    sendMessage();
  });

  elements.stopBtn.addEventListener("click", function () {
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
    persistState();
  });

  bindUploadNavigationHints();
}

function init() {
  ensureSessionState();
  syncControlsWithActiveSession();
  renderSessionList();
  renderMessages();
  bindEvents();
  loadKnowledgeTags();
  setStatus("状态：已恢复会话。");
}

init();
