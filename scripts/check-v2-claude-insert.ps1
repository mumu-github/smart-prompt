param(
  [string]$ProfileDir = ".runtime/v2-live-chrome-profile",
  [int]$LoginWaitSeconds = 180
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $ScriptDir "check-v2-live-sites.ps1") `
  -ProfileDir $ProfileDir `
  -SiteIds claude `
  -LoginWaitSeconds $LoginWaitSeconds
