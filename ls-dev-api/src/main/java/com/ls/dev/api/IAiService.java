package com.ls.dev.api;

import org.springframework.ai.chat.ChatResponse;
import reactor.core.publisher.Flux;

public interface IAiService {

    // 非流式
    ChatResponse generate(String model, String message);

    // 流式
    Flux<ChatResponse> generateStream(String model, String message);
}
