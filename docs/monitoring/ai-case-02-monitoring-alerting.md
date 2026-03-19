# ai-case-02 监控与告警说明

## 前端埋点接入点

- 页面脚本统一通过 `reportMetric(...)` 派发 `ai-case-02:metric` 自定义事件，便于宿主页面或监控 SDK 接管。
- 当前已覆盖的关键事件包括：
  - `page_initialized`
  - `chat_send_requested`
  - `chat_stream_opened`
  - `chat_stream_completed`
  - `chat_stream_interrupted`
  - `rag_tag_query_succeeded`
  - `rag_tag_query_failed`
  - `file_upload_started`
  - `file_upload_succeeded`
  - `file_upload_failed`
  - `file_upload_duplicate_blocked`
  - `formal_copy_violation_detected`

## 监控指标与阈值

| 指标 | 建议来源 | 阈值 | 告警级别 | 处理动作 |
| --- | --- | --- | --- | --- |
| `ai_case_02_page_load_success_rate` | 前端埋点 / Web 日志 | `< 99% / 5 分钟` | P2 | 检查静态资源 404、JS 加载失败 |
| `rag_tag_query_failure_rate` | `GET /api/v1/rag/query_rag_tag_list` 接口日志 | `> 10% / 5 分钟` | P2 | 检查接口状态，保持页面失败提示 |
| `file_upload_failure_rate` | `POST /api/v1/rag/file/upload` 接口日志 | `> 15% / 10 分钟` | P1 | 通知值班工程师，冻结发布并评估回滚 |
| `file_upload_p95_latency` | APM / 接口日志 | `> 8s / 10 分钟` | P2 | 排查后端处理性能，必要时提示稍后重试 |
| `chat_stream_start_success_rate_on_ai_case_02` | 前端埋点 + `/api/v1/ollama/*` 日志 | `< 95% / 5 分钟` | P1 | 视为原有能力回归，立即评估回滚 |
| `upload_duplicate_request_rate` | 前端埋点 / 后端重复请求统计 | `> 1% / 10 分钟` | P2 | 检查按钮禁用与状态锁逻辑 |
| `upload_refresh_tag_success_rate` | 前端链路埋点 | `< 95% / 10 分钟` | P2 | 排查上传后自动刷新链路 |
| `js_runtime_error_session_rate` | 前端异常监控 | `> 3% / 10 分钟` | P1 | 若影响主流程则回滚或下线入口 |
| `formal_copy_violation_count` | QA 巡检 / 发布前扫描 | `> 0` | P2 | 阻断发布，修正文案后重新验收 |

## 告警落地建议

- 将 `ai-case-02:metric` 自定义事件接入现有前端监控 SDK，统一补充 `page_id=ai-case-02` 标签。
- 后端接口日志与 APM 统一加上页面来源标识，便于区分 `ai-case-02` 与其他调用方。
- 发布后至少观察 30 分钟，再决定是否放开更广入口或纳入正式导航。
