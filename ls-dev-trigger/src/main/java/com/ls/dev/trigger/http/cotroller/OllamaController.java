package com.ls.dev.trigger.http.cotroller;

import com.ls.dev.api.IAiService;
import com.ls.dev.trigger.http.dto.StreamPrepareRequest;
import com.ls.dev.trigger.http.dto.StreamPrepareResponse;
import com.ls.dev.trigger.http.service.OllamaStreamSessionService;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.ChatResponse;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.ollama.OllamaChatClient;
import org.springframework.ai.ollama.api.OllamaOptions;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import reactor.core.Disposable;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicReference;

import static org.springframework.http.HttpStatus.BAD_REQUEST;

/**
 * 对外暴露 AI 能力的主控制器。
 *
 * 当前提供了三类接口：
 * 1. 普通同步问答：/generate
 * 2. 短文本直接流式问答：/generate_stream
 * 3. 长文本两段式流式问答：
 *    - 先 /stream_prepare
 *    - 再 /generate_stream_by_session
 *
 * 为什么这里要自己用 SseEmitter 包一层，而不是直接把 Flux 返回给前端：
 * - 前端明确使用 EventSource
 * - EventSource 最适合消费标准的 text/event-stream
 * - 通过 SseEmitter 可以更明确地控制事件发送、异常处理和连接关闭时机
 */
@RestController
@CrossOrigin("*")
@RequestMapping("api/v1/ollama")
public class OllamaController implements IAiService {

    /**
     * 记录流式过程中的异常，方便排查断流、客户端关闭连接等问题。
     */
    private static final Logger log = LoggerFactory.getLogger(OllamaController.class);

    /**
     * Spring AI 提供的 Ollama 客户端。
     *
     * 它负责真正调用底层大模型：
     * - call(...)   : 一次性返回完整结果
     * - stream(...) : 按片段持续返回结果
     */
    private final OllamaChatClient chatClient;

    /**
     * 长文本场景下，用来管理 sessionId 和原始请求内容的服务。
     */
    private final OllamaStreamSessionService streamSessionService;

    /**
     * 使用构造注入而不是字段注入，便于测试，也让依赖关系更清晰。
     */
    public OllamaController(OllamaChatClient chatClient, OllamaStreamSessionService streamSessionService) {
        this.chatClient = chatClient;
        this.streamSessionService = streamSessionService;
    }

    /**
     * 普通非流式接口。
     *
     * 调用方式：
     * GET /api/v1/ollama/generate?model=xxx&message=xxx
     *
     * 特点：
     * - 服务端会等模型完整生成结束后，再一次性把结果返回给前端
     * - 适合简单调试，不适合“边生成边展示”的对话场景
     */
    @GetMapping("generate")
    @Override
    public ChatResponse generate(@RequestParam("model") String model, @RequestParam("message") String message) {
        return chatClient.call(buildPrompt(model, message));
    }

