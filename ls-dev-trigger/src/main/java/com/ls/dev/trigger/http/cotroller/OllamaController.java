package com.ls.dev.trigger.http.cotroller;

import com.ls.dev.api.IAiService;
import com.ls.dev.trigger.http.dto.StreamPrepareRequest;
import com.ls.dev.trigger.http.dto.StreamPrepareResponse;
import com.ls.dev.trigger.http.service.OllamaStreamSessionService;
import jakarta.annotation.Resource;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.ChatResponse;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.chat.prompt.SystemPromptTemplate;
import org.springframework.ai.document.Document;
import org.springframework.ai.ollama.OllamaChatClient;
import org.springframework.ai.ollama.api.OllamaOptions;
import org.springframework.ai.vectorstore.PgVectorStore;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;

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
@RequestMapping("api/v1/ollama/")
public class OllamaController implements IAiService {

    @Resource
    private OllamaChatClient chatClient;

    @Resource
    private PgVectorStore pgVectorStore;

    /**
     * http://localhost:8090/api/v1/ollama/generate?model=deepseek-r1:1.5b&message=1+1
     */
    @RequestMapping(value = "generate", method = RequestMethod.GET)
    @Override
    public ChatResponse generate(@RequestParam String model, @RequestParam String message) {
        return chatClient.call(new Prompt(message, OllamaOptions.create().withModel(model)));
    }

    /**
     * http://localhost:8090/api/v1/ollama/generate_stream?model=deepseek-r1:1.5b&message=hi
     */
    @RequestMapping(value = "generate_stream", method = RequestMethod.GET)
    @Override
    public Flux<ChatResponse> generateStream(@RequestParam String model, @RequestParam String message) {
        return chatClient.stream(new Prompt(message, OllamaOptions.create().withModel(model)));
    }

    @RequestMapping(value = "generate_stream_rag", method = RequestMethod.GET)
    @Override
    public Flux<ChatResponse> generateStreamRag(@RequestParam String model, @RequestParam String ragTag, @RequestParam String message) {
        String SYSTEM_PROMPT = """
                Use the information from the DOCUMENTS section to provide accurate answers but act as if you knew this information innately.
                If unsure, simply state that you don't know.
                Another thing you need to note is that your reply must be in Chinese!
                DOCUMENTS:
                    {documents}
                """;

        // 指定文档搜索
        SearchRequest request = SearchRequest.query(message)
                .withTopK(5)
                .withFilterExpression("knowledge == '" + ragTag + "'");

        List<Document> documents = pgVectorStore.similaritySearch(request);
        String documentCollectors = documents.stream().map(Document::getContent).collect(Collectors.joining());
        Message ragMessage = new SystemPromptTemplate(SYSTEM_PROMPT).createMessage(Map.of("documents", documentCollectors));

        List<Message> messages = new ArrayList<>();
        messages.add(new UserMessage(message));
        messages.add(ragMessage);

        return chatClient.stream(new Prompt(
                messages,
                OllamaOptions.create()
                        .withModel(model)
        ));
    }
}
