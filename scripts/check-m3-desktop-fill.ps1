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
    supportedToolProfiles = @("codex", "claude-code", "hermes")
    privacy = New-Privacy
  }
}

function Get-ToolProfile {
  param([string]$ProcessName, [string]$WindowTitle, [string[]]$ChildProcessNames = @())
  $haystack = "$ProcessName $WindowTitle " + (($ChildProcessNames | ForEach-Object { [string]$_ }) -join " ")
  if ($haystack -match "(?i)claude[\s-]*code") { return "claude-code" }
  if ($haystack -match "(?i)\bclaude\b") { return "claude-code" }
  if ($haystack -match "(?i)\bcodex\b|openai[\s-]*codex") { return "codex" }
  if ($haystack -match "(?i)\bhermes\b") { return "hermes" }
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
  } catch {}
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
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool SetWindowText(IntPtr hWnd, string lpString);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool GetGUIThreadInfo(uint idThread, ref SmartPromptFillGuiThreadInfo pgui);
  [DllImport("user32.dll")]
  public static extern bool ClientToScreen(IntPtr hWnd, ref SmartPromptFillPoint lpPoint);
}
"@
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
    nearWindowBottom = [bool]$nearWindowBottom
    broadDocument = [bool]$broadDocument
  }
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
    Start-Sleep -Milliseconds 120
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

function Get-ForegroundContext {
  $handle = [SmartPromptFillNative]::GetForegroundWindow()
  $title = Get-WindowTextSafe -Handle $handle
  $processId = 0
  [void][SmartPromptFillNative]::GetWindowThreadProcessId($handle, [ref]$processId)
  $processName = ""
  if ($processId -gt 0) {
    try {
      $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
    } catch {
      $processName = ""
    }
  }
  $childProcessNames = if ($processId -gt 0) { @(Get-ChildProcessNames -ProcessId $processId) } else { @() }
  return [pscustomobject]@{
    handle = $handle
    title = $title
    processName = $processName
    processIdPresent = $processId -gt 0
    titleHash = Get-HashText $title
    titleLength = $title.Length
    childProcessCount = $childProcessNames.Count
    childToolProcessHintPresent = [bool](($childProcessNames -join " ") -match "(?i)\bcodex\b|\bclaude\b|\bhermes\b")
    detectedToolProfile = Get-ToolProfile -ProcessName $processName -WindowTitle $title -ChildProcessNames $childProcessNames
  }
}

function Get-InputCandidates {
  param([System.Windows.Automation.AutomationElement]$RootElement)

  $items = @()
  if (-not $RootElement) { return $items }
  $rootBounds = $RootElement.Current.BoundingRectangle
  $rootRect = New-RectObject -X $rootBounds.X -Y $rootBounds.Y -Width $rootBounds.Width -Height $rootBounds.Height
  $caret = Get-CaretContext
  $focusedRuntimeId = ""
  try {
    $focusedRuntimeId = Get-RuntimeIdKey ([System.Windows.Automation.AutomationElement]::FocusedElement)
  } catch {
    $focusedRuntimeId = ""
  }
  $toInspect = New-Object System.Collections.ArrayList
  [void]$toInspect.Add($RootElement)
  $all = $RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  foreach ($element in $all) {
    [void]$toInspect.Add($element)
  }
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
    $signals = Get-InputSignals -Element $element -Rect $rectObject -RootRect $rootRect -FocusedRuntimeId $focusedRuntimeId -Caret $caret -ControlType $controlType -ClassName $className -HasValuePattern ([bool]$hasValue) -HasTextPattern ([bool]$hasText) -NativeWindowHandle $nativeHandle
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
      supportedToolProfiles = @("codex", "claude-code", "hermes")
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
  $context = Get-ForegroundContext
  $foreground = [pscustomobject]@{
    processName = $context.processName
    pidPresent = [bool]$context.processIdPresent
    titleLength = $context.titleLength
    titleHash = $context.titleHash
    detectedToolProfile = $context.detectedToolProfile
    childProcessCount = $context.childProcessCount
    childToolProcessHintPresent = [bool]$context.childToolProcessHintPresent
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
    foreground = $foreground
    supportedToolProfiles = @("codex", "claude-code", "hermes")
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
  if (-not (@("codex", "claude-code", "hermes") -contains $ExpectedToolProfile)) {
    $base.reason = "foreground_tool_profile_not_supported"
    return [pscustomobject]$base
  }

  $rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($context.handle)
  $candidates = @(Get-InputCandidates -RootElement $rootElement | Where-Object { $_.isEnabled })
  $bestCandidate = @($candidates | Sort-Object @{ Expression = { [int]$_.inputSignals.score }; Descending = $true }, @{ Expression = { [int]$_.index }; Ascending = $true } | Select-Object -First 1)
  $base.summary = [pscustomobject]@{
    candidateCount = $candidates.Count
    focusedCandidateCount = @($candidates | Where-Object { $_.inputSignals.hasKeyboardFocus -or $_.inputSignals.focusedElementMatch }).Count
    caretCandidateCount = @($candidates | Where-Object { $_.inputSignals.caretWithinBounds -or $_.inputSignals.caretWindowMatch }).Count
    bestCandidateIndex = if ($bestCandidate.Count -gt 0) { [int]$bestCandidate[0].index } else { -1 }
    bestCandidateScore = if ($bestCandidate.Count -gt 0) { [int]$bestCandidate[0].inputSignals.score } else { 0 }
    requestedTextLength = $Text.Length
    requestedTextHash = Get-HashText $Text
    verifiedTextLength = 0
    verifiedTextHash = ""
    textPatternVerificationReadLength = 0
    textPatternVerificationTextHash = ""
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
  if ($CandidateIndex -lt 0 -or $CandidateIndex -ge $candidates.Count) {
    $base.reason = "foreground_candidate_index_out_of_range"
    return [pscustomobject]$base
  }

  $candidate = $candidates[$CandidateIndex]
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

  $verifiedText = ""
  if ($candidate.hasNativeWindowHandle) {
    $verifiedText = Get-WindowTextSafe -Handle $candidate.nativeWindowHandle
  }
  $verified = $verifiedText -eq $Text
  if (-not $verified -and $AllowTextPatternVerification -and $candidate.hasTextPattern) {
    $textPatternCheck = Test-TextPatternContains -Candidate $candidate -ExpectedText $Text
    $base.textPatternVerificationTried = [bool]$textPatternCheck.tried
    $base.textPatternVerificationMatched = [bool]$textPatternCheck.matched
    $base.summary.textPatternVerificationReadLength = [int]$textPatternCheck.readLength
    $base.summary.textPatternVerificationTextHash = $textPatternCheck.textHash
    if ($textPatternCheck.matched) {
      $verified = $true
      $verifiedText = $Text
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
