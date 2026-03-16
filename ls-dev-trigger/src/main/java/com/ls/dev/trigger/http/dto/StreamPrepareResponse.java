package com.ls.dev.trigger.http.dto;

/**
 * 长文本“预提交”接口的返回值。
 *
 * 返回给前端一个短的 sessionId，后续前端再通过：
 * GET /api/v1/ollama/generate_stream_by_session?sessionId=xxx
 * 来建立 EventSource 连接。
 *
 * 字段说明：
 * sessionId          - 后端生成的临时会话键，用来换取真正的流式输出
 * expiresAtEpochMilli - 该会话键的过期时间，前端可用于提示或调试
 */
public record StreamPrepareResponse(String sessionId, long expiresAtEpochMilli) {
}
