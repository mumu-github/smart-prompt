param(
  [string]$Report = "",
  [switch]$JsonOnly,
  [switch]$SelfTest,
  [switch]$ConfirmForeground,
  [switch]$AllowClipboardFallback,
  [switch]$AllowTextPatternVerification,
  [string]$ExpectedTitleHash = "",
  [string]$ExpectedToolProfile = "",
  [int]$CandidateIndex = 0,
  [string]$Text = "Smart Prompt M3 desktop fill self-test"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
. (Join-Path $ScriptDir "desktop-tool-profile-config.ps1")

if (-not $Report) {
  $Report = Join-Path $Root "research/m3-desktop-fill.latest.json"
} elseif (-not [System.IO.Path]::IsPathRooted($Report)) {
  $Report = Join-Path $Root $Report
}

function Get-HashText {
  param([string]$Value)
  if (-not $Value) { return "" }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    $hash = $sha.ComputeHash($bytes)
    return ([System.BitConverter]::ToString($hash) -replace "-", "").Substring(0, 16).ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function New-Privacy {
  return [pscustomobject]@{
    titleRedacted = $true
    elementNamesHashed = $true
    elementValuesNotReadBeforeWrite = $true
    writtenTextNotStored = $true
    clipboardTextNotStored = $true
    fallbackRequiresExplicitAllow = $true
    textPatternVerificationRequiresExplicitAllow = $true
    valuePatternVerificationRequiresExplicitAllow = $true
    nearbyTextVerificationRequiresExplicitAllow = $true
    verificationTextNotStored = $true
    verificationUsesLengthAndHash = $true
    caretTextNotRead = $true
    promptTextNotRead = $true
    autoSubmit = $false
  }
}

function New-UnsupportedReport {
  param([string]$Reason)
  return [pscustomobject]@{
    schemaVersion = "m3-windows-fill@1"
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    platform = if ($env:OS -like "*Windows*") { "win32" } else { $PSVersionTable.Platform }
    selfTest = [bool]$SelfTest
    confirmForeground = [bool]$ConfirmForeground
    allowClipboardFallback = [bool]$AllowClipboardFallback
    allowTextPatternVerification = [bool]$AllowTextPatternVerification
    pass = $false
    reason = $Reason
    writeAttempted = $false
    verified = $false
    clipboardFallbackTried = $false
    clipboardRestored = $false
    textPatternVerificationTried = $false
    textPatternVerificationMatched = $false
    valuePatternVerificationTried = $false
    valuePatternVerificationMatched = $false
    nearbyTextVerificationTried = $false
    nearbyTextVerificationMatched = $false
    supportedToolProfiles = @("codex", "claude-code", "hermes", "workbuddy", "trae")
    privacy = New-Privacy
  }
}

function Test-ShouldUseRelatedToolProfile {
  param([string]$ProcessName, [string]$WindowTitle)
  $process = ([string]$ProcessName).Trim()
  if ($process -match "(?i)^(explorer|lockapp|shellexperiencehost|searchhost|startmenuexperiencehost|applicationframehost|textinputhost|dwm|runtimebroker|widgets|systemsettings|taskmgr)$") {
    return $false
  }
  $haystack = "$ProcessName $WindowTitle"
  return [bool]($haystack -match "(?i)terminal|windows terminal|powershell|cmd|pwsh|code|cursor|electron|local|node|python|claude|codex|hermes|work[\s-]*buddy|workbuddy|trae")
}

function Test-RelatedToolProcessHintPresent {
  param([string]$ProcessName, [string]$WindowTitle, [string[]]$RelatedProcessNames = @())
  if (-not (Test-ShouldUseRelatedToolProfile -ProcessName $ProcessName -WindowTitle $WindowTitle)) {
    return $false
  }
  return [bool](($RelatedProcessNames -join " ") -match "(?i)\bcodex\b|\bclaude\b|\bhermes\b|\bwork[\s-]*buddy\b|\bworkbuddy\b|\btrae\b")
}

function Test-PreferredWritableInputCandidate {
  param([object]$Candidate)
  if (-not $Candidate -or -not [bool]$Candidate.isEnabled) { return $false }
  $controlType = [string]$Candidate.controlType
  $signals = $Candidate.inputSignals
  if ($controlType -match "Button|Hyperlink|Text") { return $false }
  if ([bool]$signals.visualFallback -and [bool]$signals.profileComposerCandidate) { return $true }
  if ([bool]$signals.broadDocument) { return $false }
  if ($controlType -match "Edit") { return $true }
  if ([bool]$signals.hasKeyboardFocus -or [bool]$signals.focusedElementMatch -or [bool]$signals.caretWithinBounds -or [bool]$signals.caretWindowMatch) { return $true }
  if ([bool]$Candidate.hasValuePattern -and $controlType -notmatch "Document") { return $true }
  if ([bool]$Candidate.hasTextPattern -and $controlType -eq "ControlType.Document") { return $true }
  return $false
}

function Test-VisualWebViewAnchorCandidate {
  param([object]$Candidate, [string]$ToolProfile)
  if ($ToolProfile -notin @("codex", "workbuddy", "trae")) { return $false }
  if (-not $Candidate -or -not $Candidate.boundingRect -or -not [bool]$Candidate.isEnabled) { return $false }
  $rect = $Candidate.boundingRect
  $signals = $Candidate.inputSignals
  $width = [int]$rect.width
  $height = [int]$rect.height
  $x = [int]$rect.x
  $y = [int]$rect.y
  $controlType = [string]$Candidate.controlType
  if ($width -lt 280 -or $height -lt 36 -or $height -gt 180) { return $false }
  if ($x -lt -4 -or $y -lt -4) { return $false }
  if ([bool]$signals.broadDocument) { return $false }
  if ($controlType -match "Document|Hyperlink|Text|Image|List") { return $false }
  if ($controlType -match "Button") {
    return [bool]($signals.nearWindowBottom -and $width -ge 240 -and $height -le 96)
  }
  if ($controlType -notmatch "Group|Pane|Custom") { return $false }
  return [bool]($signals.nearWindowBottom -or $signals.semanticComposerHint -or $signals.profileComposerCandidate)
}

function Get-VisualWebViewAnchorPriority {
  param([object]$Candidate)
  if (-not $Candidate) { return 0 }
  $signals = $Candidate.inputSignals
  $controlType = [string]$Candidate.controlType
  $strongSignal = [bool](
    $signals.semanticComposerHint -or
    $signals.profileComposerCandidate -or
    $signals.caretWithinBounds -or
    $signals.caretWindowMatch -or
    $signals.focusedElementMatch -or
    $signals.hasKeyboardFocus -or
    $signals.cursorWithinBounds
  )
  $containerLike = [bool]($controlType -match "Group|Pane|Custom")
  $buttonLike = [bool]($controlType -match "Button")
  return ([int]$strongSignal * 16) +
    ([int]$containerLike * 8) +
    ([int](-not $buttonLike) * 4) +
    ([int][bool]$signals.nearWindowBottom * 2) +
    ([int]([bool]$Candidate.hasValuePattern -or [bool]$Candidate.hasTextPattern))
}

function Get-VisualWebViewAnchorCandidate {
  param([object[]]$Candidates, [string]$ToolProfile)
  $anchors = @($Candidates | Where-Object { Test-VisualWebViewAnchorCandidate -Candidate $_ -ToolProfile $ToolProfile })
  return @($anchors | Sort-Object `
    @{ Expression = { Get-VisualWebViewAnchorPriority -Candidate $_ }; Descending = $true }, `
    @{ Expression = { [int]$_.boundingRect.width }; Descending = $true }, `
    @{ Expression = { [int]$_.boundingRect.y }; Descending = $true } |
    Select-Object -First 1)
}

function Get-ToolProfile {
  param(
    [string]$ProcessName,
    [string]$WindowTitle,
    [string[]]$ChildProcessNames = @(),
    [string]$ExecutablePath = ""
  )
  if (Test-SmartPromptTrustedExecutableProfile -ToolProfile "codex" -ExecutablePath $ExecutablePath) { return "codex" }
  $directHaystack = "$ProcessName $WindowTitle"
  if ($directHaystack -match "(?i)claude[\s-]*code") { return "claude-code" }
  if ($directHaystack -match "(?i)\bclaude\b") { return "claude-code" }
  if ($directHaystack -match "(?i)\bcodex\b|openai[\s-]*codex") { return "codex" }
  if ($directHaystack -match "(?i)\bhermes\b") { return "hermes" }
  if ($directHaystack -match "(?i)\bwork[\s-]*buddy\b|\bworkbuddy\b") { return "workbuddy" }
  if ($directHaystack -match "(?i)\btrae\b") { return "trae" }
  if (-not (Test-ShouldUseRelatedToolProfile -ProcessName $ProcessName -WindowTitle $WindowTitle)) { return "unknown" }
  $relatedHaystack = (($ChildProcessNames | ForEach-Object { [string]$_ }) -join " ")
  if ($relatedHaystack -match "(?i)claude[\s-]*code") { return "claude-code" }
  if ($relatedHaystack -match "(?i)\bclaude\b") { return "claude-code" }
  if ($relatedHaystack -match "(?i)\bcodex\b|openai[\s-]*codex") { return "codex" }
  if ($relatedHaystack -match "(?i)\bhermes\b") { return "hermes" }
  if ($relatedHaystack -match "(?i)\bwork[\s-]*buddy\b|\bworkbuddy\b") { return "workbuddy" }
  if ($relatedHaystack -match "(?i)\btrae\b") { return "trae" }
  return "unknown"
}

function Get-ChildProcessNames {
  param([int]$ProcessId)
  $names = @()
  try {
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue)
    foreach ($child in $children) {
      if ($child.Name) {
        $names += [System.IO.Path]::GetFileNameWithoutExtension([string]$child.Name)
      }
      $names += Get-ChildProcessNames -ProcessId ([int]$child.ProcessId)
    }
  } catch {
    # Best-effort process lineage only; inaccessible CIM rows should not fail fill probing.
  }
  return @($names | Where-Object { $_ } | Select-Object -Unique)
}

function Get-AncestorProcessNames {
  param([int]$ProcessId)
  $names = @()
  $seen = @{}
  $currentId = $ProcessId
  for ($depth = 0; $depth -lt 8 -and $currentId -gt 0 -and -not $seen.ContainsKey($currentId); $depth += 1) {
    $seen[$currentId] = $true
    try {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$currentId" -ErrorAction SilentlyContinue
      if (-not $process) { break }
      if ($process.Name) {
        $names += [System.IO.Path]::GetFileNameWithoutExtension([string]$process.Name)
      }
      $currentId = [int]$process.ParentProcessId
    } catch {
      break
    }
  }
  return @($names | Where-Object { $_ } | Select-Object -Unique)
}

function Ensure-FillTypes {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  if (-not ([System.Management.Automation.PSTypeName]"SmartPromptFillNative").Type) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public struct SmartPromptFillRect {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}
public struct SmartPromptFillPoint {
  public int X;
  public int Y;
}
public struct SmartPromptFillGuiThreadInfo {
  public int cbSize;
  public int flags;
  public IntPtr hwndActive;
  public IntPtr hwndFocus;
  public IntPtr hwndCapture;
  public IntPtr hwndMenuOwner;
  public IntPtr hwndMoveSize;
  public IntPtr hwndCaret;
  public SmartPromptFillRect rcCaret;
}
public static class SmartPromptFillNative {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out SmartPromptFillPoint lpPoint);
  [DllImport("user32.dll")]
  public static extern IntPtr WindowFromPoint(SmartPromptFillPoint point);
  [DllImport("user32.dll")]
  public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool SetWindowText(IntPtr hWnd, string lpString);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out SmartPromptFillRect lpRect);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")]
  public static extern bool GetGUIThreadInfo(uint idThread, ref SmartPromptFillGuiThreadInfo pgui);
  [DllImport("user32.dll")]
  public static extern bool ClientToScreen(IntPtr hWnd, ref SmartPromptFillPoint lpPoint);
}
"@
  }
}

function Restore-FillWindow {
  param([IntPtr]$Handle)
  try {
    return [bool][SmartPromptFillNative]::ShowWindowAsync($Handle, 9)
  } catch {
    return $false
  }
}

function Get-WindowTextSafe {
  param([IntPtr]$Handle)
  $builder = New-Object System.Text.StringBuilder 512
  [void][SmartPromptFillNative]::GetWindowText($Handle, $builder, $builder.Capacity)
  return $builder.ToString()
}

function Get-RuntimeIdKey {
  param([System.Windows.Automation.AutomationElement]$Element)
  if (-not $Element) { return "" }
  try {
    return (($Element.GetRuntimeId() | ForEach-Object { [string]$_ }) -join ".")
  } catch {
    return ""
  }
}

function New-RectObject {
  param([object]$X, [object]$Y, [object]$Width, [object]$Height)
  function ConvertTo-SafeInt {
    param([object]$Value)
    try {
      $number = [double]$Value
      if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { return 0 }
      if ($number -gt [int]::MaxValue) { return [int]::MaxValue }
      if ($number -lt [int]::MinValue) { return [int]::MinValue }
      return [int]$number
    } catch {
      return 0
    }
  }
  return [pscustomobject]@{
    x = ConvertTo-SafeInt $X
    y = ConvertTo-SafeInt $Y
    width = ConvertTo-SafeInt $Width
    height = ConvertTo-SafeInt $Height
  }
}

function Test-RectIntersects {
  param([object]$A, [object]$B)
  if (-not $A -or -not $B) { return $false }
  if ([int]$A.width -le 0 -or [int]$A.height -le 0 -or [int]$B.width -le 0 -or [int]$B.height -le 0) { return $false }
  $aRight = [int]$A.x + [int]$A.width
  $aBottom = [int]$A.y + [int]$A.height
  $bRight = [int]$B.x + [int]$B.width
  $bBottom = [int]$B.y + [int]$B.height
  return [bool](([int]$A.x -lt $bRight) -and ($aRight -gt [int]$B.x) -and ([int]$A.y -lt $bBottom) -and ($aBottom -gt [int]$B.y))
}

function Test-FillWindowCloaked {
  param([IntPtr]$Handle)
  try {
    $cloaked = 0
    $result = [SmartPromptFillNative]::DwmGetWindowAttribute($Handle, 14, [ref]$cloaked, 4)
    return [bool]($result -eq 0 -and $cloaked -ne 0)
  } catch {
    return $false
  }
}

function Get-FillWindowVisibilityContext {
  param([IntPtr]$Handle)
  $emptyRect = New-RectObject -X 0 -Y 0 -Width 0 -Height 0
  $result = [ordered]@{
    isVisible = $false
    isMinimized = $false
    isCloaked = $false
    isUsable = $false
    boundingRect = $emptyRect
  }
  if ($Handle -eq [IntPtr]::Zero) { return [pscustomobject]$result }
  try {
    $rect = New-Object SmartPromptFillRect
    $hasRect = [SmartPromptFillNative]::GetWindowRect($Handle, [ref]$rect)
    $width = if ($hasRect) { [int]$rect.Right - [int]$rect.Left } else { 0 }
    $height = if ($hasRect) { [int]$rect.Bottom - [int]$rect.Top } else { 0 }
    $isVisible = [SmartPromptFillNative]::IsWindowVisible($Handle)
    $isMinimized = [SmartPromptFillNative]::IsIconic($Handle)
    $isCloaked = Test-FillWindowCloaked -Handle $Handle
    $result.isVisible = [bool]$isVisible
    $result.isMinimized = [bool]$isMinimized
    $result.isCloaked = [bool]$isCloaked
    $result.boundingRect = if ($hasRect) {
      New-RectObject -X $rect.Left -Y $rect.Top -Width $width -Height $height
    } else {
      $emptyRect
    }
    $result.isUsable = [bool]($isVisible -and -not $isMinimized -and -not $isCloaked -and $width -gt 0 -and $height -gt 0)
  } catch {
    $result.isVisible = $false
    $result.isUsable = $false
  }
  return [pscustomobject]$result
}

function Get-CursorContext {
  $result = [ordered]@{
    source = "win32_get_cursor_pos"
    supported = $false
    windowHandlePresent = $false
    rootWindowHandlePresent = $false
    rect = (New-RectObject -X 0 -Y 0 -Width 0 -Height 0)
  }
  try {
    $point = New-Object SmartPromptFillPoint
    $ok = [SmartPromptFillNative]::GetCursorPos([ref]$point)
    $result.supported = [bool]$ok
    if (-not $ok) { return [pscustomobject]$result }
    $result.rect = New-RectObject -X $point.X -Y $point.Y -Width 1 -Height 1
    $cursorWindow = [SmartPromptFillNative]::WindowFromPoint($point)
    $result.windowHandlePresent = [bool]($cursorWindow -ne [IntPtr]::Zero)
    $rootWindow = if ($cursorWindow -ne [IntPtr]::Zero) { [SmartPromptFillNative]::GetAncestor($cursorWindow, 2) } else { [IntPtr]::Zero }
    $result.rootWindowHandlePresent = [bool]($rootWindow -ne [IntPtr]::Zero)
  } catch {
    $result.supported = $false
  }
  return [pscustomobject]$result
}

function Get-CaretContext {
  $result = [ordered]@{
    source = "win32_get_gui_thread_info"
    supported = $false
    visible = $false
    windowHandlePresent = $false
    rect = (New-RectObject -X 0 -Y 0 -Width 0 -Height 0)
    virtualCaretMayBeHidden = $true
  }
  try {
    $info = New-Object SmartPromptFillGuiThreadInfo
    $info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][SmartPromptFillGuiThreadInfo])
    $ok = [SmartPromptFillNative]::GetGUIThreadInfo(0, [ref]$info)
    $result.supported = [bool]$ok
    if (-not $ok) { return [pscustomobject]$result }
    $hwndCaret = [IntPtr]$info.hwndCaret
    $result.windowHandlePresent = [bool]($hwndCaret -ne [IntPtr]::Zero)
    $result.visible = [bool](($info.flags -band 1) -ne 0 -or $result.windowHandlePresent)
    if ($hwndCaret -ne [IntPtr]::Zero) {
      $topLeft = New-Object SmartPromptFillPoint
      $bottomRight = New-Object SmartPromptFillPoint
      $topLeft.X = [int]$info.rcCaret.Left
      $topLeft.Y = [int]$info.rcCaret.Top
      $bottomRight.X = [int]$info.rcCaret.Right
      $bottomRight.Y = [int]$info.rcCaret.Bottom
      [void][SmartPromptFillNative]::ClientToScreen($hwndCaret, [ref]$topLeft)
      [void][SmartPromptFillNative]::ClientToScreen($hwndCaret, [ref]$bottomRight)
      $result.rect = New-RectObject -X $topLeft.X -Y $topLeft.Y -Width ([Math]::Max(1, $bottomRight.X - $topLeft.X)) -Height ([Math]::Max(1, $bottomRight.Y - $topLeft.Y))
    }
  } catch {
    $result.supported = $false
  }
  return [pscustomobject]$result
}

function Get-InputSignals {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [object]$Rect,
    [object]$RootRect,
    [string]$FocusedRuntimeId,
    [object]$Caret,
    [object]$Cursor,
    [string]$ControlType,
    [string]$ClassName,
    [bool]$HasValuePattern,
    [bool]$HasTextPattern,
    [IntPtr]$NativeWindowHandle
  )
  $runtimeId = Get-RuntimeIdKey $Element
  $hasKeyboardFocus = $false
  try { $hasKeyboardFocus = [bool]$Element.Current.HasKeyboardFocus } catch { $hasKeyboardFocus = $false }
  $focusedElementMatch = [bool]($runtimeId -and $FocusedRuntimeId -and $runtimeId -eq $FocusedRuntimeId)
  $caretWithinBounds = [bool]($Caret -and $Caret.rect -and (Test-RectIntersects -A $Rect -B $Caret.rect))
  $caretWindowMatch = [bool]($Caret -and $Caret.windowHandlePresent -and $NativeWindowHandle -ne [IntPtr]::Zero -and $caretWithinBounds)
  $cursorWithinBounds = [bool]($Cursor -and $Cursor.rect -and (Test-RectIntersects -A $Rect -B $Cursor.rect))
  $nearWindowBottom = $false
  if ($RootRect -and [int]$RootRect.height -gt 0) {
    $rootBottom = [int]$RootRect.y + [int]$RootRect.height
    $candidateBottom = [int]$Rect.y + [int]$Rect.height
    $nearWindowBottom = [bool]($candidateBottom -ge ($rootBottom - 360))
  }
  $broadDocument = [bool]($ControlType -eq "ControlType.Document" -and ([int]$Rect.width -gt 900 -or [int]$Rect.height -gt 500))
  $score = 0
  if ($ControlType -eq "ControlType.Edit") { $score += 45 }
  if ($HasValuePattern) { $score += 35 }
  if ($hasKeyboardFocus) { $score += 35 }
  if ($focusedElementMatch) { $score += 35 }
  if ($caretWithinBounds) { $score += 45 }
  if ($caretWindowMatch) { $score += 20 }
  if ($cursorWithinBounds) { $score += 20 }
  if ($Element.Current.IsKeyboardFocusable) { $score += 15 }
  if ($HasTextPattern) { $score += 10 }
  if ($ClassName -match "(?i)edit|text") { $score += 10 }
  if ($nearWindowBottom) { $score += 5 }
  if ($broadDocument) { $score -= 40 }
  return [pscustomobject]@{
    score = [int]$score
    hasKeyboardFocus = [bool]$hasKeyboardFocus
    focusedElementMatch = [bool]$focusedElementMatch
    caretWithinBounds = [bool]$caretWithinBounds
    caretWindowMatch = [bool]$caretWindowMatch
    cursorWithinBounds = [bool]$cursorWithinBounds
    nearWindowBottom = [bool]$nearWindowBottom
    broadDocument = [bool]$broadDocument
    semanticComposerHint = $false
  }
}

function Test-ToolProfileComposerSemanticHint {
  param([string]$ToolProfile, [object[]]$Elements, [object]$Rect)
  if ($ToolProfile -notin @("workbuddy", "trae")) { return $false }
  if (-not $Elements -or -not $Rect) { return $false }

  $patterns = @()
  $workBuddyPrompt = -join @([char]0x4eca, [char]0x5929, [char]0x5e2e, [char]0x4f60, [char]0x505a, [char]0x4e9b, [char]0x4ec0, [char]0x4e48)
  $workBuddyReference = -join @([char]0x5f15, [char]0x7528, [char]0x5bf9, [char]0x8bdd, [char]0x6587, [char]0x4ef6)
  $workBuddySkills = -join @([char]0x8c03, [char]0x7528, [char]0x6280, [char]0x80fd, [char]0x4e0e, [char]0x6307, [char]0x4ee4)
  $traeMoreSkills = -join @([char]0x66f4, [char]0x591a, [char]0x80fd, [char]0x529b)
  if ($ToolProfile -eq "workbuddy") {
    $patterns = @($workBuddyPrompt, $workBuddyReference, $workBuddySkills, "workbuddy")
  } elseif ($ToolProfile -eq "trae") {
    $patterns = @("chat-input", "agent-entry", "SOLO Agent", "/plan", "/spec", $traeMoreSkills)
  }
  if ($patterns.Count -eq 0) { return $false }

  $searchRect = New-RectObject `
    -X ([int]$Rect.x - 112) `
    -Y ([int]$Rect.y - 112) `
    -Width ([int]$Rect.width + 224) `
    -Height ([int]$Rect.height + 224)

  foreach ($nearby in $Elements) {
    try {
      $bounds = $nearby.Current.BoundingRectangle
      $nearbyRect = New-RectObject -X $bounds.X -Y $bounds.Y -Width $bounds.Width -Height $bounds.Height
      if (-not (Test-RectIntersects -A $nearbyRect -B $searchRect)) { continue }

      $fields = @()
      try { $fields += [string]$nearby.Current.AutomationId } catch {
        # UIA metadata may be inaccessible; keep the nearby-element heuristic conservative.
      }
      try { $fields += [string]$nearby.Current.Name } catch {
        # UIA metadata may be inaccessible; keep the nearby-element heuristic conservative.
      }
      try { $fields += [string]$nearby.Current.ClassName } catch {
        # UIA metadata may be inaccessible; keep the nearby-element heuristic conservative.
      }

      foreach ($field in $fields) {
        if (-not $field) { continue }
        foreach ($pattern in $patterns) {
          if ($field.IndexOf($pattern, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            return $true
          }
        }
      }
    } catch {
      continue
    }
  }
  return $false
}

function Test-ToolProfileComposerCandidate {
  param([string]$ToolProfile, [object]$Rect, [object]$Signals)
  return Test-SmartPromptToolProfileComposerCandidate -ToolProfile $ToolProfile -Rect $Rect -Signals $Signals
}

function Invoke-ClipboardRetry {
  param([scriptblock]$Action)
  $lastError = $null
  for ($attempt = 0; $attempt -lt 8; $attempt += 1) {
    try {
      return & $Action
    } catch {
      $lastError = $_
      Start-Sleep -Milliseconds (80 * ($attempt + 1))
    }
  }
  throw $lastError
}

function Invoke-CandidateCenterClick {
  param([object]$Candidate)
  if (-not $Candidate -or -not $Candidate.boundingRect) { return $false }
  $rect = $Candidate.boundingRect
  if ([int]$rect.width -le 0 -or [int]$rect.height -le 0) { return $false }
  $x = [int]([int]$rect.x + [Math]::Max(1, [int]$rect.width / 2))
  $y = [int]([int]$rect.y + [Math]::Max(1, [int]$rect.height / 2))
  try {
    [void][SmartPromptFillNative]::SetCursorPos($x, $y)
    Start-Sleep -Milliseconds 80
    [SmartPromptFillNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [SmartPromptFillNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 180
    return $true
  } catch {
    return $false
  }
}

function Invoke-ClipboardPasteFallback {
  param(
    [IntPtr]$ForegroundHandle,
    [object]$Candidate,
    [string]$PasteText
  )
  Add-Type -AssemblyName System.Windows.Forms
  $result = [ordered]@{
    ok = $false
    strategy = "clipboard_paste_fallback"
    clipboardFallbackTried = $true
    clipboardRestored = $false
    errorCode = ""
  }
  $previousData = $null
  $hadPreviousData = $false
  $clipboardChanged = $false
  try {
    $previousData = Invoke-ClipboardRetry { [System.Windows.Forms.Clipboard]::GetDataObject() }
    $hadPreviousData = $null -ne $previousData
    Invoke-ClipboardRetry { [System.Windows.Forms.Clipboard]::SetText($PasteText, [System.Windows.Forms.TextDataFormat]::UnicodeText) }
    $clipboardChanged = $true
    if ($ForegroundHandle -ne [IntPtr]::Zero) {
      [void][SmartPromptFillNative]::SetForegroundWindow($ForegroundHandle)
    }
    if ($Candidate -and $Candidate.element) {
      try {
        [void]$Candidate.element.SetFocus()
      } catch {
        # Some terminal and WebView elements do not expose focus through UIA.
      }
    }
    [void](Invoke-CandidateCenterClick -Candidate $Candidate)
    Start-Sleep -Milliseconds 120
    if ($Candidate -and $Candidate.inputSignals -and [bool]$Candidate.inputSignals.visualFallback) {
      [System.Windows.Forms.SendKeys]::SendWait("^a")
      Start-Sleep -Milliseconds 80
    }
    if ($Candidate -and $Candidate.winFormsControl) {
      $Candidate.winFormsControl.Paste()
    } else {
      [System.Windows.Forms.SendKeys]::SendWait("^v")
    }
    Start-Sleep -Milliseconds 450
    [void][System.Windows.Forms.Application]::DoEvents()
    $result.ok = $true
  } catch {
    $result.errorCode = "clipboard_paste_fallback_failed"
  } finally {
    if ($clipboardChanged) {
      try {
        if ($hadPreviousData) {
          Invoke-ClipboardRetry { [System.Windows.Forms.Clipboard]::SetDataObject($previousData, $true) }
        } else {
          Invoke-ClipboardRetry { [System.Windows.Forms.Clipboard]::Clear() }
        }
        $result.clipboardRestored = $true
      } catch {
        $result.clipboardRestored = $false
      }
    } else {
      $result.clipboardRestored = $true
    }
  }
  return [pscustomobject]$result
}

function Test-TextPatternContains {
  param(
    [object]$Candidate,
    [string]$ExpectedText,
    [int]$CharacterLimit = 65536
  )
  $result = [ordered]@{
    tried = $false
    matched = $false
    readLength = 0
    textHash = ""
    reason = ""
  }
  if (-not $Candidate -or -not $Candidate.hasTextPattern -or -not $Candidate.textPattern) {
    $result.reason = "text_pattern_unavailable"
    return [pscustomobject]$result
  }
  try {
    $result.tried = $true
    $range = $Candidate.textPattern.DocumentRange
    if (-not $range) {
      $result.reason = "text_pattern_range_unavailable"
      return [pscustomobject]$result
    }
    $text = $range.GetText($CharacterLimit)
    if ($null -eq $text) { $text = "" }
    $result.readLength = $text.Length
    $result.textHash = Get-HashText $text
    $result.matched = $text.Contains($ExpectedText)
    if (-not $result.matched) {
      $result.reason = "text_pattern_verification_mismatch"
    }
  } catch {
    $result.reason = "text_pattern_verification_failed"
  }
  return [pscustomobject]$result
}

function Test-ValuePatternContains {
  param(
    [object]$Candidate,
    [string]$ExpectedText
  )
  $result = [ordered]@{
    tried = $false
    matched = $false
    readLength = 0
    textHash = ""
    reason = ""
  }
  if (-not $Candidate -or -not $Candidate.hasValuePattern -or -not $Candidate.valuePattern) {
    $result.reason = "value_pattern_unavailable"
    return [pscustomobject]$result
  }
  try {
    $result.tried = $true
    $text = [string]$Candidate.valuePattern.Current.Value
    if ($null -eq $text) { $text = "" }
    $result.readLength = $text.Length
    $result.textHash = Get-HashText $text
    $result.matched = [bool]($text -eq $ExpectedText -or $text.Contains($ExpectedText))
    if (-not $result.matched) {
      $result.reason = "value_pattern_verification_mismatch"
    }
  } catch {
    $result.reason = "value_pattern_verification_failed"
  }
  return [pscustomobject]$result
}

function Expand-RectObject {
  param([object]$Rect, [int]$Padding = 16)
  if (-not $Rect) {
    return New-RectObject -X 0 -Y 0 -Width 0 -Height 0
  }
  return New-RectObject `
    -X ([int]$Rect.x - $Padding) `
    -Y ([int]$Rect.y - $Padding) `
    -Width ([int]$Rect.width + ($Padding * 2)) `
    -Height ([int]$Rect.height + ($Padding * 2))
}

function Test-TextCandidateContains {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [string]$ExpectedText,
    [int]$CharacterLimit = 4096
  )
  $result = [ordered]@{
    tried = $false
    matched = $false
    readLength = 0
    textHash = ""
    source = ""
  }
  if (-not $Element) { return [pscustomobject]$result }

  $texts = @()
  $textPattern = $null
  try {
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern) -and $textPattern) {
      $result.tried = $true
      $range = $textPattern.DocumentRange
      if ($range) {
        $texts += [pscustomobject]@{ source = "text_pattern"; value = [string]$range.GetText($CharacterLimit) }
      }
    }
  } catch {
    # TextPattern is optional and often blocked for protected controls; try the next safe source.
  }

  $valuePattern = $null
  try {
    if ($Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) -and $valuePattern) {
      $result.tried = $true
      $texts += [pscustomobject]@{ source = "value_pattern"; value = [string]$valuePattern.Current.Value }
    }
  } catch {
    # ValuePattern is optional and often blocked for protected controls; try the next safe source.
  }

  try {
    $name = [string]$Element.Current.Name
    if ($name) {
      $result.tried = $true
      $texts += [pscustomobject]@{ source = "element_name"; value = $name }
    }
  } catch {
    # Element names are only fallback evidence; inaccessible names should not fail verification.
  }

  foreach ($entry in $texts) {
    $value = [string]$entry.value
    if ($null -eq $value) { $value = "" }
    if ($value.Length -gt $result.readLength) {
      $result.readLength = $value.Length
      $result.textHash = Get-HashText $value
      $result.source = [string]$entry.source
    }
    if ($value.Contains($ExpectedText)) {
      $result.matched = $true
      $result.readLength = $value.Length
      $result.textHash = Get-HashText $value
      $result.source = [string]$entry.source
      break
    }
  }
  return [pscustomobject]$result
}

function Test-NearbyTextContains {
  param(
    [System.Windows.Automation.AutomationElement]$RootElement,
    [object]$TargetRect,
    [string]$ExpectedText,
    [int]$Padding = 48
  )
  $result = [ordered]@{
    tried = $false
    matched = $false
    inspectedElementCount = 0
    readableElementCount = 0
    readLength = 0
    textHash = ""
    source = ""
    reason = ""
  }
  if (-not $RootElement -or -not $TargetRect) {
    $result.reason = "nearby_text_verification_unavailable"
    return [pscustomobject]$result
  }

  $searchRect = Expand-RectObject -Rect $TargetRect -Padding $Padding
  try {
    $elements = @(Get-BoundedUiaElements -RootElement $RootElement -MaxElements 500 -TimeoutMs 3500)
    foreach ($element in $elements) {
      $result.inspectedElementCount += 1
      $controlType = ""
      try { $controlType = [string]$element.Current.ControlType.ProgrammaticName } catch { $controlType = "" }
      $rect = $null
      try {
        $bounds = $element.Current.BoundingRectangle
        $rect = New-RectObject -X $bounds.X -Y $bounds.Y -Width $bounds.Width -Height $bounds.Height
      } catch {
        continue
      }
      if (-not (Test-RectIntersects -A $rect -B $searchRect)) { continue }
      if ($controlType -eq "ControlType.Document" -and ([int]$rect.width -gt 900 -or [int]$rect.height -gt 500)) { continue }
      $textCheck = Test-TextCandidateContains -Element $element -ExpectedText $ExpectedText
      if (-not $textCheck.tried) { continue }
      $result.tried = $true
      $result.readableElementCount += 1
      if ([int]$textCheck.readLength -gt [int]$result.readLength) {
        $result.readLength = [int]$textCheck.readLength
        $result.textHash = $textCheck.textHash
        $result.source = $textCheck.source
      }
      if ($textCheck.matched) {
        $result.matched = $true
        $result.readLength = [int]$textCheck.readLength
        $result.textHash = $textCheck.textHash
        $result.source = $textCheck.source
        break
      }
    }
    if (-not $result.tried) {
      $result.reason = "nearby_text_verification_no_readable_elements"
    } elseif (-not $result.matched) {
      $result.reason = "nearby_text_verification_mismatch"
    }
  } catch {
    $result.reason = "nearby_text_verification_failed"
  }
  return [pscustomobject]$result
}

function Test-RootDocumentTextContains {
  param(
    [System.Windows.Automation.AutomationElement]$RootElement,
    [string]$ExpectedText,
    [int]$CharacterLimit = 65536
  )
  $result = [ordered]@{
    tried = $false
    matched = $false
    inspectedElementCount = 0
    readableElementCount = 0
    readLength = 0
    textHash = ""
    source = ""
    reason = ""
  }
  if (-not $RootElement) {
    $result.reason = "root_document_text_verification_unavailable"
    return [pscustomobject]$result
  }

  try {
    $elements = @(Get-BoundedUiaElements -RootElement $RootElement -MaxElements 500 -TimeoutMs 3500)
    foreach ($element in $elements) {
      $result.inspectedElementCount += 1
      $controlType = ""
      try { $controlType = [string]$element.Current.ControlType.ProgrammaticName } catch { $controlType = "" }
      if ($controlType -notin @("ControlType.Document", "ControlType.Edit")) { continue }

      $texts = @()
      $textPattern = $null
      try {
        if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern) -and $textPattern) {
          $range = $textPattern.DocumentRange
          if ($range) {
            $texts += [pscustomobject]@{ source = "root_document_text_pattern"; value = [string]$range.GetText($CharacterLimit) }
          }
        }
      } catch {
        # Root document text is optional fallback evidence; unreadable UIA text is treated as absent.
      }

      $valuePattern = $null
      try {
        if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern) -and $valuePattern) {
          $texts += [pscustomobject]@{ source = "root_document_value_pattern"; value = [string]$valuePattern.Current.Value }
        }
      } catch {
        # Root document values are optional fallback evidence; unreadable UIA values are treated as absent.
      }

      foreach ($entry in $texts) {
        $value = [string]$entry.value
        if ($null -eq $value) { $value = "" }
        $result.tried = $true
        $result.readableElementCount += 1
        if ($value.Length -gt [int]$result.readLength) {
          $result.readLength = $value.Length
          $result.textHash = Get-HashText $value
          $result.source = [string]$entry.source
        }
        if ($value.Contains($ExpectedText)) {
          $result.matched = $true
          $result.readLength = $value.Length
          $result.textHash = Get-HashText $value
          $result.source = [string]$entry.source
          break
        }
      }
      if ($result.matched) { break }
    }
    if (-not $result.tried) {
      $result.reason = "root_document_text_verification_no_readable_elements"
    } elseif (-not $result.matched) {
      $result.reason = "root_document_text_verification_mismatch"
    }
  } catch {
    $result.reason = "root_document_text_verification_failed"
  }
  return [pscustomobject]$result
}

function Test-PostWriteCandidateVerification {
  param(
    [System.Windows.Automation.AutomationElement]$RootElement,
    [object]$Candidate,
    [string]$ExpectedText,
    [bool]$AllowVerification
  )
  $result = [ordered]@{
    verified = $false
    verifiedText = ""
    textPatternVerificationTried = $false
    textPatternVerificationMatched = $false
    textPatternVerificationReadLength = 0
    textPatternVerificationTextHash = ""
    valuePatternVerificationTried = $false
    valuePatternVerificationMatched = $false
    valuePatternVerificationReadLength = 0
    valuePatternVerificationTextHash = ""
    nearbyTextVerificationTried = $false
    nearbyTextVerificationMatched = $false
    nearbyTextVerificationInspectedElementCount = 0
    nearbyTextVerificationReadableElementCount = 0
    nearbyTextVerificationReadLength = 0
    nearbyTextVerificationTextHash = ""
    nearbyTextVerificationSource = ""
  }

  if ($Candidate -and $Candidate.hasNativeWindowHandle) {
    $result.verifiedText = Get-WindowTextSafe -Handle $Candidate.nativeWindowHandle
  }
  $result.verified = [bool]($result.verifiedText -eq $ExpectedText)
  if ($result.verified -or -not $AllowVerification) {
    return [pscustomobject]$result
  }

  if ($Candidate -and $Candidate.hasValuePattern) {
    $valuePatternCheck = Test-ValuePatternContains -Candidate $Candidate -ExpectedText $ExpectedText
    $result.valuePatternVerificationTried = [bool]$valuePatternCheck.tried
    $result.valuePatternVerificationMatched = [bool]$valuePatternCheck.matched
    $result.valuePatternVerificationReadLength = [int]$valuePatternCheck.readLength
    $result.valuePatternVerificationTextHash = $valuePatternCheck.textHash
    if ($valuePatternCheck.matched) {
      $result.verified = $true
      $result.verifiedText = $ExpectedText
      return [pscustomobject]$result
    }
  }

  if ($Candidate -and $Candidate.hasTextPattern) {
    $textPatternCheck = Test-TextPatternContains -Candidate $Candidate -ExpectedText $ExpectedText
    $result.textPatternVerificationTried = [bool]$textPatternCheck.tried
    $result.textPatternVerificationMatched = [bool]$textPatternCheck.matched
    $result.textPatternVerificationReadLength = [int]$textPatternCheck.readLength
    $result.textPatternVerificationTextHash = $textPatternCheck.textHash
    if ($textPatternCheck.matched) {
      $result.verified = $true
      $result.verifiedText = $ExpectedText
      return [pscustomobject]$result
    }
  }

  if ($Candidate -and $Candidate.boundingRect) {
    $nearbyCheck = Test-NearbyTextContains -RootElement $RootElement -TargetRect $Candidate.boundingRect -ExpectedText $ExpectedText
    $result.nearbyTextVerificationTried = [bool]$nearbyCheck.tried
    $result.nearbyTextVerificationMatched = [bool]$nearbyCheck.matched
    $result.nearbyTextVerificationInspectedElementCount = [int]$nearbyCheck.inspectedElementCount
    $result.nearbyTextVerificationReadableElementCount = [int]$nearbyCheck.readableElementCount
    $result.nearbyTextVerificationReadLength = [int]$nearbyCheck.readLength
    $result.nearbyTextVerificationTextHash = $nearbyCheck.textHash
    $result.nearbyTextVerificationSource = $nearbyCheck.source
    if ($nearbyCheck.matched) {
      $result.verified = $true
      $result.verifiedText = $ExpectedText
    }
  }

  $visualFallbackCandidate = [bool]($Candidate -and $Candidate.inputSignals -and $Candidate.inputSignals.visualFallback -and $Candidate.inputSignals.profileComposerCandidate)
  if (-not $result.verified -and $visualFallbackCandidate) {
    $rootTextCheck = Test-RootDocumentTextContains -RootElement $RootElement -ExpectedText $ExpectedText
    $result.nearbyTextVerificationTried = [bool]($result.nearbyTextVerificationTried -or $rootTextCheck.tried)
    $result.nearbyTextVerificationMatched = [bool]($result.nearbyTextVerificationMatched -or $rootTextCheck.matched)
    $result.nearbyTextVerificationInspectedElementCount = [Math]::Max([int]$result.nearbyTextVerificationInspectedElementCount, [int]$rootTextCheck.inspectedElementCount)
    $result.nearbyTextVerificationReadableElementCount = [Math]::Max([int]$result.nearbyTextVerificationReadableElementCount, [int]$rootTextCheck.readableElementCount)
    if ([int]$rootTextCheck.readLength -gt [int]$result.nearbyTextVerificationReadLength -or [bool]$rootTextCheck.matched) {
      $result.nearbyTextVerificationReadLength = [int]$rootTextCheck.readLength
      $result.nearbyTextVerificationTextHash = $rootTextCheck.textHash
      $result.nearbyTextVerificationSource = $rootTextCheck.source
    }
    if ($rootTextCheck.matched) {
      $result.verified = $true
      $result.verifiedText = $ExpectedText
    }
  }

  return [pscustomobject]$result
}

function Get-BoundedUiaElements {
  param(
    [System.Windows.Automation.AutomationElement]$RootElement,
    [int]$MaxElements = 400,
    [int]$TimeoutMs = 3500
  )

  $items = New-Object System.Collections.ArrayList
  if (-not $RootElement) { return @($items) }

  $queue = New-Object System.Collections.Queue
  $queue.Enqueue($RootElement)
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $timer = [System.Diagnostics.Stopwatch]::StartNew()

  while ($queue.Count -gt 0 -and $items.Count -lt $MaxElements -and $timer.ElapsedMilliseconds -lt $TimeoutMs) {
    $element = $queue.Dequeue()
    [void]$items.Add($element)

    try {
      $child = $walker.GetFirstChild($element)
      while ($child -and ($items.Count + $queue.Count) -lt $MaxElements -and $timer.ElapsedMilliseconds -lt $TimeoutMs) {
        $queue.Enqueue($child)
        try {
          $child = $walker.GetNextSibling($child)
        } catch {
          $child = $null
        }
      }
    } catch {
      # Keep real Electron/WebView windows from blocking the foreground fill guard.
    }
  }

  $script:SmartPromptFillTraversalTimedOut = [bool]($timer.ElapsedMilliseconds -ge $TimeoutMs)
  $script:SmartPromptFillTraversalInspected = [int]$items.Count
  return @($items)
}

function Get-CursorRootWindow {
  try {
    $point = New-Object SmartPromptFillPoint
    $ok = [SmartPromptFillNative]::GetCursorPos([ref]$point)
    if (-not $ok) { return [IntPtr]::Zero }
    $cursorWindow = [SmartPromptFillNative]::WindowFromPoint($point)
    if ($cursorWindow -eq [IntPtr]::Zero) { return [IntPtr]::Zero }
    $rootWindow = [SmartPromptFillNative]::GetAncestor($cursorWindow, 2)
    if ($rootWindow -ne [IntPtr]::Zero) { return $rootWindow }
    return $cursorWindow
  } catch {
    return [IntPtr]::Zero
  }
}

function Get-WindowContextFromHandle {
  param([IntPtr]$Handle, [string]$SelectionSource = "foreground_window")
  $handle = $Handle
  $title = Get-WindowTextSafe -Handle $handle
  $processId = 0
  [void][SmartPromptFillNative]::GetWindowThreadProcessId($handle, [ref]$processId)
  $processName = ""
  $executablePath = ""
  if ($processId -gt 0) {
    try {
      $process = Get-Process -Id $processId -ErrorAction Stop
      $processName = $process.ProcessName
      $executablePath = [string]$process.Path
    } catch {
      $processName = ""
      $executablePath = ""
    }
  }
  $childProcessNames = if ($processId -gt 0) { @(Get-ChildProcessNames -ProcessId $processId) } else { @() }
  $ancestorProcessNames = if ($processId -gt 0) { @(Get-AncestorProcessNames -ProcessId $processId) } else { @() }
  $relatedProcessNames = @($childProcessNames + $ancestorProcessNames | Where-Object { $_ } | Select-Object -Unique)
  $windowVisibility = Get-FillWindowVisibilityContext -Handle $handle
  return [pscustomobject]@{
    handle = $handle
    title = $title
    processName = $processName
    processIdPresent = $processId -gt 0
    isVisible = [bool]$windowVisibility.isVisible
    isMinimized = [bool]$windowVisibility.isMinimized
    isCloaked = [bool]$windowVisibility.isCloaked
    isUsable = [bool]$windowVisibility.isUsable
    boundingRect = $windowVisibility.boundingRect
    titleHash = Get-HashText $title
    titleLength = $title.Length
    childProcessCount = $relatedProcessNames.Count
    childToolProcessHintPresent = Test-RelatedToolProcessHintPresent -ProcessName $processName -WindowTitle $title -RelatedProcessNames $relatedProcessNames
    detectedToolProfile = Get-ToolProfile -ProcessName $processName -WindowTitle $title -ChildProcessNames $relatedProcessNames -ExecutablePath $executablePath
    selectionSource = $SelectionSource
  }
}

function Get-MatchedWindowContext {
  param([string]$ExpectedTitleHash = "", [string]$ExpectedToolProfile = "")
  if (-not $ExpectedTitleHash -or -not $ExpectedToolProfile) { return $null }
  $windows = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
  foreach ($window in $windows) {
    try {
      $title = [string]$window.MainWindowTitle
      if ((Get-HashText $title) -ne $ExpectedTitleHash) { continue }
      $executablePath = try { [string]$window.Path } catch { "" }
      $directProfile = Get-ToolProfile -ProcessName $window.ProcessName -WindowTitle $title -ChildProcessNames @() -ExecutablePath $executablePath
      if ($directProfile -ne $ExpectedToolProfile) { continue }
      $context = Get-WindowContextFromHandle -Handle ([IntPtr]$window.MainWindowHandle) -SelectionSource "expected_window_match"
      if ($context.titleHash -eq $ExpectedTitleHash -and $context.detectedToolProfile -eq $ExpectedToolProfile) {
        [void](Restore-FillWindow -Handle ([IntPtr]$window.MainWindowHandle))
        Start-Sleep -Milliseconds 250
        $context = Get-WindowContextFromHandle -Handle ([IntPtr]$window.MainWindowHandle) -SelectionSource "expected_window_match"
        return $context
      }
    } catch {
      # Clipboard restore is best effort; verification still records no-auto-submit and write status.
    }
  }
  return $null
}

function Get-ForegroundContext {
  param([string]$ExpectedToolProfile = "", [string]$ExpectedTitleHash = "")
  $matchedContext = Get-MatchedWindowContext -ExpectedTitleHash $ExpectedTitleHash -ExpectedToolProfile $ExpectedToolProfile
  if ($matchedContext) { return $matchedContext }

  $foregroundContext = Get-WindowContextFromHandle -Handle ([SmartPromptFillNative]::GetForegroundWindow()) -SelectionSource "foreground_window"
  $cursorHandle = Get-CursorRootWindow
  if ($ExpectedToolProfile -and $cursorHandle -ne [IntPtr]::Zero -and $cursorHandle -ne $foregroundContext.handle) {
    $cursorContext = Get-WindowContextFromHandle -Handle $cursorHandle -SelectionSource "cursor_window_fallback"
    if ($foregroundContext.detectedToolProfile -ne $ExpectedToolProfile -and $cursorContext.detectedToolProfile -eq $ExpectedToolProfile) {
      return $cursorContext
    }
  }
  return $foregroundContext
}

function New-VisualWebViewFillCandidate {
  param([string]$ToolProfile, [object]$RootRect, [object]$Caret, [object]$Cursor, [int]$Index = 0, [object]$AnchorRect = $null)
  if (-not $RootRect -or [int]$RootRect.width -le 0 -or [int]$RootRect.height -le 0) { return $null }
  $profile = [string]$ToolProfile
  $anchorBased = [bool]($AnchorRect -and [int]$AnchorRect.width -gt 0 -and [int]$AnchorRect.height -gt 0)
  $cursorAnchorBased = [bool](
    -not $anchorBased -and
    ($profile -in @("workbuddy", "trae")) -and
    $Cursor -and
    $Cursor.rect -and
    [int]$Cursor.rect.width -gt 0 -and
    [int]$Cursor.rect.height -gt 0 -and
    [int]$Cursor.rect.x -ge [int]$RootRect.x -and
    [int]$Cursor.rect.x -lt ([int]$RootRect.x + [int]$RootRect.width) -and
    [int]$Cursor.rect.y -ge ([int]$RootRect.y + [int]([int]$RootRect.height * 0.52)) -and
    [int]$Cursor.rect.y -lt ([int]$RootRect.y + [int]$RootRect.height)
  )
  if ($anchorBased) {
    $rect = New-RectObject -X ([int]$AnchorRect.x) -Y ([int]$AnchorRect.y) -Width ([int]$AnchorRect.width) -Height ([int]$AnchorRect.height)
  } elseif ($cursorAnchorBased) {
    $candidateWidth = [Math]::Max(240, [int]([int]$RootRect.width * 0.64))
    $candidateHeight = [Math]::Max(72, [Math]::Min(180, [int]([int]$RootRect.height * 0.18)))
    $candidateX = [int]$Cursor.rect.x - [int]($candidateWidth * 0.5)
    $minX = [int]$RootRect.x
    $maxX = [int]$RootRect.x + [int]$RootRect.width - $candidateWidth
    if ($maxX -lt $minX) { $maxX = $minX }
    $candidateX = [Math]::Max($minX, [Math]::Min($candidateX, $maxX))
    $candidateY = [int]$Cursor.rect.y - [int]($candidateHeight * 0.45)
    $minY = [int]$RootRect.y + [int]([int]$RootRect.height * 0.48)
    $maxY = [int]$RootRect.y + [int]$RootRect.height - $candidateHeight
    if ($maxY -lt $minY) { $maxY = $minY }
    $candidateY = [Math]::Max($minY, [Math]::Min($candidateY, $maxY))
    $rect = New-RectObject -X $candidateX -Y $candidateY -Width $candidateWidth -Height $candidateHeight
  } else {
    $xRatio = 0.28
    $yRatio = 0.72
    $wRatio = 0.69
    $hRatio = 0.17
    if ($profile -eq "trae") {
      $xRatio = 0.15
      $yRatio = 0.78
      $wRatio = 0.44
      $hRatio = 0.13
    }
    $rect = New-RectObject `
      -X ([int]$RootRect.x + [int]([int]$RootRect.width * $xRatio)) `
      -Y ([int]$RootRect.y + [int]([int]$RootRect.height * $yRatio)) `
      -Width ([Math]::Max(80, [int]([int]$RootRect.width * $wRatio))) `
      -Height ([Math]::Max(48, [int]([int]$RootRect.height * $hRatio)))
  }
  $caretWithinBounds = [bool]($Caret -and $Caret.rect -and (Test-RectIntersects -A $rect -B $Caret.rect))
  $cursorWithinBounds = [bool]($Cursor -and $Cursor.rect -and (Test-RectIntersects -A $rect -B $Cursor.rect))
  $profileComposerCandidate = [bool]($anchorBased -or $caretWithinBounds -or $cursorWithinBounds -or (Test-SmartPromptWeakSignalClipboardFallback -ToolProfile $profile))
  return [pscustomobject]@{
    element = $null
    valuePattern = $null
    textPattern = $null
    index = [int]$Index
    controlType = "VisualWebViewComposer"
    className = "visual-webview-composer"
    classNameHash = Get-HashText "visual-webview-composer"
    isEnabled = $true
    isKeyboardFocusable = $true
    hasValuePattern = $false
    hasTextPattern = $false
    hasNativeWindowHandle = $false
    nativeWindowHandle = [IntPtr]::Zero
    boundingRect = $rect
    inputSignals = [pscustomobject]@{
      score = 80
      hasKeyboardFocus = $false
      focusedElementMatch = $false
      caretWithinBounds = [bool]$caretWithinBounds
      caretWindowMatch = [bool]($Caret -and $Caret.windowHandlePresent -and $caretWithinBounds)
      cursorWithinBounds = [bool]$cursorWithinBounds
      nearWindowBottom = $true
      broadDocument = $false
      semanticComposerHint = $false
      visualFallback = $true
      visualAnchorFallback = [bool]$anchorBased
      visualCursorFallback = [bool]$cursorAnchorBased
      profileComposerCandidate = [bool]$profileComposerCandidate
    }
  }
}

function Get-InputCandidates {
  param([System.Windows.Automation.AutomationElement]$RootElement, [string]$ToolProfile = "", [object]$VisualRootRect = $null)

  $items = @()
  if (-not $RootElement) { return $items }
  $rootBounds = $RootElement.Current.BoundingRectangle
  $rootRect = New-RectObject -X $rootBounds.X -Y $rootBounds.Y -Width $rootBounds.Width -Height $rootBounds.Height
  $visualRootRect = if ($VisualRootRect -and [int]$VisualRootRect.width -gt 0 -and ($ToolProfile -in @("workbuddy", "trae"))) { $VisualRootRect } else { $rootRect }
  $caret = Get-CaretContext
  $cursor = Get-CursorContext
  $focusedRuntimeId = ""
  try {
    $focusedRuntimeId = Get-RuntimeIdKey ([System.Windows.Automation.AutomationElement]::FocusedElement)
  } catch {
    $focusedRuntimeId = ""
  }
  $script:SmartPromptFillTraversalTimedOut = $false
  $script:SmartPromptFillTraversalInspected = 0
  $toInspect = @(Get-BoundedUiaElements -RootElement $RootElement -MaxElements 400 -TimeoutMs 3500)
  $inspected = 0
  foreach ($element in $toInspect) {
    if ($inspected -ge 400) { break }
    $inspected += 1
    $controlType = $element.Current.ControlType.ProgrammaticName
    $className = $element.Current.ClassName
    $valuePattern = $null
    $textPattern = $null
    $hasValue = $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)
    $hasText = $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)
    $nativeHandle = [IntPtr]$element.Current.NativeWindowHandle
    $isTextInput = $controlType -in @("ControlType.Edit", "ControlType.Document") -or $hasValue -or $hasText -or $className -match "(?i)edit|text"
    if (-not $isTextInput) { continue }
    $rect = $element.Current.BoundingRectangle
    $rectObject = New-RectObject -X $rect.X -Y $rect.Y -Width $rect.Width -Height $rect.Height
    $signals = Get-InputSignals -Element $element -Rect $rectObject -RootRect $rootRect -FocusedRuntimeId $focusedRuntimeId -Caret $caret -Cursor $cursor -ControlType $controlType -ClassName $className -HasValuePattern ([bool]$hasValue) -HasTextPattern ([bool]$hasText) -NativeWindowHandle $nativeHandle
    if ($ToolProfile -in @("workbuddy", "trae")) {
      $semanticComposerHint = Test-ToolProfileComposerSemanticHint -ToolProfile $ToolProfile -Elements $toInspect -Rect $rectObject
      if ($semanticComposerHint) {
        $signals.score = [int]$signals.score + 25
      }
      $signals | Add-Member -NotePropertyName semanticComposerHint -NotePropertyValue ([bool]$semanticComposerHint) -Force
      $profileComposerCandidate = Test-ToolProfileComposerCandidate -ToolProfile $ToolProfile -Rect $rectObject -Signals $signals
      if (-not $profileComposerCandidate) {
        $signals.score = [int]$signals.score - 120
      }
      $signals | Add-Member -NotePropertyName profileComposerCandidate -NotePropertyValue $profileComposerCandidate -Force
    }
    $items += [pscustomobject]@{
      element = $element
      valuePattern = $valuePattern
      textPattern = $textPattern
      index = $items.Count
      controlType = $controlType
      className = $className
      classNameHash = Get-HashText $className
      isEnabled = [bool]$element.Current.IsEnabled
      isKeyboardFocusable = [bool]$element.Current.IsKeyboardFocusable
      hasValuePattern = [bool]$hasValue
      hasTextPattern = [bool]$hasText
      hasNativeWindowHandle = $nativeHandle -ne [IntPtr]::Zero
      nativeWindowHandle = $nativeHandle
      boundingRect = $rectObject
      inputSignals = $signals
    }
  }
  $preVisualSafeCandidatePool = @(if ($ToolProfile -in @("workbuddy", "trae")) {
    $items | Where-Object { $_.inputSignals.profileComposerCandidate }
  } else {
    $items | Where-Object { Test-PreferredWritableInputCandidate -Candidate $_ }
  })
  if ($preVisualSafeCandidatePool.Count -eq 0 -and $ToolProfile -in @("codex", "workbuddy", "trae")) {
    $visualAnchor = @(Get-VisualWebViewAnchorCandidate -Candidates $items -ToolProfile $ToolProfile | Select-Object -First 1)
    $visualAnchorRect = if ($visualAnchor.Count -gt 0) { $visualAnchor[0].boundingRect } else { $null }
    $visualCandidate = New-VisualWebViewFillCandidate -ToolProfile $ToolProfile -RootRect $visualRootRect -Caret $caret -Cursor $cursor -Index $items.Count -AnchorRect $visualAnchorRect
    if ($visualCandidate -and [bool]$visualCandidate.inputSignals.profileComposerCandidate) {
      $items += $visualCandidate
    }
  }
  return $items
}

function Invoke-SelfTestFill {
  Ensure-FillTypes
  Add-Type -AssemblyName System.Windows.Forms

  $form = $null
  try {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "Smart Prompt Codex Fill Self Test"
    $form.Width = 560
    $form.Height = 180
    $textbox = New-Object System.Windows.Forms.TextBox
    $textbox.Multiline = $true
    $textbox.Left = 16
    $textbox.Top = 16
    $textbox.Width = 500
    $textbox.Height = 86
    $textbox.Text = ""
    $form.Controls.Add($textbox)
    $form.Show()
    [void][System.Windows.Forms.Application]::DoEvents()
    [void]$form.Activate()
    [void]$textbox.Focus()
    Start-Sleep -Milliseconds 250
    [void][System.Windows.Forms.Application]::DoEvents()

    $element = [System.Windows.Automation.AutomationElement]::FromHandle($textbox.Handle)
    $controlType = if ($element) { $element.Current.ControlType.ProgrammaticName } else { "" }
    $className = if ($element) { $element.Current.ClassName } else { "" }
    $valuePattern = $null
    $hasValuePattern = $false
    if ($element) {
      $hasValuePattern = $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)
    }

    $strategy = ""
    $uiaSetValueTried = $false
    $clipboardFallbackTried = $false
    $clipboardRestored = $false
    $writeAttempted = $false
    $reason = ""

    if ($AllowClipboardFallback) {
      $testCandidate = [pscustomobject]@{
        element = $element
        nativeWindowHandle = [IntPtr]$textbox.Handle
        winFormsControl = $textbox
      }
      $paste = Invoke-ClipboardPasteFallback -ForegroundHandle ([IntPtr]$form.Handle) -Candidate $testCandidate -PasteText $Text
      $clipboardFallbackTried = [bool]$paste.clipboardFallbackTried
      $clipboardRestored = [bool]$paste.clipboardRestored
      $strategy = $paste.strategy
      $writeAttempted = [bool]$paste.ok
      if (-not $paste.ok) {
        $reason = $paste.errorCode
      }
    } elseif ($hasValuePattern -and $valuePattern) {
      try {
        $uiaSetValueTried = $true
        $valuePattern.SetValue($Text)
        $writeAttempted = $true
        [void][System.Windows.Forms.Application]::DoEvents()
        if ($textbox.Text -eq $Text) {
          $strategy = "uia_value_pattern"
        }
      } catch {
        $strategy = ""
      }
    }

    if (-not $AllowClipboardFallback -and -not $strategy) {
      [void][SmartPromptFillNative]::SetWindowText($textbox.Handle, $Text)
      [void][System.Windows.Forms.Application]::DoEvents()
      $strategy = "win32_set_window_text_fallback"
      $writeAttempted = $true
    }

    $builder = New-Object System.Text.StringBuilder 1024
    [void][SmartPromptFillNative]::GetWindowText($textbox.Handle, $builder, $builder.Capacity)
    $verifiedText = $builder.ToString()
    $verified = $verifiedText -eq $Text

    return [pscustomobject]@{
      schemaVersion = "m3-windows-fill@1"
      createdAt = (Get-Date).ToUniversalTime().ToString("o")
      platform = "win32"
      selfTest = $true
      confirmForeground = $false
      allowClipboardFallback = [bool]$AllowClipboardFallback
      allowTextPatternVerification = [bool]$AllowTextPatternVerification
      pass = [bool]$verified
      reason = if ($verified) { "" } else { $reason }
      writeAttempted = [bool]$writeAttempted
      verified = [bool]$verified
      strategy = $strategy
      uiaSetValueTried = [bool]$uiaSetValueTried
      clipboardFallbackTried = [bool]$clipboardFallbackTried
      clipboardRestored = [bool]$clipboardRestored
      textPatternVerificationTried = $false
      textPatternVerificationMatched = $false
      valuePatternVerificationTried = $false
      valuePatternVerificationMatched = $false
      nearbyTextVerificationTried = $false
      nearbyTextVerificationMatched = $false
      target = [pscustomobject]@{
        index = 0
        controlType = $controlType
        classNameHash = Get-HashText $className
        hasValuePattern = [bool]$hasValuePattern
        hasNativeWindowHandle = $true
        titleLength = $form.Text.Length
        titleHash = Get-HashText $form.Text
      }
      summary = [pscustomobject]@{
        requestedTextLength = $Text.Length
        requestedTextHash = Get-HashText $Text
        verifiedTextLength = $verifiedText.Length
        verifiedTextHash = Get-HashText $verifiedText
        autoSubmit = $false
        submitSignalCount = 0
      }
      supportedToolProfiles = @("codex", "claude-code", "hermes", "workbuddy", "trae")
      privacy = New-Privacy
    }
  } finally {
    if ($form) {
      $form.Close()
      $form.Dispose()
    }
  }
}

function Invoke-ConfirmedForegroundFill {
  Ensure-FillTypes
  $context = Get-ForegroundContext -ExpectedToolProfile $ExpectedToolProfile -ExpectedTitleHash $ExpectedTitleHash
  $foreground = [pscustomobject]@{
    processName = $context.processName
    pidPresent = [bool]$context.processIdPresent
    isVisible = [bool]$context.isVisible
    isMinimized = [bool]$context.isMinimized
    isCloaked = [bool]$context.isCloaked
    isUsable = [bool]$context.isUsable
    boundingRect = $context.boundingRect
    titleLength = $context.titleLength
    titleHash = $context.titleHash
    detectedToolProfile = $context.detectedToolProfile
    childProcessCount = $context.childProcessCount
    childToolProcessHintPresent = [bool]$context.childToolProcessHintPresent
    selectionSource = if ($context.selectionSource) { $context.selectionSource } else { "foreground_window" }
    expectedTitleHashMatched = $false
    expectedToolProfileMatched = $false
  }
  $base = [ordered]@{
    schemaVersion = "m3-windows-fill@1"
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    platform = "win32"
    selfTest = $false
    confirmForeground = [bool]$ConfirmForeground
    allowClipboardFallback = [bool]$AllowClipboardFallback
    allowTextPatternVerification = [bool]$AllowTextPatternVerification
    pass = $false
    writeAttempted = $false
    verified = $false
    strategy = ""
    uiaSetValueTried = $false
    clipboardFallbackTried = $false
    clipboardRestored = $false
    textPatternVerificationTried = $false
    textPatternVerificationMatched = $false
    valuePatternVerificationTried = $false
    valuePatternVerificationMatched = $false
    nearbyTextVerificationTried = $false
    nearbyTextVerificationMatched = $false
    foreground = $foreground
    supportedToolProfiles = @("codex", "claude-code", "hermes", "workbuddy", "trae")
    privacy = New-Privacy
  }

  if (-not $ConfirmForeground) {
    $base.reason = "foreground_fill_requires_confirm_foreground"
    return [pscustomobject]$base
  }
  if (-not $ExpectedTitleHash -or -not $ExpectedToolProfile) {
    $base.reason = "foreground_fill_requires_expected_title_hash_and_tool_profile"
    return [pscustomobject]$base
  }
  $foreground.expectedTitleHashMatched = $context.titleHash -eq $ExpectedTitleHash
  $foreground.expectedToolProfileMatched = $context.detectedToolProfile -eq $ExpectedToolProfile
  if (-not $foreground.expectedTitleHashMatched) {
    $base.reason = "foreground_title_hash_mismatch"
    return [pscustomobject]$base
  }
  if (-not $foreground.expectedToolProfileMatched) {
    $base.reason = "foreground_tool_profile_mismatch"
    return [pscustomobject]$base
  }
  $foregroundUsableForWrite = [bool](
    $foreground.isVisible -and
    (-not $foreground.isMinimized) -and
    (-not $foreground.isCloaked) -and
    $foreground.isUsable
  )
  if (-not $foregroundUsableForWrite) {
    $base.reason = "foreground_window_not_usable_for_real_write"
    return [pscustomobject]$base
  }
  if (-not (@("codex", "claude-code", "hermes", "workbuddy", "trae") -contains $ExpectedToolProfile)) {
    $base.reason = "foreground_tool_profile_not_supported"
    return [pscustomobject]$base
  }

  $rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($context.handle)
  $candidates = @(Get-InputCandidates -RootElement $rootElement -ToolProfile $context.detectedToolProfile -VisualRootRect $context.boundingRect | Where-Object { $_.isEnabled })
  $safeCandidatePool = @(if ($context.detectedToolProfile -in @("workbuddy", "trae")) {
    $candidates | Where-Object { $_.inputSignals.profileComposerCandidate }
  } else {
    $candidates | Where-Object { Test-PreferredWritableInputCandidate -Candidate $_ }
  })
  $bestCandidate = @($safeCandidatePool | Sort-Object @{ Expression = { [int]$_.inputSignals.score }; Descending = $true }, @{ Expression = { [int]$_.index }; Ascending = $true } | Select-Object -First 1)
  $base.summary = [pscustomobject]@{
    candidateCount = $candidates.Count
    safeCandidateCount = $safeCandidatePool.Count
    focusedCandidateCount = @($candidates | Where-Object { $_.inputSignals.hasKeyboardFocus -or $_.inputSignals.focusedElementMatch }).Count
    caretCandidateCount = @($candidates | Where-Object { $_.inputSignals.caretWithinBounds -or $_.inputSignals.caretWindowMatch }).Count
    semanticCandidateCount = @($candidates | Where-Object { $_.inputSignals.semanticComposerHint }).Count
    traversalTimedOut = [bool]$script:SmartPromptFillTraversalTimedOut
    inspectedElementCount = [int]$script:SmartPromptFillTraversalInspected
    bestCandidateIndex = if ($bestCandidate.Count -gt 0) { [int]$bestCandidate[0].index } else { -1 }
    bestCandidateScore = if ($bestCandidate.Count -gt 0) { [int]$bestCandidate[0].inputSignals.score } else { 0 }
    requestedTextLength = $Text.Length
    requestedTextHash = Get-HashText $Text
    verifiedTextLength = 0
    verifiedTextHash = ""
    textPatternVerificationReadLength = 0
    textPatternVerificationTextHash = ""
    valuePatternVerificationReadLength = 0
    valuePatternVerificationTextHash = ""
    nearbyTextVerificationInspectedElementCount = 0
    nearbyTextVerificationReadableElementCount = 0
    nearbyTextVerificationReadLength = 0
    nearbyTextVerificationTextHash = ""
    nearbyTextVerificationSource = ""
    autoSubmit = $false
    submitSignalCount = 0
  }
  if ($candidates.Count -eq 0) {
    if ($AllowClipboardFallback) {
      $base.target = [pscustomobject]@{
        index = -1
        controlType = "ForegroundWindow"
        classNameHash = ""
        hasValuePattern = $false
        hasTextPattern = $false
        hasNativeWindowHandle = $context.handle -ne [IntPtr]::Zero
        titleLength = $context.titleLength
        titleHash = $context.titleHash
        boundingRect = [pscustomobject]@{ x = 0; y = 0; width = 0; height = 0 }
      }
      $paste = Invoke-ClipboardPasteFallback -ForegroundHandle $context.handle -Candidate $null -PasteText $Text
      $base.writeAttempted = [bool]$paste.ok
      $base.strategy = $paste.strategy
      $base.clipboardFallbackTried = [bool]$paste.clipboardFallbackTried
      $base.clipboardRestored = [bool]$paste.clipboardRestored
      $base.reason = if ($paste.ok) { "foreground_after_clipboard_paste_verification_unavailable" } else { $paste.errorCode }
      return [pscustomobject]$base
    }
    $base.reason = "foreground_no_input_candidates"
    return [pscustomobject]$base
  }
  if ($context.detectedToolProfile -in @("workbuddy", "trae") -and $safeCandidatePool.Count -eq 0) {
    $base.reason = "foreground_no_safe_assistant_input_candidate"
    return [pscustomobject]$base
  }
  if ($safeCandidatePool.Count -eq 0) {
    $base.reason = "foreground_no_safe_input_candidate"
    return [pscustomobject]$base
  }
  $candidateMatches = @($candidates | Where-Object { [int]$_.index -eq $CandidateIndex })
  if ($CandidateIndex -lt 0 -and $bestCandidate.Count -gt 0) {
    $candidate = $bestCandidate[0]
    $base | Add-Member -NotePropertyName candidateIndexRemappedToBestSafe -NotePropertyValue $true -Force
    $base | Add-Member -NotePropertyName requestedCandidateIndex -NotePropertyValue ([int]$CandidateIndex) -Force
  } elseif ($candidateMatches.Count -gt 0) {
    $candidate = $candidateMatches[0]
  } elseif ($CandidateIndex -ge 0 -and $CandidateIndex -lt $candidates.Count) {
    $candidate = $candidates[$CandidateIndex]
  } else {
    $base.reason = "foreground_candidate_index_out_of_range"
    return [pscustomobject]$base
  }
  $safeCandidateIndexes = @($safeCandidatePool | ForEach-Object { [int]$_.index })
  if ($safeCandidatePool.Count -gt 0 -and -not ($safeCandidateIndexes -contains [int]$candidate.index)) {
    if ($bestCandidate.Count -gt 0) {
      $candidate = $bestCandidate[0]
      $base | Add-Member -NotePropertyName candidateIndexRemappedToBestSafe -NotePropertyValue $true -Force
      $base | Add-Member -NotePropertyName requestedCandidateIndex -NotePropertyValue ([int]$CandidateIndex) -Force
    } else {
      $base.reason = "foreground_candidate_index_not_in_safe_pool"
      return [pscustomobject]$base
    }
  }
  if ($context.detectedToolProfile -in @("workbuddy", "trae") -and -not $candidate.inputSignals.profileComposerCandidate) {
    $base.reason = "foreground_candidate_failed_tool_profile_composer_guard"
    return [pscustomobject]$base
  }
  $directWriteTooBroad = [bool](
    $candidate.controlType -eq "ControlType.Document" -and
    ([int]$candidate.boundingRect.width -gt 900 -or [int]$candidate.boundingRect.height -gt 500)
  )
  $base.target = [pscustomobject]@{
    index = $candidate.index
    controlType = $candidate.controlType
    classNameHash = $candidate.classNameHash
    hasValuePattern = [bool]$candidate.hasValuePattern
    hasTextPattern = [bool]$candidate.hasTextPattern
    hasNativeWindowHandle = [bool]$candidate.hasNativeWindowHandle
    directWriteBlocked = [bool]$directWriteTooBroad
    titleLength = $context.titleLength
    titleHash = $context.titleHash
    boundingRect = $candidate.boundingRect
    inputSignals = $candidate.inputSignals
  }

  $strategy = ""
  $uiaSetValueTried = $false
  if ($candidate.hasValuePattern -and $candidate.valuePattern -and -not $directWriteTooBroad) {
    try {
      $uiaSetValueTried = $true
      $candidate.valuePattern.SetValue($Text)
      $strategy = "uia_value_pattern"
    } catch {
      $strategy = ""
    }
  }
  if (-not $strategy -and $candidate.hasNativeWindowHandle -and -not $directWriteTooBroad) {
    [void][SmartPromptFillNative]::SetWindowText($candidate.nativeWindowHandle, $Text)
    $strategy = "win32_set_window_text_fallback"
  }
  if (-not $strategy -and $AllowClipboardFallback) {
    $paste = Invoke-ClipboardPasteFallback -ForegroundHandle $context.handle -Candidate $candidate -PasteText $Text
    $base.clipboardFallbackTried = [bool]$paste.clipboardFallbackTried
    $base.clipboardRestored = [bool]$paste.clipboardRestored
    if ($paste.ok) {
      $strategy = $paste.strategy
    } else {
      $base.reason = $paste.errorCode
      $base.uiaSetValueTried = [bool]$uiaSetValueTried
      return [pscustomobject]$base
    }
  }
  if (-not $strategy) {
    $base.reason = if ($directWriteTooBroad) { "foreground_candidate_requires_clipboard_fallback" } else { "foreground_candidate_has_no_write_strategy" }
    $base.uiaSetValueTried = [bool]$uiaSetValueTried
    return [pscustomobject]$base
  }

  $verification = Test-PostWriteCandidateVerification -RootElement $rootElement -Candidate $candidate -ExpectedText $Text -AllowVerification ([bool]$AllowTextPatternVerification)
  $verified = [bool]$verification.verified
  $verifiedText = [string]$verification.verifiedText
  $base.textPatternVerificationTried = [bool]$verification.textPatternVerificationTried
  $base.textPatternVerificationMatched = [bool]$verification.textPatternVerificationMatched
  $base.valuePatternVerificationTried = [bool]$verification.valuePatternVerificationTried
  $base.valuePatternVerificationMatched = [bool]$verification.valuePatternVerificationMatched
  $base.nearbyTextVerificationTried = [bool]$verification.nearbyTextVerificationTried
  $base.nearbyTextVerificationMatched = [bool]$verification.nearbyTextVerificationMatched
  $base.summary.textPatternVerificationReadLength = [int]$verification.textPatternVerificationReadLength
  $base.summary.textPatternVerificationTextHash = $verification.textPatternVerificationTextHash
  $base.summary.valuePatternVerificationReadLength = [int]$verification.valuePatternVerificationReadLength
  $base.summary.valuePatternVerificationTextHash = $verification.valuePatternVerificationTextHash
  $base.summary.nearbyTextVerificationInspectedElementCount = [int]$verification.nearbyTextVerificationInspectedElementCount
  $base.summary.nearbyTextVerificationReadableElementCount = [int]$verification.nearbyTextVerificationReadableElementCount
  $base.summary.nearbyTextVerificationReadLength = [int]$verification.nearbyTextVerificationReadLength
  $base.summary.nearbyTextVerificationTextHash = $verification.nearbyTextVerificationTextHash
  $base.summary.nearbyTextVerificationSource = $verification.nearbyTextVerificationSource

  if (-not $verified -and $AllowClipboardFallback -and $strategy -ne "clipboard_paste_fallback") {
    $paste = Invoke-ClipboardPasteFallback -ForegroundHandle $context.handle -Candidate $candidate -PasteText $Text
    $base.clipboardFallbackTried = [bool]$paste.clipboardFallbackTried
    $base.clipboardRestored = [bool]$paste.clipboardRestored
    if ($paste.ok) {
      $strategy = if ($strategy) { "${strategy}_then_clipboard_paste_fallback" } else { $paste.strategy }
      $verification = Test-PostWriteCandidateVerification -RootElement $rootElement -Candidate $candidate -ExpectedText $Text -AllowVerification ([bool]$AllowTextPatternVerification)
      $verified = [bool]$verification.verified
      $verifiedText = [string]$verification.verifiedText
      $base.textPatternVerificationTried = [bool]($base.textPatternVerificationTried -or $verification.textPatternVerificationTried)
      $base.textPatternVerificationMatched = [bool]($base.textPatternVerificationMatched -or $verification.textPatternVerificationMatched)
      $base.valuePatternVerificationTried = [bool]($base.valuePatternVerificationTried -or $verification.valuePatternVerificationTried)
      $base.valuePatternVerificationMatched = [bool]($base.valuePatternVerificationMatched -or $verification.valuePatternVerificationMatched)
      $base.nearbyTextVerificationTried = [bool]($base.nearbyTextVerificationTried -or $verification.nearbyTextVerificationTried)
      $base.nearbyTextVerificationMatched = [bool]($base.nearbyTextVerificationMatched -or $verification.nearbyTextVerificationMatched)
      $base.summary.textPatternVerificationReadLength = [int]$verification.textPatternVerificationReadLength
      $base.summary.textPatternVerificationTextHash = $verification.textPatternVerificationTextHash
      $base.summary.valuePatternVerificationReadLength = [int]$verification.valuePatternVerificationReadLength
      $base.summary.valuePatternVerificationTextHash = $verification.valuePatternVerificationTextHash
      $base.summary.nearbyTextVerificationInspectedElementCount = [int]$verification.nearbyTextVerificationInspectedElementCount
      $base.summary.nearbyTextVerificationReadableElementCount = [int]$verification.nearbyTextVerificationReadableElementCount
      $base.summary.nearbyTextVerificationReadLength = [int]$verification.nearbyTextVerificationReadLength
      $base.summary.nearbyTextVerificationTextHash = $verification.nearbyTextVerificationTextHash
      $base.summary.nearbyTextVerificationSource = $verification.nearbyTextVerificationSource
    }
  }
  $base.pass = [bool]$verified
  $base.writeAttempted = $true
  $base.verified = [bool]$verified
  $base.strategy = $strategy
  $base.uiaSetValueTried = [bool]$uiaSetValueTried
  $base.summary.verifiedTextLength = $verifiedText.Length
  $base.summary.verifiedTextHash = Get-HashText $verifiedText
  if (-not $verified) {
    if ($strategy -eq "clipboard_paste_fallback" -and -not $candidate.hasNativeWindowHandle) {
      $base.reason = "foreground_after_clipboard_paste_verification_unavailable"
    } elseif ($strategy -eq "clipboard_paste_fallback") {
      $base.reason = "foreground_after_clipboard_paste_verification_failed"
    } else {
      $base.reason = "foreground_after_write_verification_failed"
    }
  }
  return [pscustomobject]$base
}

if ($env:OS -notlike "*Windows*") {
  $reportObject = New-UnsupportedReport -Reason "windows_fill_only"
} elseif (-not $SelfTest) {
  $reportObject = Invoke-ConfirmedForegroundFill
} else {
  $reportObject = Invoke-SelfTestFill
}

$json = $reportObject | ConvertTo-Json -Depth 8
if (-not $JsonOnly) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Report) | Out-Null
  Set-Content -Path $Report -Value $json -Encoding UTF8
  Write-Host "M3 desktop fill report: $Report"
}
Write-Output $json

if (-not $reportObject.pass -and $SelfTest) {
  exit 1
}
