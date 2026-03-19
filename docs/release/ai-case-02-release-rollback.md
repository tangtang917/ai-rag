# ai-case-02 发布与回滚清单

## 发布范围

- 静态资源目录：`ls-dev-app/src/main/resources/static/ai-case-02/`
- 受影响能力：企业知识协同工作台、Ollama 流式对话入口、RAG 标签查询与资料上传入口
- 不受影响能力：现有 `ai-case-01` 页面、后端接口协议、RAG 存储逻辑

## 发布前检查

- 确认 `ai-case-02/index.html`、`styles.css`、`app.js`、`configs/runtime-config.js` 已打包进应用静态资源。
- 确认发布版本对应 commit 已包含 `AiCase02StaticPageTest`、验收矩阵、监控与回滚文档。
- 确认联调环境中 `/api/v1/ollama/*`、`/api/v1/rag/query_rag_tag_list`、`/api/v1/rag/file/upload` 可访问。
- 确认页面未暴露删除标签、编辑标签、文件管理或知识检索问答入口。

## 发布执行

1. 构建应用产物并完成静态资源发布。
2. 发布后访问 `/ai-case-02/index.html` 进行冒烟。
3. 核验标签初始化、文件选择、上传成功/失败提示、聊天流式输出四条主链路。
4. 观察监控指标 10 至 30 分钟，确认无异常波动。

## 回滚触发条件

- `POST /api/v1/rag/file/upload` 失败率超过 15%，持续 10 分钟。
- `chat_stream_start_success_rate_on_ai_case_02` 低于 95%，持续 5 分钟。
- 浏览器运行时错误会话占比超过 3%，持续 10 分钟。
- 页面暴露非目标能力入口或出现敏感数据本地持久化等合规问题。
- P1 用户反馈经值班工程师复核后可稳定复现。

## 回滚步骤

1. 在 `#frontend-release` 与 `#engineering` 宣告启动 `ai-case-02` 回滚。
2. 若导航入口可独立控制，先下线入口，阻断新增访问。
3. 优先执行静态资源回滚作业：`rollback-static-assets --target=<PREVIOUS_STABLE_TAG>`。
4. 若无自动作业，执行 `git revert <release_commit_sha> --no-edit`，随后执行 `mvn -pl ls-dev-app -am clean package` 并重新部署上一稳定版本。
5. 验证 `ai-case-01`、`ai-case-02`、`/api/v1/rag/query_rag_tag_list`、`/api/v1/ollama/*` 均恢复稳定。

## 回滚后闭环

- 在 `#frontend-release`、`#product`、`#qa` 发布回滚完成通知。
- 记录触发时间、故障症状、回滚版本、恢复时间与后续修复责任人。
