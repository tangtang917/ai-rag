package com.ls.dev.api;

import com.ls.dev.api.response.Response;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

public interface IRAGService {

    Response<List<String>> queryRagTagList();

    Response<String> uploadFile(String ragTag, List<MultipartFile> files);

    Response<String> analyzeGitRepositiry(String repoUrl, String userName, String token) throws Exception;
}
