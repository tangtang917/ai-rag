/*
  File: assets/rag-upload.js
  Purpose: Upload controller for rag-upload.html bound to /api/v1/rag/file/upload.
  Flow: Load available tags -> resolve ragTag (newTag first) -> send multipart files -> refresh tags and status.
  Updated: 2026-03-23
*/
(function () {
  var config = window.AI_WORKSPACE_CONFIG || {};
  var endpoints = config.endpoints || {};

  var RAG_TAG_ENDPOINT = endpoints.ragTags || "/api/v1/rag/query_rag_tag_list";
  var RAG_UPLOAD_ENDPOINT = endpoints.ragUpload || "/api/v1/rag/file/upload";

  var elements = {
    existingTag: document.getElementById("existingTag"),
    newTag: document.getElementById("newTag"),
    files: document.getElementById("files"),
    selectedFiles: document.getElementById("selectedFiles"),
    uploadStatus: document.getElementById("uploadStatus"),
    uploadBtn: document.getElementById("uploadBtn")
  };

  var state = {
    uploading: false,
    tags: []
  };

  function setStatus(text, tone) {
    elements.uploadStatus.classList.remove("success", "error");
    if (tone === "success") {
      elements.uploadStatus.classList.add("success");
    } else if (tone === "error") {
      elements.uploadStatus.classList.add("error");
    }
    elements.uploadStatus.textContent = text;
  }

  function setUploadingState(uploading) {
    state.uploading = uploading;
    elements.uploadBtn.disabled = uploading;
    elements.files.disabled = uploading;
    elements.existingTag.disabled = uploading;
    elements.newTag.disabled = uploading;
  }

  function normalizeTag(raw) {
    if (typeof raw !== "string") {
      return "";
    }
    return raw.trim();
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

  function uniqueTags(tags) {
    var dedup = {};
    var results = [];

    tags.forEach(function (tag) {
      var clean = normalizeTag(tag);
      if (!clean || dedup[clean]) {
        return;
      }
      dedup[clean] = true;
      results.push(clean);
    });

    return results;
  }

  function renderTagOptions(selected) {
    elements.existingTag.innerHTML = "";

    var options = state.tags.length ? state.tags.slice() : ["default"];
    options.forEach(function (tag) {
      var option = document.createElement("option");
      option.value = tag;
      option.textContent = tag;
      elements.existingTag.appendChild(option);
    });

    var finalTag = normalizeTag(selected);
    if (!finalTag || options.indexOf(finalTag) < 0) {
      finalTag = options[0];
    }
    elements.existingTag.value = finalTag;
  }

  function renderSelectedFiles() {
    elements.selectedFiles.innerHTML = "";

    var files = elements.files.files;
    if (!files || files.length === 0) {
      var empty = document.createElement("li");
      empty.textContent = "尚未选择文件";
      elements.selectedFiles.appendChild(empty);
      return;
    }

    Array.prototype.forEach.call(files, function (file) {
      var item = document.createElement("li");
      var sizeKb = (file.size / 1024).toFixed(1);
      item.textContent = file.name + " (" + sizeKb + " KB)";
      elements.selectedFiles.appendChild(item);
    });
  }

  function resolveUploadTag() {
    var newTag = normalizeTag(elements.newTag.value);
    if (newTag) {
      return newTag;
    }
    return normalizeTag(elements.existingTag.value);
  }

  async function loadTagList(preferredTag) {
    try {
      var response = await fetch(RAG_TAG_ENDPOINT, { method: "GET" });
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      var payload = await response.json();
      var tags = uniqueTags(extractTagList(payload));
      if (payload && payload.code === "0000") {
        state.tags = tags;
        renderTagOptions(preferredTag);
        setStatus("状态：已加载知识库标签。", "success");
        return;
      }

      throw new Error("业务状态码非成功");
    } catch (error) {
      state.tags = uniqueTags(state.tags.concat([elements.existingTag.value || "default"]));
      renderTagOptions(preferredTag);
      setStatus("状态：标签加载失败，已使用本地可用标签。", "error");
    }
  }

  async function uploadFiles() {
    if (state.uploading) {
      return;
    }

    var files = elements.files.files;
    if (!files || files.length === 0) {
      setStatus("状态：请先选择至少一个文件。", "error");
      return;
    }

    var ragTag = resolveUploadTag();
    if (!ragTag) {
      setStatus("状态：请先选择或输入知识库标签。", "error");
      return;
    }

    var formData = new FormData();
    formData.append("ragTag", ragTag);
    Array.prototype.forEach.call(files, function (file) {
      formData.append("files", file);
    });

    setUploadingState(true);
    setStatus("状态：文件上传中，请稍候...");

    try {
      var response = await fetch(RAG_UPLOAD_ENDPOINT, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      var payload = await response.json();
      if (payload && payload.code === "0000") {
        setStatus("状态：上传成功，知识库标签为 " + ragTag + "。", "success");
        elements.files.value = "";
        elements.newTag.value = "";
        renderSelectedFiles();
        await loadTagList(ragTag);
        return;
      }

      var message = payload && payload.msg ? payload.msg : "上传失败";
      throw new Error(message);
    } catch (error) {
      setStatus("状态：上传失败，原因：" + error.message, "error");
    } finally {
      setUploadingState(false);
    }
  }

  function bindEvents() {
    elements.files.addEventListener("change", function () {
      renderSelectedFiles();
    });

    elements.uploadBtn.addEventListener("click", function () {
      uploadFiles();
    });
  }

  function init() {
    renderSelectedFiles();
    bindEvents();
    loadTagList("");
  }

  init();
})();
