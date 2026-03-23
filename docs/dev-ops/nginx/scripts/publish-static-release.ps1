<#
  File: docs/dev-ops/nginx/scripts/publish-static-release.ps1
  Purpose: Publish a versioned static release for the nginx html site.
  Flow: Validate source -> snapshot as release -> mirror to deploy root -> record release history.
  Updated: 2026-03-23
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDir,

  [Parameter(Mandatory = $true)]
  [string]$DeployRoot,

  [Parameter(Mandatory = $true)]
  [string]$ReleasesRoot,

  [Parameter(Mandatory = $false)]
  [string]$ReleaseId = (Get-Date -Format "yyyyMMdd-HHmmss")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path $SourceDir)) {
  throw "SourceDir not found: $SourceDir"
}

if (-not (Test-Path $DeployRoot)) {
  throw "DeployRoot not found: $DeployRoot"
}

New-Item -ItemType Directory -Path $ReleasesRoot -Force | Out-Null
$releasePath = Join-Path $ReleasesRoot $ReleaseId

if (Test-Path $releasePath) {
  throw "Release already exists: $releasePath"
}

Write-Host "[1/4] Snapshot release -> $releasePath"
New-Item -ItemType Directory -Path $releasePath -Force | Out-Null
robocopy $SourceDir $releasePath /MIR /NFL /NDL /NJH /NJS /NP | Out-Null

Write-Host "[2/4] Mirror release to deploy root -> $DeployRoot"
robocopy $releasePath $DeployRoot /MIR /NFL /NDL /NJH /NJS /NP | Out-Null

$lastStableFile = Join-Path $ReleasesRoot "LAST_STABLE"
$historyFile = Join-Path $ReleasesRoot "RELEASE_HISTORY.log"

Write-Host "[3/4] Update release pointers"
Set-Content -Path $lastStableFile -Value $ReleaseId -Encoding UTF8
Add-Content -Path $historyFile -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $ReleaseId) -Encoding UTF8

Write-Host "[4/4] Completed"
Write-Host "Published release: $ReleaseId"
