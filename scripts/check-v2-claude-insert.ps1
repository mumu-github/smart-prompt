param(
  [string]$Report = "research/v2-claude-insert.latest.json",
  [string]$ProfileDir = ".runtime/v2-live-chrome-profile",
  [int]$LoginWaitSeconds = 180,
  [int]$CdpPort = 9232,
  [switch]$AttachCdp
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $ScriptDir "check-v2-live-sites.ps1") `
  -Report $Report `
  -ProfileDir $ProfileDir `
  -SiteIds claude `
  -LoginWaitSeconds $LoginWaitSeconds `
  -CdpPort $CdpPort `
  -AttachCdp:$AttachCdp
