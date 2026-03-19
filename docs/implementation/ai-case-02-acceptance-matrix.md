# ai-case-02 验收与审查矩阵

## AC 覆盖映射

| 验收标准 | 覆盖方式 | 当前落地 |
| --- | --- | --- |
| AC-01 页面双区与企业风格 | 静态资源实现 + 文案审查 | `ai-case-02/index.html` 与 `styles.css` 已提供双工作区和正式业务文案 |
| AC-02 初始化自动拉取标签 | 代码实现 + 静态测试 | `app.js` 初始化执行 `fetchTagList({ source: "initial-load" })` |
| AC-03 标签刷新与失败提示 | 代码实现 + 手工集成验证 | `fetchTagList` 在成功/失败两条分支分别更新标签状态与提示，不影响聊天和上传区 |
| AC-04 已有标签/新标签双模式 | 代码实现 + 静态测试 | `setTagMode` 与 `resolveRagTag` 保证最终只形成一个有效 `ragTag` |
| AC-05 多文件预览 | 代码实现 + 静态测试 | `renderSelectedFiles` 展示全部已选文件名和体积 |
| AC-06 上传中锁定与防重复提交 | 代码实现 + 静态测试 | `setUploadBusyState` 与 `file_upload_duplicate_blocked` 指标保证单次上传 |
| AC-07 上传成功后刷新标签 | 代码实现 + 静态测试 | 上传成功后执行 `fetchTagList({ source: "post-upload" })` |
| AC-08 上传失败后保留状态可重试 | 代码实现 + 静态测试 | 失败分支仅提示错误，不清空标签、文件或输入状态 |
| AC-09 原有流式聊天不回归 | 代码实现 | 复用 `generate_stream` / `stream_prepare` / `generate_stream_by_session` 双链路 |
| AC-10 不暴露非目标能力入口 | 结构审查 | 页面仅保留标签查询、标签录入、文件上传入口，并以说明文案明确边界 |
| AC-11 正式业务化文案 | 静态测试 + 文案审查 | 禁用 `Demo`、`测试环境`、`样例提示词` 等词汇 |

## 已执行验证

- 新增 `AiCase02StaticPageTest`，对页面双区结构、正式文案、接口配置、本地持久化禁用和上传守卫做静态回归校验。
- 代码级自检已确认 `EventSource`、`FormData`、标签自动刷新和失败保态逻辑全部接入。

## 待结合运行环境完成的集成验证

- 使用真实或联调环境验证 `/api/v1/ollama/*` 流式返回是否与现有 `ai-case-01` 一致。
- 使用真实或联调环境验证 `/api/v1/rag/query_rag_tag_list` 与 `/api/v1/rag/file/upload` 的成功/失败链路。
- 浏览器侧人工检查桌面端与移动端响应式表现，以及正式业务化文案的一致性。
