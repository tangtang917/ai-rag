/*
  File: assets/configs/runtime-config.js
  Purpose: Runtime configuration for login-gated workspace behavior.
  Flow: Provide mutable endpoints/models/storage keys -> consumed by page scripts as the single config source.
  Updated: 2026-03-23 (local direct-connect mode, rag upload and repo analyze endpoints enabled)
*/
(function (global) {
  var apiBaseUrl = "http://111.229.28.45:8090";

  var config = {
    storageKeys: {
      sessions: "ai_workspace_sessions_v2",
      activeSession: "ai_workspace_active_session_v2",
      authState: "ai_workspace_auth_state_v1"
    },
    endpoints: {
      ragTags: apiBaseUrl + "/api/v1/rag/query_rag_tag_list",
      ragUpload: apiBaseUrl + "/api/v1/rag/file/upload",
      ragAnalyzeGitRepository: apiBaseUrl + "/api/v1/rag/analyze_git_repositiry",
      streams: {
        ollama: apiBaseUrl + "/api/v1/ollama/generate_stream_rag",
        openai: apiBaseUrl + "/api/v1/openai/generate_stream_rag"
      }
    },
    channelModels: {
      ollama: ["deepseek-r1:1.5b", "qwen2.5:7b", "llama3.1:8b"],
      openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"]
    },
    defaults: {
      tags: ["default", "project-docs", "product-kb"],
      persistDelayMs: 150,
      loginSessionTtlMs: 28800000
    }
  };

  global.AI_WORKSPACE_CONFIG = config;
})(window);
