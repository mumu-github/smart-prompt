param(
  [string]$Report = "",
  [switch]$JsonOnly,
  [switch]$SelfTest,
  [ValidateSet("codex", "claude-code", "hermes", "workbuddy", "trae")]
  [string]$SelfTestProfile = "codex"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
. (Join-Path $ScriptDir "desktop-tool-profile-config.ps1")

if (-not $Report) {
  $Report = Join-Path $Root "research/m3-desktop-input.latest.json"
} elseif (-not [System.IO.Path]::IsPathRooted($Report)) {
  $Report = Join-Path $Root $Report
}

function Get-HashText {
  param([string]$Text)
  if (-not $Text) { return "" }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $hash = $sha.ComputeHash($bytes)
    return ([System.BitConverter]::ToString($hash) -replace "-", "").Substring(0, 16).ToLowerInvariant()
  } finally {
    $sha.Dispose()
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

function Test-IsSystemShellWindow {
  param([string]$ProcessName, [string]$WindowTitle)
  $process = ([string]$ProcessName).Trim()
  if ($process -match "(?i)^(explorer|lockapp|shellexperiencehost|searchhost|startmenuexperiencehost|applicationframehost|textinputhost|dwm|runtimebroker|widgets|systemsettings|taskmgr)$") {
    return $true
  }
  return [bool](([string]$WindowTitle) -match "(?i)^Backstop Window$")
}

function Test-RelatedToolProcessHintPresent {
  param([string]$ProcessName, [string]$WindowTitle, [string[]]$RelatedProcessNames = @())
  if (-not (Test-ShouldUseRelatedToolProfile -ProcessName $ProcessName -WindowTitle $WindowTitle)) {
    return $false
  }
  return [bool](($RelatedProcessNames -join " ") -match "(?i)\bcodex\b|\bclaude\b|\bhermes\b|\bwork[\s-]*buddy\b|\bworkbuddy\b|\btrae\b")
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
    # Best-effort process lineage only; inaccessible CIM rows should not fail input detection.
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

function Get-SelfTestTitle {
  param([string]$Profile)
  switch ($Profile) {
    "claude-code" { return "Smart Prompt Claude Code UIA Self Test" }
    "hermes" { return "Smart Prompt Hermes UIA Self Test" }
    "workbuddy" { return "Smart Prompt workBuddy UIA Self Test" }
    "trae" { return "Smart Prompt Trae UIA Self Test" }
    default { return "Smart Prompt Codex UIA Self Test" }
  }
}

function Get-WindowTextSafe {
  param([IntPtr]$Handle)
  $builder = New-Object System.Text.StringBuilder 512
  [void][Win32Native]::GetWindowText($Handle, $builder, $builder.Capacity)
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

function Get-CursorContext {
  $emptyRect = New-RectObject -X 0 -Y 0 -Width 0 -Height 0
  $result = [ordered]@{
    source = "win32_get_cursor_pos"
    supported = $false
    windowHandlePresent = $false
    rootWindowHandlePresent = $false
    rect = $emptyRect
  }
  try {
    $point = New-Object SmartPromptPoint
    $ok = [Win32Native]::GetCursorPos([ref]$point)
    $result.supported = [bool]$ok
    if (-not $ok) { return [pscustomobject]$result }
    $result.rect = New-RectObject -X $point.X -Y $point.Y -Width 1 -Height 1
    $cursorWindow = [Win32Native]::WindowFromPoint($point)
    $result.windowHandlePresent = [bool]($cursorWindow -ne [IntPtr]::Zero)
    $rootWindow = if ($cursorWindow -ne [IntPtr]::Zero) { [Win32Native]::GetAncestor($cursorWindow, 2) } else { [IntPtr]::Zero }
    $result.rootWindowHandlePresent = [bool]($rootWindow -ne [IntPtr]::Zero)
  } catch {
    $result.supported = $false
  }
  return [pscustomobject]$result
}

function Get-CaretContext {
  $emptyRect = New-RectObject -X 0 -Y 0 -Width 0 -Height 0
  $result = [ordered]@{
    source = "win32_get_gui_thread_info"
    supported = $false
    visible = $false
    windowHandlePresent = $false
    rect = $emptyRect
    virtualCaretMayBeHidden = $true
  }
  try {
    $info = New-Object SmartPromptGuiThreadInfo
    $info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][SmartPromptGuiThreadInfo])
    $ok = [Win32Native]::GetGUIThreadInfo(0, [ref]$info)
    $result.supported = [bool]$ok
    if (-not $ok) { return [pscustomobject]$result }

    $hwndCaret = [IntPtr]$info.hwndCaret
    $result.windowHandlePresent = [bool]($hwndCaret -ne [IntPtr]::Zero)
    $result.visible = [bool](($info.flags -band 1) -ne 0 -or $result.windowHandlePresent)
    if ($hwndCaret -ne [IntPtr]::Zero) {
      $topLeft = New-Object SmartPromptPoint
      $bottomRight = New-Object SmartPromptPoint
      $topLeft.X = [int]$info.rcCaret.Left
      $topLeft.Y = [int]$info.rcCaret.Top
      $bottomRight.X = [int]$info.rcCaret.Right
      $bottomRight.Y = [int]$info.rcCaret.Bottom
      [void][Win32Native]::ClientToScreen($hwndCaret, [ref]$topLeft)
      [void][Win32Native]::ClientToScreen($hwndCaret, [ref]$bottomRight)
      $result.rect = New-RectObject -X $topLeft.X -Y $topLeft.Y -Width ([Math]::Max(1, $bottomRight.X - $topLeft.X)) -Height ([Math]::Max(1, $bottomRight.Y - $topLeft.Y))
    }
  } catch {
    $result.supported = $false
    $result.visible = $false
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
  $caretWindowMatch = [bool]($Caret -and $Caret.windowHandlePresent -and $NativeWindowHandle -ne [IntPtr]::Zero -and $Caret.rect.width -gt 0 -and $caretWithinBounds)
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

function Get-BoundedUiaElements {
  param(
    [System.Windows.Automation.AutomationElement]$RootElement,
    [int]$MaxElements = 300,
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
      # Some Electron/WebView trees stall or reject child traversal. Keep the bounded snapshot usable.
    }
  }

  $script:SmartPromptTraversalTimedOut = [bool]($timer.ElapsedMilliseconds -ge $TimeoutMs)
  $script:SmartPromptTraversalInspected = [int]$items.Count
  return @($items)
}

function Get-CursorRootWindow {
  try {
    $point = New-Object SmartPromptPoint
    $ok = [Win32Native]::GetCursorPos([ref]$point)
    if (-not $ok) { return [IntPtr]::Zero }
    $cursorWindow = [Win32Native]::WindowFromPoint($point)
    if ($cursorWindow -eq [IntPtr]::Zero) { return [IntPtr]::Zero }
    $rootWindow = [Win32Native]::GetAncestor($cursorWindow, 2)
    if ($rootWindow -ne [IntPtr]::Zero) { return $rootWindow }
    return $cursorWindow
  } catch {
    return [IntPtr]::Zero
  }
}

function Test-PreferCursorSnapshot {
  param([object]$ForegroundSnapshot, [object]$CursorSnapshot)
  if (-not $CursorSnapshot -or -not $CursorSnapshot.probeOk) { return $false }
  if ($CursorSnapshot.foreground -and (
    $CursorSnapshot.foreground.isUsable -eq $false -or
    $CursorSnapshot.foreground.isVisible -eq $false -or
    $CursorSnapshot.foreground.isMinimized -eq $true -or
    $CursorSnapshot.foreground.isCloaked -eq $true
  )) { return $false }
  if (-not $ForegroundSnapshot -or -not $ForegroundSnapshot.probeOk) { return $true }
  $foregroundProfile = if ($ForegroundSnapshot.foreground.detectedToolProfile) { $ForegroundSnapshot.foreground.detectedToolProfile } else { "unknown" }
  $cursorProfile = if ($CursorSnapshot.foreground.detectedToolProfile) { $CursorSnapshot.foreground.detectedToolProfile } else { "unknown" }
  $foregroundCandidates = if ($ForegroundSnapshot.summary) { [int]$ForegroundSnapshot.summary.candidateCount } else { 0 }
  $cursorCandidates = if ($CursorSnapshot.summary) { [int]$CursorSnapshot.summary.candidateCount } else { 0 }
  if ($foregroundProfile -eq "unknown" -and $cursorProfile -ne "unknown") { return $true }
  if ($foregroundProfile -eq "unknown" -and $cursorCandidates -gt $foregroundCandidates) { return $true }
  return $false
}

function Test-PreferKnownToolWindowSnapshot {
  param([object]$ForegroundSnapshot, [object]$KnownToolSnapshot)
  if (-not $KnownToolSnapshot -or -not $KnownToolSnapshot.probeOk) { return $false }
  if ($KnownToolSnapshot.foreground -and (
    $KnownToolSnapshot.foreground.isUsable -eq $false -or
    $KnownToolSnapshot.foreground.isVisible -eq $false -or
    $KnownToolSnapshot.foreground.isMinimized -eq $true -or
    $KnownToolSnapshot.foreground.isCloaked -eq $true
  )) { return $false }
  $knownToolProfile = if ($KnownToolSnapshot.foreground.detectedToolProfile) { $KnownToolSnapshot.foreground.detectedToolProfile } else { "unknown" }
  if ($knownToolProfile -eq "unknown") { return $false }
  if (-not $ForegroundSnapshot -or -not $ForegroundSnapshot.probeOk) { return $true }
  $foregroundProfile = if ($ForegroundSnapshot.foreground.detectedToolProfile) { $ForegroundSnapshot.foreground.detectedToolProfile } else { "unknown" }
  if ($foregroundProfile -ne "unknown") { return $false }
  $foregroundProcess = if ($ForegroundSnapshot.foreground.processName) { $ForegroundSnapshot.foreground.processName } else { "" }
  $foregroundTitleLength = if ($ForegroundSnapshot.foreground.titleLength) { [int]$ForegroundSnapshot.foreground.titleLength } else { 0 }
  $foregroundTitleHash = if ($ForegroundSnapshot.foreground.titleHash) { $ForegroundSnapshot.foreground.titleHash } else { "" }
  $foregroundCandidates = if ($ForegroundSnapshot.summary) { [int]$ForegroundSnapshot.summary.candidateCount } else { 0 }
  $foregroundSafeCandidates = if ($ForegroundSnapshot.summary -and $null -ne $ForegroundSnapshot.summary.safeCandidateCount) { [int]$ForegroundSnapshot.summary.safeCandidateCount } else { $foregroundCandidates }
  if ($foregroundSafeCandidates -gt 0) { return $false }
  return [bool](Test-IsSystemShellWindow -ProcessName $foregroundProcess -WindowTitle $(if ($foregroundTitleLength -gt 0 -and $foregroundTitleHash) { "Backstop Window" } else { "" }))
}

function Test-IsWindowCloaked {
  param([IntPtr]$Handle)
  try {
    $cloaked = 0
    $result = [Win32Native]::DwmGetWindowAttribute($Handle, 14, [ref]$cloaked, 4)
    return [bool]($result -eq 0 -and $cloaked -ne 0)
  } catch {
    return $false
  }
}

function Get-WindowVisibilityContext {
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
    $rect = New-Object SmartPromptRect
    $hasRect = [Win32Native]::GetWindowRect($Handle, [ref]$rect)
    $width = if ($hasRect) { [int]$rect.Right - [int]$rect.Left } else { 0 }
    $height = if ($hasRect) { [int]$rect.Bottom - [int]$rect.Top } else { 0 }
    $isVisible = [Win32Native]::IsWindowVisible($Handle)
    $isMinimized = [Win32Native]::IsIconic($Handle)
    $isCloaked = Test-IsWindowCloaked -Handle $Handle
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

function Get-CursorKnownToolWindow {
  try {
    $point = New-Object SmartPromptPoint
    $ok = [Win32Native]::GetCursorPos([ref]$point)
    if (-not $ok) { return $null }
    $script:SmartPromptSelectedCursorToolWindow = $null
    $callback = [SmartPromptEnumWindowsProc]{
      param([IntPtr]$WindowHandle, [IntPtr]$Param)
      if (-not [Win32Native]::IsWindowVisible($WindowHandle)) { return $true }
      if ([Win32Native]::IsIconic($WindowHandle)) { return $true }
      if (Test-IsWindowCloaked -Handle $WindowHandle) { return $true }
      $rect = New-Object SmartPromptRect
      if (-not [Win32Native]::GetWindowRect($WindowHandle, [ref]$rect)) { return $true }
      $width = [int]$rect.Right - [int]$rect.Left
      $height = [int]$rect.Bottom - [int]$rect.Top
      if ($width -lt 220 -or $height -lt 160) { return $true }
      if ([int]$point.X -lt [int]$rect.Left -or [int]$point.X -ge [int]$rect.Right -or [int]$point.Y -lt [int]$rect.Top -or [int]$point.Y -ge [int]$rect.Bottom) { return $true }
      $windowProcessId = 0
      [void][Win32Native]::GetWindowThreadProcessId($WindowHandle, [ref]$windowProcessId)
      if ($windowProcessId -le 0) { return $true }
      $processName = ""
      $executablePath = ""
      try {
        $process = Get-Process -Id $windowProcessId -ErrorAction Stop
        $processName = $process.ProcessName
        $executablePath = [string]$process.Path
      } catch {
        $processName = ""
        $executablePath = ""
      }
      $title = Get-WindowTextSafe -Handle $WindowHandle
      if (Test-IsSystemShellWindow -ProcessName $processName -WindowTitle $title) { return $true }
      $profile = Get-ToolProfile -ProcessName $processName -WindowTitle $title -ChildProcessNames @() -ExecutablePath $executablePath
      if ($profile -eq "unknown") { return $true }
      $script:SmartPromptSelectedCursorToolWindow = [pscustomobject]@{
        handle = $WindowHandle
        processName = $processName
        detectedToolProfile = $profile
        titleLength = $title.Length
        titleHash = Get-HashText $title
        boundingRect = New-RectObject -X $rect.Left -Y $rect.Top -Width $width -Height $height
      }
      return $false
    }
    [void][Win32Native]::EnumWindows($callback, [IntPtr]::Zero)
    return $script:SmartPromptSelectedCursorToolWindow
  } catch {
    return $null
  }
}

function New-VisualWebViewCandidate {
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
    index = [int]$Index
    controlType = "VisualWebViewComposer"
    nameHash = ""
    automationIdHash = ""
    classNameHash = Get-HashText "visual-webview-composer"
    isKeyboardFocusable = $true
    isEnabled = $true
    hasValuePattern = $false
    hasTextPattern = $false
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

function Get-UiaSnapshot {
  param([IntPtr]$Handle, [bool]$IsSelfTest, [string]$ExpectedToolProfile = "")

  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes

  if ($Handle -eq [IntPtr]::Zero) {
    return [pscustomobject]@{
      schemaVersion = "m3-windows-uia@1"
      createdAt = (Get-Date).ToUniversalTime().ToString("o")
      platform = "win32"
      selfTest = $IsSelfTest
      selfTestProfile = if ($IsSelfTest) { $ExpectedToolProfile } else { "" }
      probeOk = $false
      pass = $false
      reason = "foreground_window_unavailable"
      foreground = [pscustomobject]@{
        processName = ""
        pidPresent = $false
        isVisible = $false
        isMinimized = $false
        isCloaked = $false
        isUsable = $false
        boundingRect = New-RectObject -X 0 -Y 0 -Width 0 -Height 0
        titleLength = 0
        titleHash = ""
        detectedToolProfile = "unknown"
        expectedToolProfile = $ExpectedToolProfile
        expectedToolProfileMatched = $false
        childProcessCount = 0
        childToolProcessHintPresent = $false
      }
      caret = Get-CaretContext
      cursor = Get-CursorContext
      supportedToolProfiles = @("codex", "claude-code", "hermes", "workbuddy", "trae")
      candidates = @()
      summary = [pscustomobject]@{
        candidateCount = 0
        valuePatternCandidates = 0
        textPatternCandidates = 0
        focusableCandidates = 0
        safeCandidateCount = 0
        focusedCandidateCount = 0
        caretCandidateCount = 0
        semanticCandidateCount = 0
        traversalTimedOut = $false
        inspectedElementCount = 0
        bestCandidateIndex = -1
        bestCandidateScore = 0
        caretVisible = $false
        caretWindowPresent = $false
        detectedToolProfile = "unknown"
      }
      privacy = [pscustomObject]@{
        titleRedacted = $true
        elementNamesHashed = $true
        elementValuesNotRead = $true
        caretTextNotRead = $true
        promptTextNotRead = $true
      }
    }
  }

  $title = Get-WindowTextSafe -Handle $Handle
  $processId = 0
  [void][Win32Native]::GetWindowThreadProcessId($Handle, [ref]$processId)
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
  $toolProfile = Get-ToolProfile -ProcessName $processName -WindowTitle $title -ChildProcessNames $relatedProcessNames -ExecutablePath $executablePath
  $windowVisibility = Get-WindowVisibilityContext -Handle $Handle
  $caret = Get-CaretContext
  $cursor = Get-CursorContext
  try {
    $rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($Handle)
  } catch {
    return [pscustomobject]@{
      schemaVersion = "m3-windows-uia@1"
      createdAt = (Get-Date).ToUniversalTime().ToString("o")
      platform = "win32"
      selfTest = $IsSelfTest
      selfTestProfile = if ($IsSelfTest) { $ExpectedToolProfile } else { "" }
      probeOk = $false
      pass = $false
      reason = "uia_root_unavailable"
      foreground = [pscustomobject]@{
        processName = $processName
        pidPresent = $processId -gt 0
        isVisible = [bool]$windowVisibility.isVisible
        isMinimized = [bool]$windowVisibility.isMinimized
        isCloaked = [bool]$windowVisibility.isCloaked
        isUsable = [bool]$windowVisibility.isUsable
        boundingRect = $windowVisibility.boundingRect
        titleLength = $title.Length
        titleHash = Get-HashText $title
        detectedToolProfile = $toolProfile
        expectedToolProfile = $ExpectedToolProfile
        expectedToolProfileMatched = [bool](-not $ExpectedToolProfile -or $toolProfile -eq $ExpectedToolProfile)
        childProcessCount = $relatedProcessNames.Count
        childToolProcessHintPresent = Test-RelatedToolProcessHintPresent -ProcessName $processName -WindowTitle $title -RelatedProcessNames $relatedProcessNames
      }
      caret = $caret
      cursor = $cursor
      supportedToolProfiles = @("codex", "claude-code", "hermes", "workbuddy", "trae")
      candidates = @()
      summary = [pscustomobject]@{
        candidateCount = 0
        valuePatternCandidates = 0
        textPatternCandidates = 0
        focusableCandidates = 0
        safeCandidateCount = 0
        focusedCandidateCount = 0
        caretCandidateCount = 0
        semanticCandidateCount = 0
        traversalTimedOut = $false
        inspectedElementCount = 0
        bestCandidateIndex = -1
        bestCandidateScore = 0
        caretVisible = [bool]$caret.visible
        caretWindowPresent = [bool]$caret.windowHandlePresent
        detectedToolProfile = $toolProfile
      }
      privacy = [pscustomObject]@{
        titleRedacted = $true
        elementNamesHashed = $true
        elementValuesNotRead = $true
        caretTextNotRead = $true
        promptTextNotRead = $true
      }
    }
  }

  $elements = @()
  $rootRect = $null
  $visualRootRect = $null
  $focusedRuntimeId = ""
  try {
    $focusedRuntimeId = Get-RuntimeIdKey ([System.Windows.Automation.AutomationElement]::FocusedElement)
  } catch {
    $focusedRuntimeId = ""
  }
  $script:SmartPromptTraversalTimedOut = $false
  $script:SmartPromptTraversalInspected = 0
  if ($rootElement) {
    $rootBounds = $rootElement.Current.BoundingRectangle
    $rootRect = New-RectObject -X $rootBounds.X -Y $rootBounds.Y -Width $rootBounds.Width -Height $rootBounds.Height
    $visualRootRect = if (($toolProfile -in @("workbuddy", "trae")) -and $windowVisibility -and $windowVisibility.boundingRect -and [int]$windowVisibility.boundingRect.width -gt 0) {
      $windowVisibility.boundingRect
    } else {
      $rootRect
    }
    $toInspect = @(Get-BoundedUiaElements -RootElement $rootElement -MaxElements 300 -TimeoutMs 3500)
    $index = 0
    foreach ($element in $toInspect) {
      if ($index -ge 300) { break }
      $index += 1
      $controlType = $element.Current.ControlType.ProgrammaticName
      $className = $element.Current.ClassName
      $valuePattern = $null
      $textPattern = $null
      $hasValue = $element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)
      $hasText = $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)
      $isTextInput = $controlType -in @("ControlType.Edit", "ControlType.Document") -or $hasValue -or $hasText -or $className -match "(?i)edit|text"
      if (-not $isTextInput) { continue }
      $rect = $element.Current.BoundingRectangle
      $rectObject = New-RectObject -X $rect.X -Y $rect.Y -Width $rect.Width -Height $rect.Height
      $nativeHandle = [IntPtr]$element.Current.NativeWindowHandle
      $signals = Get-InputSignals -Element $element -Rect $rectObject -RootRect $rootRect -FocusedRuntimeId $focusedRuntimeId -Caret $caret -Cursor $cursor -ControlType $controlType -ClassName $className -HasValuePattern ([bool]$hasValue) -HasTextPattern ([bool]$hasText) -NativeWindowHandle $nativeHandle
      if ($toolProfile -in @("workbuddy", "trae") -and -not $IsSelfTest) {
        $semanticComposerHint = Test-ToolProfileComposerSemanticHint -ToolProfile $toolProfile -Elements $toInspect -Rect $rectObject
        if ($semanticComposerHint) {
          $signals.score = [int]$signals.score + 25
        }
        $signals | Add-Member -NotePropertyName semanticComposerHint -NotePropertyValue ([bool]$semanticComposerHint) -Force
        $profileComposerCandidate = Test-ToolProfileComposerCandidate -ToolProfile $toolProfile -Rect $rectObject -Signals $signals
        if (-not $profileComposerCandidate) {
          $signals.score = [int]$signals.score - 120
        }
        $signals | Add-Member -NotePropertyName profileComposerCandidate -NotePropertyValue $profileComposerCandidate -Force
      }
      $elements += [pscustomobject]@{
        index = $elements.Count
        controlType = $controlType
        nameHash = ""
        automationIdHash = Get-HashText $element.Current.AutomationId
        classNameHash = Get-HashText $className
        isKeyboardFocusable = [bool]$element.Current.IsKeyboardFocusable
        isEnabled = [bool]$element.Current.IsEnabled
        hasValuePattern = [bool]$hasValue
        hasTextPattern = [bool]$hasText
        boundingRect = $rectObject
        inputSignals = $signals
      }
    }
  }

  $preVisualSafeCandidatePool = @(if ($toolProfile -in @("workbuddy", "trae") -and -not $IsSelfTest) {
    $elements | Where-Object { $_.inputSignals.profileComposerCandidate }
  } else {
    $elements | Where-Object { Test-PreferredWritableInputCandidate -Candidate $_ }
  })
  if ($preVisualSafeCandidatePool.Count -eq 0 -and $toolProfile -in @("codex", "workbuddy", "trae") -and -not $IsSelfTest) {
    $visualAnchor = @(Get-VisualWebViewAnchorCandidate -Candidates $elements -ToolProfile $toolProfile | Select-Object -First 1)
    $visualAnchorRect = if ($visualAnchor.Count -gt 0) { $visualAnchor[0].boundingRect } else { $null }
    $visualCandidate = New-VisualWebViewCandidate -ToolProfile $toolProfile -RootRect $visualRootRect -Caret $caret -Cursor $cursor -Index $elements.Count -AnchorRect $visualAnchorRect
    if ($visualCandidate -and [bool]$visualCandidate.inputSignals.profileComposerCandidate) {
      $elements += $visualCandidate
    }
  }
  $candidateCount = $elements.Count
  $safeCandidatePool = @(if ($toolProfile -in @("workbuddy", "trae") -and -not $IsSelfTest) {
    $elements | Where-Object { $_.inputSignals.profileComposerCandidate }
  } else {
    $elements | Where-Object { Test-PreferredWritableInputCandidate -Candidate $_ }
  })
  $toolProfileMatched = -not $ExpectedToolProfile -or $toolProfile -eq $ExpectedToolProfile
  $bestCandidate = @($safeCandidatePool | Sort-Object @{ Expression = { [int]$_.inputSignals.score }; Descending = $true }, @{ Expression = { [int]$_.index }; Ascending = $true } | Select-Object -First 1)
  return [pscustomobject]@{
    schemaVersion = "m3-windows-uia@1"
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    platform = "win32"
    selfTest = $IsSelfTest
    selfTestProfile = if ($IsSelfTest) { $ExpectedToolProfile } else { "" }
    probeOk = [bool]$rootElement
    pass = [bool]($rootElement -and (-not $IsSelfTest -or ($candidateCount -gt 0 -and $toolProfileMatched)))
    foreground = [pscustomobject]@{
      processName = $processName
      pidPresent = $processId -gt 0
      isVisible = [bool]$windowVisibility.isVisible
      isMinimized = [bool]$windowVisibility.isMinimized
      isCloaked = [bool]$windowVisibility.isCloaked
      isUsable = [bool]$windowVisibility.isUsable
      boundingRect = $windowVisibility.boundingRect
      titleLength = $title.Length
      titleHash = Get-HashText $title
      detectedToolProfile = $toolProfile
      expectedToolProfile = $ExpectedToolProfile
      expectedToolProfileMatched = [bool]$toolProfileMatched
      childProcessCount = $relatedProcessNames.Count
      childToolProcessHintPresent = Test-RelatedToolProcessHintPresent -ProcessName $processName -WindowTitle $title -RelatedProcessNames $relatedProcessNames
    }
    caret = $caret
    cursor = $cursor
    supportedToolProfiles = @("codex", "claude-code", "hermes", "workbuddy", "trae")
    candidates = $elements
    summary = [pscustomobject]@{
      candidateCount = $candidateCount
      valuePatternCandidates = @($elements | Where-Object { $_.hasValuePattern }).Count
      textPatternCandidates = @($elements | Where-Object { $_.hasTextPattern }).Count
      focusableCandidates = @($elements | Where-Object { $_.isKeyboardFocusable }).Count
      safeCandidateCount = $safeCandidatePool.Count
      focusedCandidateCount = @($elements | Where-Object { $_.inputSignals.hasKeyboardFocus -or $_.inputSignals.focusedElementMatch }).Count
      caretCandidateCount = @($elements | Where-Object { $_.inputSignals.caretWithinBounds -or $_.inputSignals.caretWindowMatch }).Count
      semanticCandidateCount = @($elements | Where-Object { $_.inputSignals.semanticComposerHint }).Count
      traversalTimedOut = [bool]$script:SmartPromptTraversalTimedOut
      inspectedElementCount = [int]$script:SmartPromptTraversalInspected
      bestCandidateIndex = if ($bestCandidate.Count -gt 0) { [int]$bestCandidate[0].index } else { -1 }
      bestCandidateScore = if ($bestCandidate.Count -gt 0) { [int]$bestCandidate[0].inputSignals.score } else { 0 }
      caretVisible = [bool]$caret.visible
      caretWindowPresent = [bool]$caret.windowHandlePresent
      detectedToolProfile = $toolProfile
    }
    privacy = [pscustomobject]@{
      titleRedacted = $true
      elementNamesHashed = $true
      elementValuesNotRead = $true
      caretTextNotRead = $true
      promptTextNotRead = $true
    }
  }
}

if ($env:OS -notlike "*Windows*") {
  $reportObject = [pscustomobject]@{
    schemaVersion = "m3-windows-uia@1"
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    platform = $PSVersionTable.Platform
    selfTest = [bool]$SelfTest
    probeOk = $false
    pass = $false
    reason = "windows_uia_only"
    supportedToolProfiles = @("codex", "claude-code", "hermes", "workbuddy", "trae")
    candidates = @()
    privacy = [pscustomobject]@{
      titleRedacted = $true
      elementNamesHashed = $true
      elementValuesNotRead = $true
      caretTextNotRead = $true
      promptTextNotRead = $true
    }
  }
} else {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public delegate bool SmartPromptEnumWindowsProc(IntPtr hWnd, IntPtr lParam);
public struct SmartPromptRect {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}
public struct SmartPromptPoint {
  public int X;
  public int Y;
}
public struct SmartPromptGuiThreadInfo {
  public int cbSize;
  public int flags;
  public IntPtr hwndActive;
  public IntPtr hwndFocus;
  public IntPtr hwndCapture;
  public IntPtr hwndMenuOwner;
  public IntPtr hwndMoveSize;
  public IntPtr hwndCaret;
  public SmartPromptRect rcCaret;
}
public static class Win32Native {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out SmartPromptPoint lpPoint);
  [DllImport("user32.dll")]
  public static extern IntPtr WindowFromPoint(SmartPromptPoint point);
  [DllImport("user32.dll")]
  public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern bool GetGUIThreadInfo(uint idThread, ref SmartPromptGuiThreadInfo pgui);
  [DllImport("user32.dll")]
  public static extern bool ClientToScreen(IntPtr hWnd, ref SmartPromptPoint lpPoint);
  [DllImport("user32.dll")]
  public static extern bool EnumWindows(SmartPromptEnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out SmartPromptRect lpRect);
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);
}
"@

  $form = $null
  try {
    if ($SelfTest) {
      Add-Type -AssemblyName System.Windows.Forms
      $form = New-Object System.Windows.Forms.Form
      $form.Text = Get-SelfTestTitle -Profile $SelfTestProfile
      $form.Width = 520
      $form.Height = 160
      $textbox = New-Object System.Windows.Forms.TextBox
      $textbox.Multiline = $true
      $textbox.Left = 16
      $textbox.Top = 16
      $textbox.Width = 470
      $textbox.Height = 72
      $textbox.Text = "M3 UIA self test input"
      $form.Controls.Add($textbox)
      $form.Show()
      [void][System.Windows.Forms.Application]::DoEvents()
      [void]$form.Activate()
      [void]$textbox.Focus()
      Start-Sleep -Milliseconds 250
      [void][System.Windows.Forms.Application]::DoEvents()
      $handle = $form.Handle
      $reportObject = Get-UiaSnapshot -Handle $handle -IsSelfTest $true -ExpectedToolProfile $SelfTestProfile
    } else {
      $handle = [Win32Native]::GetForegroundWindow()
      $reportObject = Get-UiaSnapshot -Handle $handle -IsSelfTest $false
      $cursorHandle = Get-CursorRootWindow
      if ($cursorHandle -ne [IntPtr]::Zero -and $cursorHandle -ne $handle) {
        $cursorReport = Get-UiaSnapshot -Handle $cursorHandle -IsSelfTest $false
        if (Test-PreferCursorSnapshot -ForegroundSnapshot $reportObject -CursorSnapshot $cursorReport) {
          $originalForegroundProfile = if ($reportObject.foreground.detectedToolProfile) { $reportObject.foreground.detectedToolProfile } else { "unknown" }
          $reportObject = $cursorReport
          $reportObject | Add-Member -NotePropertyName selection -NotePropertyValue ([pscustomobject]@{
            source = "cursor_window_fallback"
            foregroundProfile = $originalForegroundProfile
            cursorProfile = if ($cursorReport.foreground.detectedToolProfile) { $cursorReport.foreground.detectedToolProfile } else { "unknown" }
          }) -Force
        }
      }
      $knownToolWindow = Get-CursorKnownToolWindow
      if ($knownToolWindow -and $knownToolWindow.handle -ne [IntPtr]::Zero -and $knownToolWindow.handle -ne $handle) {
        $knownToolReport = Get-UiaSnapshot -Handle $knownToolWindow.handle -IsSelfTest $false
        if (Test-PreferKnownToolWindowSnapshot -ForegroundSnapshot $reportObject -KnownToolSnapshot $knownToolReport) {
          $originalForegroundProfile = if ($reportObject.foreground.detectedToolProfile) { $reportObject.foreground.detectedToolProfile } else { "unknown" }
          $reportObject = $knownToolReport
          $reportObject | Add-Member -NotePropertyName selection -NotePropertyValue ([pscustomobject]@{
            source = "cursor_known_tool_window_fallback"
            foregroundProfile = $originalForegroundProfile
            cursorProfile = if ($knownToolReport.foreground.detectedToolProfile) { $knownToolReport.foreground.detectedToolProfile } else { "unknown" }
            titleHash = $knownToolWindow.titleHash
          }) -Force
        }
      }
    }
  } finally {
    if ($form) {
      $form.Close()
      $form.Dispose()
    }
  }
}

$json = $reportObject | ConvertTo-Json -Depth 8
if (-not $JsonOnly) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Report) | Out-Null
  Set-Content -Path $Report -Value $json -Encoding UTF8
  Write-Host "M3 desktop input report: $Report"
}
Write-Output $json

if (-not $reportObject.pass) {
  exit 1
}
