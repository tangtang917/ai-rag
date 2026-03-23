# 实施与决策日志

## 1. 变更摘要 (Change Summary)
* **关联计划:** 第二环节《综合执行方案》（会话：2026-03-23，登录首页 + 智能知识工作台闭环）
* **完成的任务列表:** `plan_03`, `plan_04`, `plan_06`, `plan_07`, `plan_08`, `plan_11`, `plan_12`, `plan_14`, `plan_15`, `plan_17`, `plan_18`, `plan_21`, `plan_22`, `plan_24`, `plan_25`, `plan_26`
* **最终变更集:** `edfdb29`, `4194a8e`, `c947693`

## 2. 设计原则遵循报告 (Principles Compliance Report)
* **KISS:** 采用 `index.html` 单页双态（登录态/工作台态）而非新增复杂路由或前端框架，登录成功仅切换容器可见性与门禁状态。
* **DRY:** 抽离 `runtime-config.js` 作为统一配置源，端点、模型、存储键与 TTL 不再散落在业务脚本；统一 `requireLogin`、`applyStatus` 复用门禁与提示逻辑。
* **SOLID:** `app.js` 按职责拆分为认证状态管理、会话管理、流式处理、知识库同步、事件绑定五组函数；通过 `resolveStreamEndpoint` 与配置注入实现对扩展开放、对调用端细节封闭。

## 3. 关键决策点记录 (Key Decision Log)
* **[2026-03-23 10:04:12 +0800] - [plan_03/plan_04]:** 将 `index.html` 改为“登录首屏 + 工作台容器”双态结构，优先满足 AC-01 与 AC-03，同时保持原有视觉体系不重做。
* **[2026-03-23 10:06:39 +0800] - [plan_06/plan_07/plan_08]:** 登录态仅保存 `account/loginAt/expiresAt` 于 `sessionStorage`，不持久化密码，兼顾轻量门禁与敏感信息最小化存储。
* **[2026-03-23 10:08:21 +0800] - [plan_14/plan_15]:** 强制流式端点限定在 `generate_stream_rag`，并以 `parseSseData + applyStreamChunks + isStopChunk` 统一处理分片增量渲染和结束停流。
* **[2026-03-23 10:11:07 +0800] - [plan_21/plan_22]:** 增加 `ai-case-03-static-check.ps1` 作为自动化静态验收守卫，辅以手工 E2E 清单覆盖动态链路与刷新恢复场景。
* **[2026-03-23 10:13:45 +0800] - [plan_24/plan_25/plan_26]:** 通过发布/回滚脚本与监控文档固化上线止损路径，确保故障触发后可在标准 SOP 内快速回退。

## 4. 依赖复用说明 (Dependency Reuse Statement)
* **核心依赖:** 浏览器原生 `fetch`、`EventSource`、`URLSearchParams`、`localStorage/sessionStorage`；现有后端接口 `/api/v1/*/generate_stream_rag` 与 `/api/v1/rag/query_rag_tag_list`；既有 Nginx 静态资源目录体系。
* **胶水代码位置:**
  * `docs/dev-ops/nginx/html/assets/app.js`
  * `docs/dev-ops/nginx/html/assets/configs/runtime-config.js`
  * `docs/dev-ops/nginx/html/index.html`
  * `docs/dev-ops/nginx/tests/ai-case-03-static-check.ps1`
  * `docs/dev-ops/nginx/scripts/publish-static-release.ps1`
  * `docs/dev-ops/nginx/scripts/rollback-static-release.ps1`

## 5. 版本控制记录 (Version Control Log)
* `c947693` `docs(ai-case-03): add release rollback SOP and monitoring plan`
* `4194a8e` `test(ai-case-03): add acceptance matrix and static guard checks`
* `edfdb29` `feat(nginx-ui): add login-first entry and lightweight auth gate`
