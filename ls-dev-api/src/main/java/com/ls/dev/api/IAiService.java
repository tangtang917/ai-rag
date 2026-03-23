package com.ls.dev.api;

import org.springframework.ai.chat.ChatResponse;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import reactor.core.publisher.Flux;

public interface IAiService {

    // 非流式
    ChatResponse generate(String model, String message);

    // 流式
    Flux<ChatResponse> generateStream(String model, String message);

    // 基于知识库增强会话
    Flux<ChatResponse> generateStreamRag(String model, String ragTag, String message);
}
