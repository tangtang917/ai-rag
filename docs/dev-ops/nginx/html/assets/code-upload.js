/*
  File: assets/code-upload.js
  Purpose: Upload controller for code-upload.html bound to /api/v1/rag/analyze_git_repositiry.
  Flow: Validate repo credentials -> send analyze request -> display success/error status.
  Updated: 2026-03-23
*/
(function () {
  var config = window.AI_WORKSPACE_CONFIG || {};
  var endpoints = config.endpoints || {};
  var ANALYZE_ENDPOINT = endpoints.ragAnalyzeGitRepository || "/api/v1/rag/analyze_git_repositiry";

  var elements = {
    repoUrl: document.getElementById("repoUrl"),
    userName: document.getElementById("userName"),
    token: document.getElementById("token"),
    analyzeStatus: document.getElementById("analyzeStatus"),
    analyzeBtn: document.getElementById("analyzeBtn")
  };

  var state = {
    busy: false
  };

  function setStatus(text, tone) {
    elements.analyzeStatus.classList.remove("success", "error");
    if (tone === "success") {
      elements.analyzeStatus.classList.add("success");
    } else if (tone === "error") {
      elements.analyzeStatus.classList.add("error");
    }
    elements.analyzeStatus.textContent = text;
  }

  function setBusy(busy) {
    state.busy = busy;
    elements.analyzeBtn.disabled = busy;
    elements.repoUrl.disabled = busy;
    elements.userName.disabled = busy;
    elements.token.disabled = busy;
  }

  function normalizeValue(raw) {
    if (typeof raw !== "string") {
      return "";
    }
    return raw.trim();
  }

  function isValidRepoUrl(url) {
    if (!url) {
      return false;
    }

    var candidate = url.toLowerCase();
    return candidate.indexOf("http://") === 0 || candidate.indexOf("https://") === 0 || candidate.indexOf("git@") === 0;
  }

  async function analyzeRepository() {
    if (state.busy) {
      return;
    }

    var repoUrl = normalizeValue(elements.repoUrl.value);
    var userName = normalizeValue(elements.userName.value);
    var token = elements.token.value;

    if (!repoUrl) {
      setStatus("状态：请先填写仓库地址。", "error");
      elements.repoUrl.focus();
      return;
    }

    if (!isValidRepoUrl(repoUrl)) {
      setStatus("状态：仓库地址格式不合法，请使用 https:// 或 git@ 格式。", "error");
      elements.repoUrl.focus();
      return;
    }

    if (!userName) {
      setStatus("状态：请先填写仓库用户名。", "error");
      elements.userName.focus();
      return;
    }

    if (!token) {
      setStatus("状态：请先填写访问令牌。", "error");
      elements.token.focus();
      return;
    }

    setBusy(true);
    setStatus("状态：正在提交分析入库请求，请稍候...");

    try {
      var payload = new URLSearchParams({
        repoUrl: repoUrl,
        userName: userName,
        token: token
      });

      var response = await fetch(ANALYZE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body: payload.toString()
      });

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      var result = await response.json();
      if (result && result.code === "0000") {
        setStatus("状态：代码库分析入库成功。", "success");
        elements.token.value = "";
        return;
      }

      var message = result && result.msg ? result.msg : "分析入库失败";
      throw new Error(message);
    } catch (error) {
      setStatus("状态：分析入库失败，原因：" + error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function bindEvents() {
    elements.analyzeBtn.addEventListener("click", function () {
      analyzeRepository();
    });

    [elements.repoUrl, elements.userName, elements.token].forEach(function (input) {
      input.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          analyzeRepository();
        }
      });
    });
  }

  function init() {
    bindEvents();
  }

  init();
})();
