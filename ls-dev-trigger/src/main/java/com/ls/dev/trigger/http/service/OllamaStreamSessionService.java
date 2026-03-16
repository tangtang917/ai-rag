package com.ls.dev.trigger.http.service;

import com.ls.dev.trigger.http.dto.StreamPrepareRequest;
import com.ls.dev.trigger.http.dto.StreamPrepareResponse;
import org.apache.commons.lang3.StringUtils;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 用于管理“长文本流式会话”的临时存储服务。
 *
 * 设计原因：
 * 浏览器 EventSource 只能通过 GET 建立连接，而长文本如果继续放在 GET 查询参数里，
 * 很可能超出浏览器、网关、代理或服务端对 URL 长度的限制。
 *
 * 因此这里采用两段式流程：
 * 1. 前端先 POST /stream_prepare，把 model 和 message 交给后端
 * 2. 后端生成一个短的 sessionId，并把原始请求暂存在内存里
 * 3. 前端再用 sessionId 发起 GET /generate_stream_by_session
 * 4. 服务端根据 sessionId 取出原始请求，再开始真正的流式推送
 *
 * 当前实现是内存版，适合 demo 和本地调试。
 * 如果后续要做成多实例部署，建议把 sessionStore 换成 Redis。
 */
@Service
public class OllamaStreamSessionService {

    /**
     * sessionId 的默认有效期。
     *
     * 这里设置成 5 分钟，避免：
     * 1. 临时会话长期占用内存
     * 2. 旧的 sessionId 被重复使用
     */
    private static final Duration SESSION_TTL = Duration.ofMinutes(5);

    /**
     * 用于保存 sessionId -> 原始请求内容 的临时内存容器。
     *
     * key   : sessionId
     * value : 用户原始请求（模型、消息内容、过期时间）
     */
    private final Map<String, PreparedStreamSession> sessionStore = new ConcurrentHashMap<>();

    /**
     * 为长文本请求创建一个临时会话。
     *
     * 调用时机：
     * 当前端判断 message 太长，不适合继续走 GET 查询参数时，
     * 会先请求 POST /stream_prepare，最终进入这里。
     *
     * 返回值中只暴露 sessionId 和过期时间，
     * 真正的模型名和消息内容仍然保存在服务端。
     */
    public StreamPrepareResponse prepareSession(String model, String message) {
        // 每次创建新会话前，顺手清理一遍已过期的旧数据，避免内存不断累积。
        cleanupExpiredSessions();

        // 使用无短横线的 UUID，作为前端后续建立 EventSource 时使用的短键。
        String sessionId = UUID.randomUUID().toString().replace("-", "");
        Instant expiresAt = Instant.now().plus(SESSION_TTL);
        sessionStore.put(sessionId, new PreparedStreamSession(model, message, expiresAt));

        return new StreamPrepareResponse(sessionId, expiresAt.toEpochMilli());
    }

    /**
     * 消费一个 sessionId，并取回当时预提交的 model/message。
     *
     * 这里的“consume”是一次性的：
     * - 取出成功后，会立刻从 sessionStore 删除
     * - 这样可以避免同一个 sessionId 被重复消费
     *
     * 如果 sessionId 为空、找不到或已过期，会直接抛出 HTTP 异常。
     */
    public StreamPrepareRequest consumeSession(String sessionId) {
        cleanupExpiredSessions();

        // 统一做 trim + null 归一化，防止前端传入空格字符串。
        String normalizedSessionId = StringUtils.trimToNull(sessionId);
        if (normalizedSessionId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "sessionId is required");
        }

        // remove 而不是 get，目的是让 sessionId 成为“一次性令牌”。
        PreparedStreamSession prepared = sessionStore.remove(normalizedSessionId);
        if (prepared == null || prepared.isExpired()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "stream session was not found or has expired");
        }

        return new StreamPrepareRequest(prepared.model(), prepared.message());
    }

    /**
     * 清理所有已经过期的临时会话。
     *
     * 这里没有单独起定时任务，而是采用“访问时顺手清理”的懒清理方式，
     * 代码更简单，demo 场景也足够用。
     */
    private void cleanupExpiredSessions() {
        Instant now = Instant.now();
        sessionStore.entrySet().removeIf(entry -> entry.getValue().expiresAt().isBefore(now));
    }

    /**
     * 服务端内部使用的临时对象，不直接暴露给前端。
     *
     * 它保存一次预提交请求真正需要的全部信息：
     * - model
     * - message
     * - expiresAt
     */
    private record PreparedStreamSession(String model, String message, Instant expiresAt) {

        /**
         * 判断当前临时会话是否过期。
         */
        private boolean isExpired() {
            return expiresAt.isBefore(Instant.now());
        }
    }
}
