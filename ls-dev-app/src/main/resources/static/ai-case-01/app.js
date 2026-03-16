const STREAM_CONFIG = {
  directStreamPath: "/api/v1/ollama/generate_stream",
  preparePath: "/api/v1/ollama/stream_prepare",
  sessionStreamPath: "/api/v1/ollama/generate_stream_by_session",
  maxDirectUrlLength: 1600
};

const elements = {
  modelInput: document.getElementById("modelInput"),
  messageInput: document.getElementById("messageInput"),
  sendBtn: document.getElementById("sendBtn"),
  stopBtn: document.getElementById("stopBtn"),
  clearBtn: document.getElementById("clearBtn"),
  statusText: document.getElementById("statusText"),
  transportBadge: document.getElementById("transportBadge"),
  chatList: document.getElementById("chatList"),
  emptyState: document.getElementById("emptyState")
};

const state = {
  eventSource: null,
  isStreaming: false
};

function setStatus(text) {
  elements.statusText.textContent = text;
}

function setTransportBadge(text, tone) {
  const toneMap = {
    idle: "bg-white text-slate-500 ring-slate-200",
    direct: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    session: "bg-sky-50 text-sky-700 ring-sky-200",
    warn: "bg-amber-50 text-amber-700 ring-amber-200"
  };

  elements.transportBadge.className =
    "rounded-full px-3 py-1 text-xs font-medium ring-1 " + (toneMap[tone] || toneMap.idle);
  elements.transportBadge.textContent = text;
}

function removeEmptyState() {
  if (elements.emptyState) {
    elements.emptyState.remove();
    elements.emptyState = null;
  }
}

function scrollToBottom() {
  elements.chatList.scrollTop = elements.chatList.scrollHeight;
}

function createBubble(role, text) {
  removeEmptyState();

  const row = document.createElement("div");
  row.className = role === "user" ? "flex justify-end" : "flex justify-start";

  const bubble = document.createElement("div");
  bubble.className =
    role === "user"
      ? "max-w-[88%] rounded-[26px] rounded-br-lg bg-slate-950 px-4 py-3 text-sm leading-7 text-white shadow-sm whitespace-pre-wrap"
      : "max-w-[88%] rounded-[26px] rounded-bl-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700 shadow-sm whitespace-pre-wrap";
  bubble.textContent = text || "";

  row.appendChild(bubble);
  elements.chatList.appendChild(row);
  scrollToBottom();

  return bubble;
}

function closeCurrentStream() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }

  state.isStreaming = false;
  elements.sendBtn.disabled = false;
  elements.stopBtn.disabled = true;
}

function buildDirectStreamUrl(model, message) {
  const params = new URLSearchParams({
    model: model,
    message: message
  });

  return STREAM_CONFIG.directStreamPath + "?" + params.toString();
}

function buildSessionStreamUrl(sessionId) {
  const params = new URLSearchParams({
    sessionId: sessionId
  });

  return STREAM_CONFIG.sessionStreamPath + "?" + params.toString();
}

function resolveStreamMode(model, message) {
  const directUrl = buildDirectStreamUrl(model, message);
  return directUrl.length > STREAM_CONFIG.maxDirectUrlLength ? "session" : "direct";
}

function parseSseData(raw) {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    console.error("SSE data parse failed", error, raw);
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
  elements.sendBtn.disabled = true;
  elements.stopBtn.disabled = false;

  setStatus(mode === "direct" ? "正在直连流式输出..." : "正在会话流式输出...");
  setTransportBadge(mode === "direct" ? "直接流式" : "会话流式", mode);

  state.eventSource.onmessage = function (event) {
    const chunks = parseSseData(event.data);
    if (!chunks.length) {
      return;
    }

    for (const chunk of chunks) {
      appendAssistantChunk(assistantBubble, chunk);

      if (isStopChunk(chunk)) {
        setStatus("生成完成");
        scrollToBottom();
        closeCurrentStream();
        return;
      }
    }

    scrollToBottom();
  };

  state.eventSource.onerror = function () {
    if (!state.isStreaming) {
      return;
    }

    setStatus("流连接中断或服务端已结束输出");
    closeCurrentStream();
  };
}

async function prepareLongTextSession(model, message) {
  const response = await fetch(STREAM_CONFIG.preparePath, {
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
    throw new Error("Prepare request failed, HTTP " + response.status);
  }

  const payload = await response.json();
  const sessionId = payload.sessionId;

  if (!sessionId) {
    throw new Error("Prepare response did not return sessionId");
  }

  return sessionId;
}

async function sendMessage() {
  const model = elements.modelInput.value.trim();
  const message = elements.messageInput.value.trim();

  if (!model) {
    setStatus("请先填写模型名称");
    return;
  }

  if (!message) {
    setStatus("请输入问题内容");
    return;
  }

  closeCurrentStream();

  createBubble("user", message);
  const assistantBubble = createBubble("assistant", "");

  elements.messageInput.value = "";
  elements.messageInput.focus();

  try {
    const streamMode = resolveStreamMode(model, message);

    if (streamMode === "direct") {
      openStream(buildDirectStreamUrl(model, message), assistantBubble, "direct");
      return;
    }

    setStatus("文本较长，正在预提交消息...");
    setTransportBadge("准备会话流式", "warn");

    const sessionId = await prepareLongTextSession(model, message);
    openStream(buildSessionStreamUrl(sessionId), assistantBubble, "session");
  } catch (error) {
    assistantBubble.textContent =
      "请求未完成：" + (error && error.message ? error.message : "发生未知错误。");
    setStatus("发送失败");
    setTransportBadge("发送失败", "warn");
    closeCurrentStream();
  }
}

elements.sendBtn.addEventListener("click", function () {
  void sendMessage();
});

elements.stopBtn.addEventListener("click", function () {
  setStatus("已手动停止");
  setTransportBadge("已停止", "warn");
  closeCurrentStream();
});

elements.clearBtn.addEventListener("click", function () {
  closeCurrentStream();
  elements.chatList.innerHTML =
    '<div id="emptyState" class="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm leading-7 text-slate-400">输入内容后点击发送，演示页会自动选择最合适的流式方式。</div>';
  elements.emptyState = document.getElementById("emptyState");
  setStatus("已清空对话");
  setTransportBadge("自动判断", "idle");
});

elements.messageInput.addEventListener("keydown", function (event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendMessage();
  }
});

setTransportBadge("自动判断", "idle");