    /**
     * 短文本直接流式接口。
     *
     * 调用方式：
     * GET /api/v1/ollama/generate_stream?model=xxx&message=xxx
     *
     * 这里显式声明 produces = text/event-stream，
     * 让浏览器 EventSource 能按标准 SSE 协议消费流式数据。
     */
    @GetMapping(value = "generate_stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @Override
    public SseEmitter generateStream(@RequestParam("model") String model, @RequestParam("message") String message) {
        return createEmitter(model, message);
    }

    /**
     * 长文本流式的第一步：先预提交消息，换取 sessionId。
     *
     * 前端场景：
     * 当 message 太长时，不再直接拼到 GET URL 上，
     * 而是先 POST 到这里，把完整请求保存到服务端。
     */
    @PostMapping(value = "stream_prepare", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<StreamPrepareResponse> prepareStream(@RequestBody StreamPrepareRequest request) {
        validateRequest(request.model(), request.message());
        StreamPrepareResponse response = streamSessionService.prepareSession(normalizeModel(request.model()), request.message());
        return ResponseEntity.ok(response);
    }

    /**
     * 长文本流式的第二步：前端携带 sessionId 建立 SSE 连接。
     *
     * 服务端会根据 sessionId 找回之前预提交的 model/message，
     * 然后把真正的流式输出过程交给 createEmitter(...)。
     */
    @GetMapping(value = "generate_stream_by_session", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter generateStreamBySession(@RequestParam("sessionId") String sessionId) {
        StreamPrepareRequest preparedRequest = streamSessionService.consumeSession(sessionId);
        return createEmitter(preparedRequest.model(), preparedRequest.message());
    }

    /**
     * 创建一个真正负责向浏览器推送 SSE 的发射器。
     *
     * 这是整个流式逻辑的核心方法，职责包括：
     * 1. 把 model/message 组装为 Spring AI 的 Prompt
     * 2. 订阅 chatClient.stream(...) 返回的流
     * 3. 每来一个片段，就通过 emitter.send(...) 推给前端
     * 4. 在完成、异常、超时、客户端断开时，释放订阅资源
     */
    private SseEmitter createEmitter(String model, String message) {
        Prompt prompt = buildPrompt(model, message);

        /**
         * timeout = 0L 表示不主动设置超时时间，交由容器或网络层决定。
         * 对长回答更友好，避免服务端过早断流。
         */
        SseEmitter emitter = new SseEmitter(0L);

        /**
         * 因为 Reactor 的 Disposable 要在多个回调里共用，
         * 这里用 AtomicReference 保存，便于在 onCompletion/onError/onTimeout 中安全释放。
         */
        AtomicReference<Disposable> subscriptionRef = new AtomicReference<>();

        /**
         * 订阅大模型流式输出：
         * - onNext     -> 收到一个增量分片
         * - onError    -> 生成过程中发生异常
         * - onComplete -> 模型正常结束
         */
        Disposable subscription = chatClient.stream(prompt).subscribe(
                response -> sendEvent(emitter, subscriptionRef, response),
                error -> completeWithError(emitter, subscriptionRef, error),
                () -> completeEmitter(emitter, subscriptionRef)
        );
        subscriptionRef.set(subscription);

        // 浏览器端正常关闭连接时，回收底层订阅，避免资源泄漏。
        emitter.onCompletion(() -> disposeSubscription(subscriptionRef));

        // 如果发生超时，也要主动释放订阅并结束连接。
        emitter.onTimeout(() -> {
            disposeSubscription(subscriptionRef);
            emitter.complete();
        });

        // 容器层面捕获到错误时，同样需要回收底层订阅。
        emitter.onError(error -> disposeSubscription(subscriptionRef));

        return emitter;
    }

    /**
     * 把一个 ChatResponse 分片发送给前端。
     *
     * 前端 EventSource 收到的数据会落在 event.data 中，
     * 页面再从 result.output.content 提取文本做增量渲染。
     */
    private void sendEvent(SseEmitter emitter, AtomicReference<Disposable> subscriptionRef, ChatResponse response) {
        try {
            emitter.send(SseEmitter.event().name("message").data(response, MediaType.APPLICATION_JSON));
        } catch (IOException exception) {
            // 常见场景是浏览器主动关闭了连接，此时继续发送会抛异常。
            completeWithError(emitter, subscriptionRef, exception);
        }
    }

    /**
     * 流式过程中出现异常时的统一收口。
     *
     * 这里会先释放订阅，再记录日志，最后把错误状态通知给 SSE 连接。
     */
    private void completeWithError(SseEmitter emitter, AtomicReference<Disposable> subscriptionRef, Throwable error) {
        disposeSubscription(subscriptionRef);
        log.warn("stream output failed", error);
        emitter.completeWithError(error);
    }

    /**
     * 流式正常结束时的统一收口。
     */
    private void completeEmitter(SseEmitter emitter, AtomicReference<Disposable> subscriptionRef) {
        disposeSubscription(subscriptionRef);
        emitter.complete();
    }

    /**
     * 安全释放 Reactor 订阅对象。
     *
     * 之所以单独抽方法，是因为：
     * - 正常完成时会调用
     * - 异常时会调用
     * - 超时时会调用
     * - 前端断开连接时也会调用
     *
     * 这样可以保证订阅只被释放一次。
     */
    private void disposeSubscription(AtomicReference<Disposable> subscriptionRef) {
        Disposable subscription = subscriptionRef.getAndSet(null);
        if (subscription != null && !subscription.isDisposed()) {
            subscription.dispose();
        }
    }

    /**
     * 组装发送给 Spring AI 的 Prompt。
     *
     * 这里统一做参数校验和 model 规范化，
     * 避免各个接口各写一套重复逻辑。
     */
    private Prompt buildPrompt(String model, String message) {
        validateRequest(model, message);
        return new Prompt(message, OllamaOptions.create().withModel(normalizeModel(model)));
    }

    /**
     * 统一校验请求参数。
     *
     * 当前只做最基础的非空校验：
     * - model 不能为空
     * - message 不能为空
     *
     * 如果后续要扩展，例如限制 message 长度、限制模型白名单，也适合继续放在这里。
     */
    private void validateRequest(String model, String message) {
        if (StringUtils.isBlank(model)) {
            throw new ResponseStatusException(BAD_REQUEST, "model is required");
        }
        if (StringUtils.isBlank(message)) {
            throw new ResponseStatusException(BAD_REQUEST, "message is required");
        }
    }

    /**
     * 对模型名做最简单的规范化处理。
     *
     * 目前只做 trim，避免前端输入前后空格导致模型匹配失败。
     */
    private String normalizeModel(String model) {
        return StringUtils.trim(model);
    }
}
