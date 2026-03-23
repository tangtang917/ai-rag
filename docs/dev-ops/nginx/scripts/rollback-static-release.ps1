<#
  File: docs/dev-ops/nginx/scripts/rollback-static-release.ps1
  Purpose: Roll back nginx html deployment to a previous stable release.
  Flow: Resolve target release -> mirror release directory to deploy root -> confirm rollback marker.
  Updated: 2026-03-23
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DeployRoot,

  [Parameter(Mandatory = $true)]
  [string]$ReleasesRoot,

  [Parameter(Mandatory = $true)]
  [string]$TargetRelease
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path $DeployRoot)) {
  throw "DeployRoot not found: $DeployRoot"
}

if (-not (Test-Path $ReleasesRoot)) {
  throw "ReleasesRoot not found: $ReleasesRoot"
}

$targetPath = Join-Path $ReleasesRoot $TargetRelease
if (-not (Test-Path $targetPath)) {
  throw "Target release not found: $targetPath"
}

Write-Host "[1/3] Rollback mirror from $targetPath to $DeployRoot"
robocopy $targetPath $DeployRoot /MIR /NFL /NDL /NJH /NJS /NP | Out-Null

$rollbackMarker = Join-Path $ReleasesRoot "LAST_ROLLBACK"
Write-Host "[2/3] Write rollback marker"
Set-Content -Path $rollbackMarker -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $TargetRelease) -Encoding UTF8

Write-Host "[3/3] Completed"
Write-Host "Rolled back to release: $TargetRelease"
