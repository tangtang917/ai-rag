<#
  File: docs/dev-ops/nginx/tests/ai-case-03-static-check.ps1
  Purpose: Static acceptance guard for login-first workspace requirements.
  Flow: Read index/config/app assets -> assert required selectors/endpoints exist -> fail fast on regressions.
  Updated: 2026-03-23
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$htmlPath = Join-Path $root "html/index.html"
$appPath = Join-Path $root "html/assets/app.js"
$configPath = Join-Path $root "html/assets/configs/runtime-config.js"

if (-not (Test-Path $htmlPath)) { throw "Missing file: $htmlPath" }
if (-not (Test-Path $appPath)) { throw "Missing file: $appPath" }
if (-not (Test-Path $configPath)) { throw "Missing file: $configPath" }

$html = Get-Content -Path $htmlPath -Raw
$app = Get-Content -Path $appPath -Raw
$config = Get-Content -Path $configPath -Raw

$failures = New-Object System.Collections.Generic.List[string]

function Assert-Contains {
  param(
    [string]$Content,
    [string]$Pattern,
    [string]$Message
  )

  if ($Content -match $Pattern) {
    Write-Host "[PASS] $Message"
  }
  else {
    $failures.Add($Message)
    Write-Host "[FAIL] $Message"
  }
}

function Assert-NotContains {
  param(
    [string]$Content,
    [string]$Pattern,
    [string]$Message
  )

  if ($Content -match $Pattern) {
    $failures.Add($Message)
    Write-Host "[FAIL] $Message"
  }
  else {
    Write-Host "[PASS] $Message"
  }
}

Assert-Contains -Content $html -Pattern 'id="loginView"' -Message "AC-01: 首屏存在登录区域"
Assert-Contains -Content $html -Pattern 'id="workspaceView" class="workspace-shell hidden"' -Message "AC-01: 初始隐藏业务工作台"
Assert-Contains -Content $html -Pattern 'id="loginForm"' -Message "AC-03: 登录表单存在"
Assert-Contains -Content $html -Pattern 'assets/configs/runtime-config.js' -Message "配置外化脚本已接入"
Assert-Contains -Content $html -Pattern 'href="\./rag-upload.html"' -Message "AC-08: 保留知识库上传入口"
Assert-Contains -Content $html -Pattern 'href="\./code-upload.html"' -Message "AC-08: 保留代码库上传入口"

Assert-Contains -Content $app -Pattern 'function requireLogin\(' -Message "AC-02: 存在统一登录门禁函数"
Assert-Contains -Content $app -Pattern 'requireLogin\("发送消息"\)' -Message "AC-02: 发送消息受登录门禁保护"
Assert-Contains -Content $app -Pattern 'query_rag_tag_list' -Message "AC-07: 初始化标签接口已配置"
Assert-Contains -Content $app -Pattern '/api/v1/ollama/generate_stream_rag' -Message "AC-04: Ollama 仅走 generate_stream_rag"
Assert-Contains -Content $app -Pattern '/api/v1/openai/generate_stream_rag' -Message "AC-04: OpenAI 仅走 generate_stream_rag"
Assert-Contains -Content $app -Pattern 'function applyStreamChunks\(' -Message "AC-05: 流式分片增量渲染逻辑存在"
Assert-Contains -Content $app -Pattern 'function isStopChunk\(' -Message "AC-05: 流式结束标记处理逻辑存在"
Assert-Contains -Content $app -Pattern 'ensureSessionState\(' -Message "AC-06: 本地会话恢复逻辑存在"

Assert-NotContains -Content $app -Pattern '/api/v1/ollama/generate"' -Message "AC-04: 未使用 /ollama/generate"
Assert-NotContains -Content $app -Pattern '/api/v1/openai/generate"' -Message "AC-04: 未使用 /openai/generate"
Assert-NotContains -Content $app -Pattern '/api/v1/ollama/generate_stream"' -Message "AC-04: 未使用 /ollama/generate_stream"
Assert-NotContains -Content $app -Pattern '/api/v1/openai/generate_stream"' -Message "AC-04: 未使用 /openai/generate_stream"

Assert-Contains -Content $config -Pattern 'loginSessionTtlMs' -Message "登录会话 TTL 配置已外化"

if ($failures.Count -gt 0) {
  Write-Host ""
  Write-Host "Static checks failed:" -ForegroundColor Red
  $failures | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}

Write-Host ""
Write-Host "All static checks passed." -ForegroundColor Green
exit 0
