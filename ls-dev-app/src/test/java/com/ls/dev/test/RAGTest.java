package com.ls.dev.test;

import com.alibaba.fastjson.JSON;
import com.ls.dev.app.Application;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.springframework.ai.chat.ChatResponse;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.chat.prompt.SystemPromptTemplate;
import org.springframework.ai.document.Document;
import org.springframework.ai.ollama.OllamaChatClient;
import org.springframework.ai.ollama.api.OllamaOptions;
import org.springframework.ai.reader.tika.TikaDocumentReader;
import org.springframework.ai.transformer.splitter.TokenTextSplitter;
import org.springframework.ai.vectorstore.PgVectorStore;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.SimpleVectorStore;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.core.io.ClassPathResource;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.junit4.SpringRunner;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Slf4j
@RunWith(SpringRunner.class)
@ActiveProfiles("dev")
@SpringBootTest(classes = Application.class, webEnvironment = WebEnvironment.NONE)
public class RAGTest {

    private static final String KNOWLEDGE_NAME = "\u77e5\u8bc6\u5e93\u540d\u79f0";

    // 负责调用聊天模型，最终根据检索到的知识生成回答。
    @Resource
    private OllamaChatClient ollamaChatClient;

    // 负责把长文本切成多个小片段，便于后续做向量化和相似度检索。
    @Resource
    private TokenTextSplitter tokenTextSplitter;

    // 内存版向量存储，本测试里没有真正使用，当前主要用的是 PgVectorStore。
    @Resource
    private SimpleVectorStore simpleVectorStore;

    // PostgreSQL 向量存储，负责把文本片段和对应向量持久化到数据库。
    @Resource
    private PgVectorStore pgVectorStore;

    @Test
    public void upload() {
        // 1. 读取测试文件。Tika 可以统一解析 txt、pdf、docx 等多种格式。
        TikaDocumentReader reader = new TikaDocumentReader(new ClassPathResource("data/file.text"));

        // 2. 先拿到原始文档，再把长文本拆成多个小片段。
        List<Document> documents = reader.get();
        List<Document> documentList = tokenTextSplitter.apply(documents);

        // 3. 给文档打上知识库标签，后续检索时可以按知识库名称过滤。
        documents.forEach(doc -> doc.getMetadata().put("knowledge", KNOWLEDGE_NAME));
        documentList.forEach(doc -> doc.getMetadata().put("knowledge", KNOWLEDGE_NAME));

        // 4. 把切片后的文档写入 PGVector。
        //    这一步会把文本转成向量，再把文本、标签和向量一起保存到 PostgreSQL。
        pgVectorStore.accept(documentList);

        log.info("\u4e0a\u4f20\u5b8c\u6210");
    }

    @Test
    public void chat() {
        // 用户问题。RAG 的关键不是直接问模型，而是先去知识库里找相关资料。
        String message = "\u738b\u5927\u9524\u54ea\u4e00\u5e74\u51fa\u751f\u7684";

        // 系统提示词模板：把检索到的资料填充到 {documents}，再交给模型参考作答。
        String systemPrompt = """
                Use the information from the DOCUMENTS section to provide accurate answers but act as if you knew this information innately.
                If unsure, simply state that you don't know.
                Another thing you need to note is that your reply must be in Chinese!
                DOCUMENTS:
                    {documents}
                """;

        // 1. 只在目标知识库中检索，并返回最相关的前 5 段内容。
        SearchRequest request = SearchRequest.query(message)
                .withTopK(5)
                .withFilterExpression("knowledge == '" + KNOWLEDGE_NAME + "'");

        // 2. 从向量库中取回和问题最相似的文档片段。
        List<Document> documents = pgVectorStore.similaritySearch(request);

        // 3. 把多段检索结果拼成一个字符串，准备塞进提示词模板。
        String documentsContent = documents.stream()
                .map(Document::getContent)
                .collect(Collectors.joining());

        // 4. 生成一条系统消息，把检索到的知识作为模型的参考资料。
        Message ragMessage = new SystemPromptTemplate(systemPrompt)
                .createMessage(Map.of("documents", documentsContent));

        // 5. 把“用户问题”和“知识库资料”一起组装成最终发给模型的消息。
        ArrayList<Message> messages = new ArrayList<>();
        messages.add(new UserMessage(message));
        messages.add(ragMessage);

        // 6. 调用聊天模型，让模型基于检索到的资料生成最终答案。
        ChatResponse chatResponse = ollamaChatClient.call(
                new Prompt(messages, OllamaOptions.create().withModel("deepseek-r1:1.5b"))
        );

        log.info("\u6d4b\u8bd5\u7ed3\u679c:{}", JSON.toJSONString(chatResponse));
    }
}
