package com.ls.dev.trigger.http.cotroller;

import com.ls.dev.api.IRAGService;
import com.ls.dev.api.response.Response;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.redisson.api.RList;
import org.redisson.api.RedissonClient;
import org.springframework.ai.document.Document;
import org.springframework.ai.ollama.OllamaChatClient;
import org.springframework.ai.reader.tika.TikaDocumentReader;
import org.springframework.ai.transformer.splitter.TokenTextSplitter;
import org.springframework.ai.vectorstore.PgVectorStore;
import org.springframework.ai.vectorstore.SimpleVectorStore;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@Slf4j
@RestController
@CrossOrigin("*")
@RequestMapping("api/v1/rag")
public class RAGController implements IRAGService {

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

    @Resource
    private RedissonClient redissonClient;

    @GetMapping("query_rag_tag_list")
    @Override
    public Response<List<String>> queryRagTagList() {
        RList<String> elements = redissonClient.getList("ragTag");
        return Response.<List<String>>builder()
                .code("0000")
                .msg("调用成功")
                .data(elements)
                .build();
    }

    @PostMapping(value = "file/upload", headers = "content-type=multipart/form-data")
    @Override
    public Response<String> uploadFile(@RequestParam String ragTag, @RequestParam List<MultipartFile> files) {
        log.info("上传知识库开始:{}",ragTag);
        for (MultipartFile file : files){
            TikaDocumentReader tikaDocumentReader = new TikaDocumentReader(file.getResource());
            List<Document> documents = tikaDocumentReader.get();
            List<Document> documentList = tokenTextSplitter.apply(documents);

            documentList.forEach(doc -> doc.getMetadata().put("knowledge", ragTag));

            pgVectorStore.accept(documentList);

            RList<String> elements = redissonClient.getList("ragTag");
            if(!elements.contains(ragTag)){
                elements.add(ragTag);
            }
        }
        log.info("上传知识库完成:{}",ragTag);
        return Response.<String>builder().code("0000").msg("调用成功").build();
    }
}
