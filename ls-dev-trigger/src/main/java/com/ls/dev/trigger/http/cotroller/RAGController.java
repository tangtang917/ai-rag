package com.ls.dev.trigger.http.cotroller;

import com.ls.dev.api.IRAGService;
import com.ls.dev.api.response.Response;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.io.FileUtils;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider;
import org.redisson.api.RList;
import org.redisson.api.RedissonClient;
import org.springframework.ai.document.Document;
import org.springframework.ai.ollama.OllamaChatClient;
import org.springframework.ai.reader.tika.TikaDocumentReader;
import org.springframework.ai.transformer.splitter.TokenTextSplitter;
import org.springframework.ai.vectorstore.PgVectorStore;
import org.springframework.ai.vectorstore.SimpleVectorStore;
import org.springframework.core.io.PathResource;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.List;

@Slf4j
@RestController
@CrossOrigin("*")
@RequestMapping("api/v1/rag/")
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

    @PostMapping("analyze_git_repositiry")
    @Override
    public Response<String> analyzeGitRepositiry(@RequestParam String repoUrl, @RequestParam String userName, @RequestParam String token) throws Exception{
        String localPath = "./git_cloned-repo";
        String repoProjectName = extractProjectName(repoUrl);
        log.info("克隆路径：" + new File(localPath).getAbsolutePath());

        FileUtils.deleteDirectory(new File(localPath));

        Git git = Git.cloneRepository()
                .setURI(repoUrl)
                .setDirectory(new File(localPath))
                .setCredentialsProvider(new UsernamePasswordCredentialsProvider(userName, token))
                .call();

        Files.walkFileTree(Paths.get(localPath), new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {

                log.info("文件路径:{}", file.toString());

                try {
                    PathResource resource = new PathResource(file);
                    TikaDocumentReader reader = new TikaDocumentReader(resource);

                    List<Document> documents = reader.get();
                    if (documents == null || documents.isEmpty()) {
                        log.warn("跳过空文档文件: {}", file);
                        return FileVisitResult.CONTINUE;
                    }

                    List<Document> documentSplitterList = tokenTextSplitter.apply(documents);
                    if (documentSplitterList == null || documentSplitterList.isEmpty()) {
                        log.warn("跳过切分后为空的文件: {}", file);
                        return FileVisitResult.CONTINUE;
                    }

//                    documents.forEach(doc -> doc.getMetadata().put("knowledge", "sky-take-out"));
                    documentSplitterList.forEach(doc -> {
                        doc.getMetadata().put("knowledge", repoProjectName);
                    });

                    pgVectorStore.accept(documentSplitterList);
                } catch (Exception e) {
                    log.warn("文件解析失败，已跳过: {}", file, e);
                }

                return FileVisitResult.CONTINUE;
            }
        });

        FileUtils.deleteDirectory(new File(localPath));

        RList<String> elements = redissonClient.getList("ragTag");
        if(!elements.contains(repoProjectName)){
            elements.add(repoProjectName);
        }

        git.close();

        log.info("便利解析路径，上传完成：{}", repoUrl);

        return Response.<String>builder().code("0000").msg("调用成功").build();
    }

    private String extractProjectName(String repoUrl) {
        String[] parts = repoUrl.split("/");
        String projectNameWithGit = parts[parts.length - 1];
        return projectNameWithGit.replace(".git", "");
    }
}
