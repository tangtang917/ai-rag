/*
  File: ai-case-02/configs/runtime-config.js
  Purpose: Centralize variable runtime settings for the ai-case-02 static page.
  Flow: Expose immutable endpoints, default values, and copy guard settings on window for app.js consumption.
  Created: 2026-03-18
*/
window.AI_CASE_02_RUNTIME_CONFIG = Object.freeze({
  pageId: "ai-case-02",
  pageTitle: "企业知识协同工作台",
  defaultModel: "deepseek-r1:1.5b",
  endpoints: Object.freeze({
    directStreamPath: "/api/v1/ollama/generate_stream",
    preparePath: "/api/v1/ollama/stream_prepare",
    sessionStreamPath: "/api/v1/ollama/generate_stream_by_session",
    ragTagListPath: "/api/v1/rag/query_rag_tag_list",
    fileUploadPath: "/api/v1/rag/file/upload"
  }),
  stream: Object.freeze({
    maxDirectUrlLength: 1600
  }),
  feedback: Object.freeze({
    successCode: "0000"
  }),
  monitoring: Object.freeze({
    consolePrefix: "[ai-case-02]"
  }),
  formalCopyBlockedTerms: Object.freeze([
    "Demo",
    "demo",
    "测试环境",
    "样例提示词"
  ])
});
