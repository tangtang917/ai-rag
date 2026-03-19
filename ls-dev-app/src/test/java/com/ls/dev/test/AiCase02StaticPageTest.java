/*
  File: AiCase02StaticPageTest.java
  Purpose: Guard the ai-case-02 static assets against copy regressions, missing endpoints, and forbidden local persistence.
  Flow: Read packaged static files from the classpath -> assert required workspace structure -> assert upload/chat safeguards remain in place.
  Created: 2026-03-19
*/
package com.ls.dev.test;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class AiCase02StaticPageTest {

    @Test
    public void shouldRenderDualWorkspaceWithFormalCopy() throws IOException {
        String html = readResource("static/ai-case-02/index.html");

        assertTrue(html.contains("企业知识协同工作台"));
        assertTrue(html.contains("AI 对话工作区"));
        assertTrue(html.contains("知识库管理工作区"));
        assertTrue(html.contains("当前页面仅提供标签查询、标签录入和文件上传"));

        assertFalse(html.contains("Demo"));
        assertFalse(html.contains("demo"));
        assertFalse(html.contains("测试环境"));
        assertFalse(html.contains("样例提示词"));
    }

    @Test
    public void shouldKeepConfiguredChatAndUploadEndpoints() throws IOException {
        String runtimeConfig = readResource("static/ai-case-02/configs/runtime-config.js");

        assertTrue(runtimeConfig.contains("/api/v1/ollama/generate_stream"));
        assertTrue(runtimeConfig.contains("/api/v1/ollama/stream_prepare"));
        assertTrue(runtimeConfig.contains("/api/v1/ollama/generate_stream_by_session"));
        assertTrue(runtimeConfig.contains("/api/v1/rag/query_rag_tag_list"));
        assertTrue(runtimeConfig.contains("/api/v1/rag/file/upload"));
    }

    @Test
    public void shouldKeepStreamingAndUploadSafetyGuards() throws IOException {
        String appJs = readResource("static/ai-case-02/app.js");

        assertTrue(appJs.contains("new EventSource"));
        assertTrue(appJs.contains("new FormData"));
        assertTrue(appJs.contains("file_upload_duplicate_blocked"));
        assertTrue(appJs.contains("已保留当前标签、文件和输入状态，可直接重试"));
        assertTrue(appJs.contains("source: \"post-upload\""));

        assertFalse(appJs.contains("localStorage"));
        assertFalse(appJs.contains("sessionStorage"));
        assertFalse(appJs.contains("indexedDB"));
        assertFalse(appJs.contains("document.cookie"));
    }

    private String readResource(String path) throws IOException {
        ClassLoader classLoader = Thread.currentThread().getContextClassLoader();
        InputStream inputStream = classLoader.getResourceAsStream(path);
        if (inputStream == null) {
            throw new IOException("Missing resource: " + path);
        }

        try (InputStream stream = inputStream) {
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
