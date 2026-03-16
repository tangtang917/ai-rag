package com.ls.dev.api;

import org.springframework.ai.chat.ChatResponse;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

public interface IAiService {

    // 非流式
    ChatResponse generate(String model, String message);

    // 流式
    SseEmitter generateStream(String model, String message);
}
