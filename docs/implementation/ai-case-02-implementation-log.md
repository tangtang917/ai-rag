# 实施与决策日志

## 1. 变更摘要 (Change Summary)
*   **关联计划:** 会话输入《综合执行方案》（2026-03-18）。
*   **完成的任务列表:** `plan_03`, `plan_04`, `plan_06`, `plan_07`, `plan_10`, `plan_11`, `plan_13`, `plan_14`, `plan_17`, `plan_18`, `plan_20`, `plan_21`, `plan_24`, `plan_25`, `plan_27`, `plan_28`
*   **最终变更集:** `507c3e4..HEAD`

## 2. 设计原则遵循报告 (Principles Compliance Report)
*   **KISS:** 采用单页双工作区静态页面，不引入新前端框架；聊天、标签和上传全部由原生 `fetch`、`EventSource`、`FormData` 完成。
*   **DRY:** 将接口路径、默认模型、文案黑名单统一外置到 `runtime-config.js`；聊天状态、标签状态、反馈状态都通过统一的状态设置函数复用。
*   **SOLID:** `app.js` 以内聚函数拆分聊天流、标签同步、文件上传和监控上报；页面只依赖既有 HTTP/SSE 接口抽象，不改动后端实现，保持前后端职责边界清晰。

## 3. 关键决策点记录 (Key Decision Log)
*   **[2026-03-19 09:25:38 +0800] - [plan_03/plan_04]:** 采用左聊天右知识库的双工作区布局，并以独立 `styles.css` 建立企业风格视觉系统，避免在 HTML 内联样式中堆叠复杂度。
*   **[2026-03-19 09:27:14 +0800] - [plan_06/plan_10/plan_14/plan_20]:** 复用 `ai-case-01` 的直连流式与会话流式判定逻辑，同时把标签查询、上传状态锁、失败保态和成功后刷新全部收敛到 `app.js` 的胶水层。
*   **[2026-03-19 09:53:28 +0800] - [plan_24/plan_25]:** 增加 `AiCase02StaticPageTest` 与验收矩阵，并把 `ls-dev-app` 的 `skipTests` 改为可由命令行覆盖，以支持回归测试自动执行。
*   **[2026-03-19 09:53:44 +0800] - [plan_27/plan_28]:** 以独立运行手册沉淀发布、回滚、监控与告警要求，保证上线前后具备可操作的观测与止损路径。

## 4. 依赖复用说明 (Dependency Reuse Statement)
*   **核心依赖:** 浏览器原生 `fetch`、`EventSource`、`FormData`；现有同源接口 `/api/v1/ollama/*` 与 `/api/v1/rag/*`；Spring Boot 静态资源发布能力；Maven Surefire。
*   **胶水代码位置:** `ls-dev-app/src/main/resources/static/ai-case-02/index.html`、`ls-dev-app/src/main/resources/static/ai-case-02/styles.css`、`ls-dev-app/src/main/resources/static/ai-case-02/configs/runtime-config.js`、`ls-dev-app/src/main/resources/static/ai-case-02/app.js`

## 5. 版本控制记录 (Version Control Log)
*   `507c3e4` `feat(ai-case-02): add enterprise workspace shell`
*   `87f61d6` `feat(ai-case-02): add chat and knowledge workflows`
*   `afa7600` `test(ai-case-02): add acceptance regression coverage`
*   `b6d0a3b` `docs(ai-case-02): add rollout and monitoring runbooks`
