# ai-case-03 验收与测试矩阵

## AC 覆盖映射

| 验收标准 | 测试用例 ID | 测试类型 | 覆盖方式 | 当前落地 |
| --- | --- | --- | --- | --- |
| AC-01 访问 `index.html` 首屏展示登录区 | TC-LOGIN-001 | E2E | 静态检查 + 手工冒烟 | `index.html` 首屏默认显示 `#loginView`，工作台容器 `#workspaceView` 初始隐藏 |
| AC-02 未登录尝试使用业务能力需先登录 | TC-LOGIN-002 | E2E | 手工回归 | `app.js` 在发送消息/会话操作/上传入口前统一执行 `requireLogin` 门禁 |
| AC-03 登录成功后进入对话工作台 | TC-LOGIN-003 | E2E | 手工回归 | 登录提交成功后切换视图，展示会话管理、模型与知识库、对话区 |
| AC-04 发送消息仅调用 `generate_stream_rag` | TC-API-004 | 集成 | 静态检查 | 端点配置仅保留 `/api/v1/ollama/generate_stream_rag` 与 `/api/v1/openai/generate_stream_rag` |
| AC-05 流式分片增量渲染并在结束标记后停止 | TC-STREAM-005 | 集成 | 手工回归 | `parseSseData` + `applyStreamChunks` + `isStopChunk` 实现增量渲染与停流 |
| AC-06 刷新后恢复会话列表/当前会话/历史消息 | TC-SESSION-006 | E2E | 手工回归 | `ensureSessionState` + `localStorage` 恢复，支持刷新继续 |
| AC-07 初始化请求 `query_rag_tag_list` 更新知识库下拉 | TC-RAG-007 | 集成 | 静态检查 + 手工回归 | 页面初始化执行 `loadKnowledgeTags`，成功更新下拉，失败保底标签 |
| AC-08 选择上传入口可跳转上传页 | TC-NAV-008 | E2E | 静态检查 + 手工回归 | `index.html` 保留 `rag-upload.html` 与 `code-upload.html` 跳转链接 |

## 自动化校验执行方式

```powershell
pwsh docs/dev-ops/nginx/tests/ai-case-03-static-check.ps1
```

## 手工回归清单入口

- `docs/dev-ops/nginx/tests/ai-case-03-manual-e2e-checklist.md`
