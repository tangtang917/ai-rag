package com.ls.dev.test;

import com.ls.dev.app.Application;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.io.FileUtils;
import org.eclipse.jgit.api.CloneCommand;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.springframework.ai.document.Document;
import org.springframework.ai.ollama.OllamaChatClient;
import org.springframework.ai.reader.tika.TikaDocumentReader;
import org.springframework.ai.transformer.splitter.TokenTextSplitter;
import org.springframework.ai.vectorstore.PgVectorStore;
import org.springframework.ai.vectorstore.SimpleVectorStore;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.PathResource;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.junit4.SpringRunner;

import java.io.File;
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.List;

@Slf4j
@RunWith(SpringRunner.class)
@ActiveProfiles("dev")
@SpringBootTest(classes = Application.class, webEnvironment = SpringBootTest.WebEnvironment.NONE)
public class JGitTest {

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
    public void test() throws Exception {

        // 这部分替换为你的
        String repoURL = "https://github.com/tangtang917/sky-take-out.git";

        String localPath = "./cloned-repo";
        log.info("克隆路径：" + new File(localPath).getAbsolutePath());

        FileUtils.deleteDirectory(new File(localPath));

        Git git = Git.cloneRepository()
                .setURI(repoURL)
                .setDirectory(new File(localPath))
//                .setCredentialsProvider(new UsernamePasswordCredentialsProvider(username, password))
                .call();

        git.close();
    }

    @Test
    public void test_file() throws IOException {
        Files.walkFileTree(Paths.get("./cloned-repo"), new SimpleFileVisitor<>() {
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
                        doc.getMetadata().put("knowledge", "sky-take-out");
                    });

                    pgVectorStore.accept(documentSplitterList);
                } catch (Exception e) {
                    log.warn("文件解析失败，已跳过: {}", file, e);
                }

                return FileVisitResult.CONTINUE;
            }
        });
    }
}
