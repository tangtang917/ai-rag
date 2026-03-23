# ai-case-03 发布与回滚手册

## 1. 目的与适用范围
- 目的：为 `index.html` 登录首页 + 工作台闭环变更提供可执行发布与回滚 SOP。
- 范围：`docs/dev-ops/nginx/html` 下静态站点资源（`index.html`、`assets/*`、上传入口页面）。

## 2. 发布前检查
1. 执行静态验收脚本：
   ```powershell
   powershell -ExecutionPolicy Bypass -File docs/dev-ops/nginx/tests/ai-case-03-static-check.ps1
   ```
2. 确认后端接口健康：
   - `/api/v1/rag/query_rag_tag_list`
   - `/api/v1/ollama/generate_stream_rag`
   - `/api/v1/openai/generate_stream_rag`
3. 预备回滚目标版本（上一个稳定版 ReleaseId）。

## 3. 发布步骤（标准）

### 3.1 Windows 运维脚本发布
```powershell
powershell -ExecutionPolicy Bypass -File docs/dev-ops/nginx/scripts/publish-static-release.ps1 \
  -SourceDir "docs/dev-ops/nginx/html" \
  -DeployRoot "C:\\nginx\\html" \
  -ReleasesRoot "C:\\nginx\\releases" \
  -ReleaseId "20260323-rc1"
```

### 3.2 Linux 手动发布（可选）
```bash
APP_HOME=/srv/ai-rag-nginx
RELEASE_ID=20260323-rc1
mkdir -p $APP_HOME/releases/$RELEASE_ID
rsync -a --delete ./docs/dev-ops/nginx/html/ $APP_HOME/releases/$RELEASE_ID/
rsync -a --delete $APP_HOME/releases/$RELEASE_ID/ /usr/share/nginx/html/
nginx -t && nginx -s reload
echo $RELEASE_ID > $APP_HOME/releases/LAST_STABLE
```

## 4. 回滚触发条件
满足任一条件立即启动回滚：
1. `generate_stream_rag` 5xx 错误率 > 5%（连续 5 分钟）。
2. 登录成功率 < 95%（连续 10 分钟）。
3. 首页可用率 < 99%（连续 5 分钟）。
4. P1 故障判定为用户主链路阻断。

## 5. 回滚步骤（SOP）
1. 值班工程师在 `#engineering`、`#ops-alerts` 宣告启动回滚。
2. 暂停新版本发布流水线。
3. 执行回滚命令：

### 5.1 Windows 运维脚本回滚
```powershell
powershell -ExecutionPolicy Bypass -File docs/dev-ops/nginx/scripts/rollback-static-release.ps1 \
  -DeployRoot "C:\\nginx\\html" \
  -ReleasesRoot "C:\\nginx\\releases" \
  -TargetRelease "20260320-stable"
```

### 5.2 Linux 手动回滚（可选）
```bash
APP_HOME=/srv/ai-rag-nginx
TARGET_RELEASE=$(cat $APP_HOME/releases/LAST_STABLE)
rsync -a --delete $APP_HOME/releases/$TARGET_RELEASE/ /usr/share/nginx/html/
nginx -t && nginx -s reload
```

4. 验证回滚：
   - `curl -f http://<host>/index.html` 返回 200。
   - 登录流程、RAG 流式对话、上传入口跳转冒烟通过。
   - 关键告警指标 10 分钟内恢复阈值内。

5. 关闭回滚流程：
   - 更新事故工单状态。
   - 30 分钟内发布简报；24 小时内输出 RCA。
