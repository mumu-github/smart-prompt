[CmdletBinding(PositionalBinding = $false)]
param()

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"
$WarningPreference = "SilentlyContinue"
$InformationPreference = "SilentlyContinue"
$ProgressPreference = "SilentlyContinue"
$VerbosePreference = "SilentlyContinue"
$DebugPreference = "SilentlyContinue"
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$script:DriverSchemaVersion = "codex-target-adapter-driver@1"
$script:AllowedKinds = @("inspect", "read_exact", "replace_all_atomic")
$script:HwndPattern = "^0x[0-9a-f]{1,16}$"
$script:HashPattern = "^[a-f0-9]{64}$"

function Write-DriverJson {
  param([Parameter(Mandatory = $true)][object]$Value)
  $json = $Value | ConvertTo-Json -Depth 8 -Compress
  [Console]::Out.WriteLine($json)
}

function New-DriverFailure {
  param(
    [string]$Kind,
    [string]$ReasonToken
  )
  return [pscustomobject][ordered]@{
    schemaVersion = $script:DriverSchemaVersion
    kind = if ($Kind -in $script:AllowedKinds) { $Kind } else { "invalid" }
    driverOk = $false
    reasonToken = $ReasonToken
  }
}

function Test-ObjectProperty {
  param([object]$Value, [string]$Name)
  return [bool]($null -ne $Value -and $null -ne $Value.PSObject.Properties[$Name])
}

function Test-ExactStringArray {
  param([object]$Value, [string[]]$Expected)
  $actual = @($Value)
  if ($actual.Count -ne $Expected.Count) { return $false }
  for ($index = 0; $index -lt $Expected.Count; $index += 1) {
    if ([string]$actual[$index] -cne $Expected[$index]) { return $false }
  }
  return $true
}

function Test-ExpectedContract {
  param([object]$Expected)
  if ($null -eq $Expected) { return $false }
  foreach ($name in @(
    "target",
    "hwnd",
    "pid",
    "runtimeIdentityHash",
    "focusIdentityHash",
    "candidateToken",
    "draftHash"
  )) {
    if (-not (Test-ObjectProperty -Value $Expected -Name $name)) { return $false }
  }
  if ([string]$Expected.target -cne "codex") { return $false }
  if ([string]$Expected.hwnd -notmatch $script:HwndPattern) { return $false }
  if ([int64]$Expected.pid -le 0) { return $false }
  if ([string]$Expected.runtimeIdentityHash -notmatch $script:HashPattern) { return $false }
  if ([string]$Expected.focusIdentityHash -notmatch $script:HashPattern) { return $false }
  if ([string]::IsNullOrWhiteSpace([string]$Expected.candidateToken)) { return $false }
  if ([string]$Expected.draftHash -notmatch $script:HashPattern) { return $false }
  return $true
}

function Test-LeaseContract {
  param([object]$Lease)
  if ($null -eq $Lease) { return $false }
  foreach ($name in @("leaseId", "issuedAtMs", "expiresAtMs", "requireFreshAtCommit")) {
    if (-not (Test-ObjectProperty -Value $Lease -Name $name)) { return $false }
  }
  if ([string]::IsNullOrWhiteSpace([string]$Lease.leaseId)) { return $false }
  if ($Lease.requireFreshAtCommit -isnot [bool] -or $Lease.requireFreshAtCommit -ne $true) {
    return $false
  }
  try {
    $issuedAtMs = [int64]$Lease.issuedAtMs
    $expiresAtMs = [int64]$Lease.expiresAtMs
  } catch {
    return $false
  }
  return [bool]($issuedAtMs -ge 0 -and $expiresAtMs -gt $issuedAtMs)
}

function Test-CommandContract {
  param([object]$Command, [string]$Kind)
  if ($null -eq $Command -or $Kind -notin $script:AllowedKinds) { return $false }

  if ($Kind -eq "inspect") {
    return [bool](
      [string]$Command.target -ceq "codex" -and
      [string]$Command.foregroundSource -ceq "GetForegroundWindow" -and
      $Command.focusedComposerOnly -is [bool] -and $Command.focusedComposerOnly -eq $true -and
      $Command.requireExactRead -is [bool] -and $Command.requireExactRead -eq $true -and
      $Command.requireFullReplace -is [bool] -and $Command.requireFullReplace -eq $true
    )
  }

  if (-not (Test-ExpectedContract -Expected $Command.expected)) { return $false }
  if ($Kind -eq "read_exact") {
    return [bool](
      [string]$Command.scope -ceq "same_focused_composer" -and
      (Test-ExactStringArray -Value $Command.forbidScopes -Expected @("nearby", "root", "chat"))
    )
  }

  if ([string]$Command.operation -notin @("insert", "undo")) { return $false }
  if (-not (Test-ObjectProperty -Value $Command -Name "text") -or $Command.text -isnot [string]) {
    return $false
  }
  if ($Command.preferDirectSetValue -isnot [bool] -or $Command.preferDirectSetValue -ne $true) {
    return $false
  }
  if ($Command.allowClipboardFallback -isnot [bool]) { return $false }
  if ([string]$Command.replacementIntent -cne "full") { return $false }
  if ($Command.noSubmit -isnot [bool] -or $Command.noSubmit -ne $true) { return $false }
  if (-not (Test-ExactStringArray -Value $Command.prohibitedActions -Expected @("enter", "submit", "send"))) {
    return $false
  }
  if ([string]$Command.operation -eq "insert") {
    return Test-LeaseContract -Lease $Command.leaseFreshness
  }
  return $null -eq $Command.leaseFreshness
}

function Get-Sha256Hex {
  param([AllowEmptyString()][string]$Text)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    return ([System.BitConverter]::ToString($sha.ComputeHash($bytes)) -replace "-", "").ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Format-Hwnd {
  param([IntPtr]$Handle)
  if ($Handle -eq [IntPtr]::Zero) { return "0x0000000000000000" }
  return "0x{0:x16}" -f [uint64]$Handle.ToInt64()
}

function Get-RuntimeKey {
  param([object]$Element)
  if ($null -eq $Element) { return "" }
  try {
    $runtimeId = @($Element.GetRuntimeId())
    if ($runtimeId.Count -eq 0) { return "" }
    return (($runtimeId | ForEach-Object { [string][int]$_ }) -join ".")
  } catch {
    return ""
  }
}

function Test-ElementOwnedByRoot {
  param([object]$Element, [object]$RootElement)
  if ($null -eq $Element -or $null -eq $RootElement) { return $false }
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $current = $Element
  for ($depth = 0; $depth -lt 64 -and $null -ne $current; $depth += 1) {
    if ($current.Equals($RootElement)) { return $true }
    try {
      $current = $walker.GetParent($current)
    } catch {
      return $false
    }
  }
  return $false
}

function New-ContextFailure {
  param([string]$ReasonToken)
  return [pscustomobject]@{
    Ready = $false
    ReasonToken = $ReasonToken
  }
}

function Get-ForegroundCodexContext {
  $handle = [SmartPromptCodexTargetNative]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) { return New-ContextFailure -ReasonToken "target_missing" }

  $processId = 0
  [void][SmartPromptCodexTargetNative]::GetWindowThreadProcessId($handle, [ref]$processId)
  if ($processId -le 0) { return New-ContextFailure -ReasonToken "target_missing_pid" }

  try {
    $process = Get-Process -Id $processId -ErrorAction Stop
  } catch {
    return New-ContextFailure -ReasonToken "target_missing_pid"
  }
  $isTrustedPackagedCodex = [bool](
    [string]$process.ProcessName -ieq "ChatGPT" -and
    (Test-SmartPromptTrustedExecutableProfile -ToolProfile "codex" -ExecutablePath ([string]$process.Path))
  )
  if ([string]$process.ProcessName -ine "Codex" -and -not $isTrustedPackagedCodex) {
    return New-ContextFailure -ReasonToken "unsupported_target"
  }

  $isVisible = [bool][SmartPromptCodexTargetNative]::IsWindowVisible($handle)
  $isMinimized = [bool][SmartPromptCodexTargetNative]::IsIconic($handle)
  $rootHandle = [SmartPromptCodexTargetNative]::GetAncestor($handle, 2)
  $ownerHandle = [SmartPromptCodexTargetNative]::GetWindow($handle, 4)
  $isTopLevel = [bool]($rootHandle -eq $handle -and $ownerHandle -eq [IntPtr]::Zero)

  $cloaked = 1
  $dwmStatus = [SmartPromptCodexTargetNative]::DwmGetWindowAttribute($handle, 14, [ref]$cloaked, 4)
  $isCloaked = [bool]($dwmStatus -ne 0 -or $cloaked -ne 0)
  if (-not $isVisible -or $isMinimized -or $isCloaked) {
    return New-ContextFailure -ReasonToken "target_missing_hidden"
  }
  if (-not $isTopLevel) {
    return New-ContextFailure -ReasonToken "unsupported_target_main_window"
  }

  try {
    $rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    $rootProcessId = [int]$rootElement.Current.ProcessId
    $rootControlType = [string]$rootElement.Current.ControlType.ProgrammaticName
    $rootBounds = $rootElement.Current.BoundingRectangle
  } catch {
    return New-ContextFailure -ReasonToken "target_missing_uia_root"
  }
  if ($null -eq $rootElement -or $rootProcessId -ne $processId -or $rootControlType -cne "ControlType.Window") {
    return New-ContextFailure -ReasonToken "unsupported_target_main_window"
  }
  if ($rootBounds.Width -le 0 -or $rootBounds.Height -le 0) {
    return New-ContextFailure -ReasonToken "target_missing_hidden"
  }

  $rootRuntimeKey = Get-RuntimeKey -Element $rootElement
  if (-not $rootRuntimeKey) { return New-ContextFailure -ReasonToken "target_missing_uia_root" }
  try {
    $startTicks = $process.StartTime.ToUniversalTime().Ticks
  } catch {
    return New-ContextFailure -ReasonToken "target_missing_runtime_identity"
  }
  $hwnd = Format-Hwnd -Handle $handle
  $runtimeIdentityHash = Get-Sha256Hex -Text ("codex-runtime-v1`n{0}`n{1}`n{2}`n{3}" -f $hwnd, $processId, $startTicks, $rootRuntimeKey)

  return [pscustomobject]@{
    Ready = $true
    ReasonToken = "ready"
    Handle = $handle
    Hwnd = $hwnd
    Pid = [int]$processId
    IsVisible = $isVisible
    IsMinimized = $isMinimized
    IsCloaked = $isCloaked
    IsMainWindow = $isTopLevel
    RootElement = $rootElement
    RootBounds = $rootBounds
    RuntimeIdentityHash = $runtimeIdentityHash
  }
}

function Get-FocusedComposerDescendantFallback {
  param([object]$Context)

  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue = New-Object System.Collections.Queue
  $matches = New-Object System.Collections.Generic.List[object]
  $queue.Enqueue($Context.RootElement)
  $inspected = 0
  $maxInspected = 1024

  while ($queue.Count -gt 0 -and $inspected -lt $maxInspected) {
    $node = $queue.Dequeue()
    $inspected += 1
    if (-not [object]::ReferenceEquals($node, $Context.RootElement)) {
      try {
        $controlType = [string]$node.Current.ControlType.ProgrammaticName
        if (
          $node.Current.ProcessId -eq $Context.Pid -and
          $node.Current.HasKeyboardFocus -and
          $node.Current.IsEnabled -and
          $node.Current.IsKeyboardFocusable -and
          -not $node.Current.IsOffscreen -and
          -not $node.Current.IsPassword -and
          $controlType -in @("ControlType.Edit", "ControlType.Document", "ControlType.Group")
        ) {
          [void]$matches.Add($node)
        }
      } catch {}
    }

    try {
      $child = $walker.GetFirstChild($node)
      while ($null -ne $child) {
        $queue.Enqueue($child)
        $child = $walker.GetNextSibling($child)
      }
    } catch {}
  }

  if ($queue.Count -gt 0 -or $matches.Count -ne 1) { return $null }
  return $matches[0]
}

function Get-FocusedComposerMetadata {
  param([object]$Context)
  try {
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  } catch {
    return New-ContextFailure -ReasonToken "focus_required"
  }
  if ($null -eq $focused) { return New-ContextFailure -ReasonToken "focus_required" }

  $focusedMatchesComposerType = $false
  try {
    $focusedMatchesComposerType = [bool](
      $focused.Current.ProcessId -eq $Context.Pid -and
      [string]$focused.Current.ControlType.ProgrammaticName -in
        @("ControlType.Edit", "ControlType.Document", "ControlType.Group")
    )
  } catch {
    $focusedMatchesComposerType = $false
  }
  if (-not $focusedMatchesComposerType) {
    $focused = Get-FocusedComposerDescendantFallback -Context $Context
    if ($null -eq $focused) { return New-ContextFailure -ReasonToken "focus_required" }
  }

  try {
    $processId = [int]$focused.Current.ProcessId
    $hasKeyboardFocus = [bool]$focused.Current.HasKeyboardFocus
    $isEnabled = [bool]$focused.Current.IsEnabled
    $isKeyboardFocusable = [bool]$focused.Current.IsKeyboardFocusable
    $isOffscreen = [bool]$focused.Current.IsOffscreen
    $isPassword = [bool]$focused.Current.IsPassword
    $controlType = [string]$focused.Current.ControlType.ProgrammaticName
    $bounds = $focused.Current.BoundingRectangle
  } catch {
    return New-ContextFailure -ReasonToken "focus_required"
  }
  if ($processId -ne $Context.Pid -or -not $hasKeyboardFocus -or -not $isEnabled -or $isOffscreen -or $isPassword) {
    return New-ContextFailure -ReasonToken "focus_required"
  }
  if (-not (Test-ElementOwnedByRoot -Element $focused -RootElement $Context.RootElement)) {
    return New-ContextFailure -ReasonToken "target_changed_composer_owner"
  }
  if ($controlType -notin @("ControlType.Edit", "ControlType.Document", "ControlType.Group")) {
    return New-ContextFailure -ReasonToken "safety_focused_composer_identity_required"
  }

  $root = $Context.RootBounds
  $candidateBottom = [double]$bounds.Y + [double]$bounds.Height
  $candidateRight = [double]$bounds.X + [double]$bounds.Width
  $rootBottom = [double]$root.Y + [double]$root.Height
  $rootRight = [double]$root.X + [double]$root.Width
  # The 420px composer-height cap encodes a 96-DPI logical intent; UIA bounds
  # are physical pixels, so scale the cap by the target window DPI. At 96 DPI
  # the behavior is unchanged (420); at 200% DPI the physical cap is 840.
  $windowDpi = [int][SmartPromptCodexTargetNative]::GetDpiForWindow($Context.Handle)
  if ($windowDpi -le 0) { $windowDpi = 96 }
  $dpiScale = [double]$windowDpi / 96.0
  $maxHeight = [Math]::Min(420.0 * $dpiScale, [double]$root.Height * 0.45)
  $baseGeometryMatched = [bool](
    $bounds.Width -ge 120 -and
    $bounds.Height -ge 24 -and
    $bounds.X -ge ($root.X - 2) -and
    $candidateRight -le ($rootRight + 2)
  )
  $compactGeometryMatched = [bool](
    $bounds.Height -le $maxHeight -and
    $candidateBottom -le ($rootBottom + 2) -and
    $candidateBottom -ge ($root.Y + ($root.Height * 0.55)) -and
    $bounds.Y -ge ($root.Y + ($root.Height * 0.30))
  )
  $expandedGroupGeometryMatched = [bool](
    $controlType -ceq "ControlType.Group" -and
    $isKeyboardFocusable -and
    $bounds.X -ge ($root.X + ($root.Width * 0.25)) -and
    $bounds.Y -ge ($root.Y + ($root.Height * 0.55)) -and
    $candidateBottom -gt ($rootBottom + 2)
  )
  $geometryMatched = [bool](
    $baseGeometryMatched -and
    ($compactGeometryMatched -or $expandedGroupGeometryMatched)
  )
  if (-not $geometryMatched) {
    return New-ContextFailure -ReasonToken "safety_focused_composer_identity_required"
  }

  $valuePattern = $null
  $textPattern = $null
  $hasValuePattern = $false
  $hasTextPattern = $false
  try {
    $hasValuePattern = [bool]$focused.TryGetCurrentPattern(
      [System.Windows.Automation.ValuePattern]::Pattern,
      [ref]$valuePattern
    )
  } catch {
    $hasValuePattern = $false
    $valuePattern = $null
  }
  try {
    $hasTextPattern = [bool]$focused.TryGetCurrentPattern(
      [System.Windows.Automation.TextPattern]::Pattern,
      [ref]$textPattern
    )
  } catch {
    $hasTextPattern = $false
    $textPattern = $null
  }
  if (-not $hasValuePattern -and -not $hasTextPattern) {
    return New-ContextFailure -ReasonToken "safety_exact_read_required"
  }
  if ($controlType -eq "ControlType.Group" -and (-not $isKeyboardFocusable -or -not $hasTextPattern)) {
    return New-ContextFailure -ReasonToken "safety_focused_composer_identity_required"
  }

  $canSetValue = $false
  if ($hasValuePattern -and $null -ne $valuePattern) {
    try {
      $canSetValue = -not [bool]$valuePattern.Current.IsReadOnly
    } catch {
      $canSetValue = $false
    }
  }
  $runtimeKey = Get-RuntimeKey -Element $focused
  if (-not $runtimeKey) {
    return New-ContextFailure -ReasonToken "safety_focused_composer_identity_required"
  }

  $candidateIdentityHash = Get-Sha256Hex -Text ("codex-composer-v1`n{0}`n{1}`n{2}`n{3}" -f $Context.Hwnd, $Context.Pid, $controlType, $runtimeKey)
  $focusIdentityHash = Get-Sha256Hex -Text ("codex-focus-v1`n{0}" -f $candidateIdentityHash)
  $canControlledClipboard = [bool](
    $isKeyboardFocusable -and
    [System.Threading.Thread]::CurrentThread.GetApartmentState() -eq
    [System.Threading.ApartmentState]::STA
  )

  return [pscustomobject]@{
    Ready = $true
    ReasonToken = "ready"
    Context = $Context
    Element = $focused
    ValuePattern = $valuePattern
    TextPattern = $textPattern
    HasValuePattern = $hasValuePattern
    HasTextPattern = $hasTextPattern
    ControlType = $controlType
    CanSetValue = $canSetValue
    CanControlledClipboard = $canControlledClipboard
    CandidateToken = "uia_" + $candidateIdentityHash
    FocusIdentityHash = $focusIdentityHash
  }
}

function Get-ElementTextPatternValue {
  param([object]$Element)
  if ($null -eq $Element) { return $null }
  $pattern = $null
  try {
    $available = [bool]$Element.TryGetCurrentPattern(
      [System.Windows.Automation.TextPattern]::Pattern,
      [ref]$pattern
    )
  } catch {
    return $null
  }
  if (-not $available -or $null -eq $pattern -or $null -eq $pattern.DocumentRange) {
    return $null
  }
  try {
    $value = $pattern.DocumentRange.GetText(-1)
  } catch {
    return $null
  }
  if ($null -eq $value) { return "" }
  return [string]$value
}

function Normalize-TextPatternDraft {
  param(
    [object]$Metadata,
    [AllowEmptyString()][string]$RawValue
  )
  if ([string]$Metadata.ControlType -cne "ControlType.Group") { return $RawValue }

  # The official Codex Windows composer exposes its empty placeholder as two
  # immediate Text children. Typed content is exposed as a different, single
  # child shape. Inspect only this focused element's direct children.
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  try {
    $firstChild = $walker.GetFirstChild($Metadata.Element)
    if ($null -eq $firstChild) { return $RawValue }
    $secondChild = $walker.GetNextSibling($firstChild)
    if ($null -eq $secondChild) { return $RawValue }
    if ($null -ne $walker.GetNextSibling($secondChild)) { return $RawValue }
    if (
      [string]$firstChild.Current.ControlType.ProgrammaticName -cne "ControlType.Text" -or
      [string]$secondChild.Current.ControlType.ProgrammaticName -cne "ControlType.Text"
    ) {
      return $RawValue
    }
    if (
      [string]::IsNullOrEmpty([string]$firstChild.Current.ClassName) -or
      -not [string]::IsNullOrEmpty([string]$secondChild.Current.ClassName)
    ) {
      return $RawValue
    }
  } catch {
    return $RawValue
  }

  $firstText = Get-ElementTextPatternValue -Element $firstChild
  $secondText = Get-ElementTextPatternValue -Element $secondChild
  if (
    $null -ne $firstText -and
    $null -ne $secondText -and
    [string]$firstText -ceq "`n" -and
    $secondText.Length -gt 0 -and
    $secondText.Length -le 80 -and
    $RawValue -ceq ($firstText + $secondText)
  ) {
    return ""
  }
  return $RawValue
}

function Get-SafeComposerMetadata {
  $context = Get-ForegroundCodexContext
  if (-not $context.Ready) { return $context }
  return Get-FocusedComposerMetadata -Context $context
}

function Read-ExactComposerText {
  param([object]$Metadata)
  if ($Metadata.HasValuePattern -and $null -ne $Metadata.ValuePattern) {
    $value = $Metadata.ValuePattern.Current.Value
    if ($null -eq $value) { return "" }
    return [string]$value
  }
  if ($Metadata.HasTextPattern -and $null -ne $Metadata.TextPattern) {
    $range = $Metadata.TextPattern.DocumentRange
    if ($null -eq $range) { throw "exact_text_range_unavailable" }
    $value = $Metadata.TextPattern.DocumentRange.GetText(-1)
    if ($null -eq $value) { return "" }
    return Normalize-TextPatternDraft -Metadata $Metadata -RawValue ([string]$value)
  }
  throw "exact_read_unavailable"
}

function New-SnapshotData {
  param([object]$Metadata, [AllowEmptyString()][string]$DraftText)
  $context = $Metadata.Context
  return [pscustomobject][ordered]@{
    target = "codex"
    foregroundHwnd = $context.Hwnd
    hwnd = $context.Hwnd
    pid = [int]$context.Pid
    isMainWindow = [bool]$context.IsMainWindow
    isVisible = [bool]$context.IsVisible
    isMinimized = [bool]$context.IsMinimized
    isCloaked = [bool]$context.IsCloaked
    runtimeIdentityHash = $context.RuntimeIdentityHash
    projectIdentityHash = $null
    projectIdentityReliable = $false
    composer = [pscustomobject][ordered]@{
      ownerHwnd = $context.Hwnd
      candidateToken = $Metadata.CandidateToken
      focused = $true
      focusIdentityHash = $Metadata.FocusIdentityHash
      canReadExact = $true
      canReplaceAll = [bool]($Metadata.CanSetValue -or $Metadata.CanControlledClipboard)
      canSetValue = [bool]$Metadata.CanSetValue
      canControlledClipboard = [bool]$Metadata.CanControlledClipboard
      draftText = $DraftText
    }
  }
}

function New-SnapshotContract {
  param(
    [string]$Kind,
    [object]$Snapshot,
    [bool]$DriverOk,
    [string]$ReasonToken
  )
  $result = [ordered]@{
    schemaVersion = $script:DriverSchemaVersion
    kind = $Kind
    driverOk = $DriverOk
    reasonToken = $ReasonToken
  }
  foreach ($property in $Snapshot.PSObject.Properties) {
    $result[$property.Name] = $property.Value
  }
  return [pscustomobject]$result
}

function Test-ExpectedIdentity {
  param([object]$Metadata, [object]$Expected)
  return [bool](
    [string]$Expected.target -ceq "codex" -and
    [string]$Expected.hwnd -ieq [string]$Metadata.Context.Hwnd -and
    [int64]$Expected.pid -eq [int64]$Metadata.Context.Pid -and
    [string]$Expected.runtimeIdentityHash -ceq [string]$Metadata.Context.RuntimeIdentityHash -and
    [string]$Expected.focusIdentityHash -ceq [string]$Metadata.FocusIdentityHash -and
    [string]$Expected.candidateToken -ceq [string]$Metadata.CandidateToken
  )
}

function Get-GuardedSnapshot {
  param([object]$Expected)
  $metadata = Get-SafeComposerMetadata
  if (-not $metadata.Ready) {
    return [pscustomobject]@{
      Matched = $false
      ReasonToken = $metadata.ReasonToken
      Metadata = $null
      Snapshot = $null
    }
  }
  if (-not (Test-ExpectedIdentity -Metadata $metadata -Expected $Expected)) {
    return [pscustomobject]@{
      Matched = $false
      ReasonToken = "atomic_identity_mismatch"
      Metadata = $metadata
      Snapshot = $null
    }
  }
  try {
    $draftText = Read-ExactComposerText -Metadata $metadata
  } catch {
    return [pscustomobject]@{
      Matched = $false
      ReasonToken = "safety_exact_read_required"
      Metadata = $metadata
      Snapshot = $null
    }
  }
  $snapshot = New-SnapshotData -Metadata $metadata -DraftText $draftText
  $draftMatched = [bool]((Get-Sha256Hex -Text $draftText) -ceq [string]$Expected.draftHash)
  return [pscustomobject]@{
    Matched = $draftMatched
    ReasonToken = if ($draftMatched) { "ready" } else { "draft_hash_mismatch" }
    Metadata = $metadata
    Snapshot = $snapshot
  }
}

function Test-LeaseFreshAtCommit {
  param([object]$Command)
  if ([string]$Command.operation -eq "undo") { return $true }
  if (-not (Test-LeaseContract -Lease $Command.leaseFreshness)) { return $false }
  $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  return [bool](
    $nowMs -ge [int64]$Command.leaseFreshness.issuedAtMs -and
    $nowMs -le [int64]$Command.leaseFreshness.expiresAtMs
  )
}

function Get-PostWriteReadback {
  param([object]$Expected)
  $metadata = Get-SafeComposerMetadata
  if (-not $metadata.Ready -or -not (Test-ExpectedIdentity -Metadata $metadata -Expected $Expected)) {
    return [pscustomobject]@{
      FocusConfirmed = $false
      ReadbackAvailable = $false
      ReadbackText = $null
    }
  }
  try {
    $readback = Read-ExactComposerText -Metadata $metadata
  } catch {
    return [pscustomobject]@{
      FocusConfirmed = $true
      ReadbackAvailable = $false
      ReadbackText = $null
    }
  }
  return [pscustomobject]@{
    FocusConfirmed = $true
    ReadbackAvailable = $true
    ReadbackText = $readback
  }
}

function New-AtomicReply {
  param(
    [object]$Before,
    [bool]$DriverOk,
    [string]$ReasonToken,
    [bool]$Attempted,
    [bool]$GuardMatched,
    [bool]$LeaseFreshAtCommit,
    [string]$Method,
    [string]$ReplacementMode,
    [AllowNull()][object]$ReadbackText,
    [AllowNull()][object]$ClipboardRestored,
    [bool]$FocusConfirmed,
    [bool]$SelectAllApplied,
    [bool]$PasteApplied
  )
  return [pscustomobject][ordered]@{
    schemaVersion = $script:DriverSchemaVersion
    kind = "replace_all_atomic"
    driverOk = $DriverOk
    reasonToken = $ReasonToken
    before = $Before
    attempted = $Attempted
    guardMatched = $GuardMatched
    leaseFreshAtCommit = $LeaseFreshAtCommit
    candidateRemapped = $false
    method = $Method
    replacementMode = $ReplacementMode
    readbackText = $ReadbackText
    clipboardRestored = $ClipboardRestored
    focusConfirmed = $FocusConfirmed
    selectAllApplied = $SelectAllApplied
    pasteApplied = $PasteApplied
    submitCount = 0
  }
}

function Invoke-ClipboardRetry {
  param([Parameter(Mandatory = $true)][scriptblock]$Action)
  $lastError = $null
  for ($attempt = 0; $attempt -lt 6; $attempt += 1) {
    try {
      return & $Action
    } catch {
      $lastError = $_
      if ($attempt -lt 5) { Start-Sleep -Milliseconds 25 }
    }
  }
  throw $lastError
}

function Restore-ClipboardDataObject {
  param(
    [AllowNull()][object]$SavedDataObject,
    [bool]$HadDataObject
  )
  if ($HadDataObject) {
    Invoke-ClipboardRetry {
      [System.Windows.Forms.Clipboard]::SetDataObject($SavedDataObject, $true)
    }
  } else {
    Invoke-ClipboardRetry {
      [System.Windows.Forms.Clipboard]::Clear()
    }
  }
}

function Send-ControlChord {
  param([byte]$VirtualKey)
  $keyUp = [uint32]0x0002
  [SmartPromptCodexTargetNative]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
  try {
    [SmartPromptCodexTargetNative]::keybd_event($VirtualKey, 0, 0, [UIntPtr]::Zero)
    [SmartPromptCodexTargetNative]::keybd_event($VirtualKey, 0, $keyUp, [UIntPtr]::Zero)
  } finally {
    [SmartPromptCodexTargetNative]::keybd_event(0x11, 0, $keyUp, [UIntPtr]::Zero)
  }
}

function Normalize-ClipboardReadback {
  param([AllowEmptyString()][string]$Text)
  $normalized = $Text.Replace("`r`n", "`n").Replace("`r", "`n")
  $lines = [regex]::Split($normalized, "`n")
  $result = New-Object System.Collections.Generic.List[string]
  $fenceMarker = $null

  foreach ($line in $lines) {
    $trimmedStart = $line.TrimStart([char[]]@(' ', "`t"))
    $marker = $null
    if ($trimmedStart.StartsWith('```')) {
      $marker = '```'
    } elseif ($trimmedStart.StartsWith('~~~')) {
      $marker = '~~~'
    }

    if ($null -eq $fenceMarker -and $null -ne $marker) {
      $fenceMarker = $marker
      $result.Add($line.TrimEnd([char[]]@(' ', "`t")))
      continue
    }
    if ($null -ne $fenceMarker) {
      if ($marker -eq $fenceMarker) {
        $fenceMarker = $null
        $result.Add($line.TrimEnd([char[]]@(' ', "`t")))
      } else {
        $result.Add($line)
      }
      continue
    }

    $leadingMatch = [regex]::Match($line, '^[\x20\t]*')
    $leading = $leadingMatch.Value
    $body = $line.Substring($leading.Length).TrimEnd([char[]]@(' ', "`t"))
    $body = [regex]::Replace($body, ' {2,}', ' ')
    $result.Add($leading + $body)
  }

  return [string]::Join("`n", $result)
}

function Invoke-DirectReplacement {
  param([object]$Command, [object]$Guard)
  $Text = [string]$Command.text
  $commitGuard = Get-GuardedSnapshot -Expected $Command.expected
  if ($null -eq $commitGuard.Snapshot -or -not $commitGuard.Matched) {
    return New-AtomicReply `
      -Before $commitGuard.Snapshot `
      -DriverOk $false `
      -ReasonToken $commitGuard.ReasonToken `
      -Attempted $false `
      -GuardMatched $false `
      -LeaseFreshAtCommit $false `
      -Method "none" `
      -ReplacementMode "none" `
      -ReadbackText $null `
      -ClipboardRestored $null `
      -FocusConfirmed $false `
      -SelectAllApplied $false `
      -PasteApplied $false
  }
  $leaseFreshAtCommit = Test-LeaseFreshAtCommit -Command $Command
  if (-not $leaseFreshAtCommit) {
    return New-AtomicReply `
      -Before $commitGuard.Snapshot `
      -DriverOk $false `
      -ReasonToken "stale_payload" `
      -Attempted $false `
      -GuardMatched $true `
      -LeaseFreshAtCommit $false `
      -Method "none" `
      -ReplacementMode "none" `
      -ReadbackText $null `
      -ClipboardRestored $null `
      -FocusConfirmed $true `
      -SelectAllApplied $false `
      -PasteApplied $false
  }
  if (-not $commitGuard.Metadata.CanSetValue -or $null -eq $commitGuard.Metadata.ValuePattern) {
    return New-AtomicReply `
      -Before $commitGuard.Snapshot `
      -DriverOk $false `
      -ReasonToken "direct_set_value_unavailable" `
      -Attempted $false `
      -GuardMatched $true `
      -LeaseFreshAtCommit $true `
      -Method "none" `
      -ReplacementMode "none" `
      -ReadbackText $null `
      -ClipboardRestored $null `
      -FocusConfirmed $true `
      -SelectAllApplied $false `
      -PasteApplied $false
  }
  try {
    $commitGuard.Metadata.ValuePattern.SetValue($Text)
  } catch {
    return New-AtomicReply `
      -Before $commitGuard.Snapshot `
      -DriverOk $false `
      -ReasonToken "direct_set_value_failed" `
      -Attempted $true `
      -GuardMatched $true `
      -LeaseFreshAtCommit $true `
      -Method "direct" `
      -ReplacementMode "set_value" `
      -ReadbackText $null `
      -ClipboardRestored $null `
      -FocusConfirmed $true `
      -SelectAllApplied $false `
      -PasteApplied $false
  }

  $postWrite = Get-PostWriteReadback -Expected $Command.expected
  $matched = [bool](
    $postWrite.ReadbackAvailable -and
    [string]$postWrite.ReadbackText -ceq $Text
  )
  return New-AtomicReply `
    -Before $commitGuard.Snapshot `
    -DriverOk $matched `
    -ReasonToken $(if ($matched) { "ready" } else { "after_write_mismatch" }) `
    -Attempted $true `
    -GuardMatched $true `
    -LeaseFreshAtCommit $true `
    -Method "direct" `
    -ReplacementMode "set_value" `
    -ReadbackText $postWrite.ReadbackText `
    -ClipboardRestored $null `
    -FocusConfirmed $postWrite.FocusConfirmed `
    -SelectAllApplied $false `
    -PasteApplied $false
}

function Invoke-ControlledClipboardReplacement {
  param([object]$Command, [object]$InitialGuard)
  $Text = [string]$Command.text
  $savedDataObject = $null
  $hadDataObject = $false
  $clipboardCaptured = $false
  $clipboardMayHaveChanged = $false
  $clipboardSetCompleted = $false
  $clipboardPayloadConfirmed = $false
  $clipboardRaceDetected = $false
  $ownedClipboardSequence = [uint32]0
  $clipboardRestored = $false
  $attempted = $false
  $selectAllApplied = $false
  $pasteApplied = $false
  $readbackCopyApplied = $false
  $readbackText = $null
  $focusConfirmed = $false
  $leaseFreshAtCommit = $false
  $guardMatched = $false
  $before = $InitialGuard.Snapshot
  $reasonToken = "clipboard_write_failed"

  try {
    $savedDataObject = Invoke-ClipboardRetry {
      [System.Windows.Forms.Clipboard]::GetDataObject()
    }
    $clipboardCaptured = $true
    $hadDataObject = $null -ne $savedDataObject

    $replacementData = New-Object System.Windows.Forms.DataObject
    $replacementData.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $true, $Text)
    $clipboardMayHaveChanged = $true
    Invoke-ClipboardRetry {
      [System.Windows.Forms.Clipboard]::SetDataObject($replacementData, $true)
    }
    $clipboardSetCompleted = $true
    $ownedClipboardSequence = [SmartPromptCodexTargetNative]::GetClipboardSequenceNumber()
    $clipboardText = Invoke-ClipboardRetry {
      [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText)
    }
    $clipboardPayloadConfirmed = [bool](
      $ownedClipboardSequence -gt 0 -and
      [string]$clipboardText -ceq $Text
    )

    if (-not $clipboardPayloadConfirmed) {
      $reasonToken = "clipboard_payload_mismatch"
    } else {
      $commitGuard = Get-GuardedSnapshot -Expected $Command.expected
      $before = $commitGuard.Snapshot
      $guardMatched = [bool]$commitGuard.Matched
      if (-not $guardMatched) {
        $reasonToken = $commitGuard.ReasonToken
      } else {
        $leaseFreshAtCommit = Test-LeaseFreshAtCommit -Command $Command
        if (-not $leaseFreshAtCommit) {
          $reasonToken = "stale_payload"
        } else {
          $currentClipboardSequence = [SmartPromptCodexTargetNative]::GetClipboardSequenceNumber()
          if ($currentClipboardSequence -ne $ownedClipboardSequence) {
            $clipboardRaceDetected = $true
            $reasonToken = "clipboard_changed_before_paste"
          } else {
            $focusConfirmed = $true
            $attempted = $true
            Send-ControlChord -VirtualKey 0x41
            $selectAllApplied = $true
            Start-Sleep -Milliseconds 25
            Send-ControlChord -VirtualKey 0x56
            $pasteApplied = $true
            Start-Sleep -Milliseconds 75
            $postPasteClipboardSequence = [SmartPromptCodexTargetNative]::GetClipboardSequenceNumber()
            if ($postPasteClipboardSequence -ne $ownedClipboardSequence) {
              $clipboardRaceDetected = $true
              $reasonToken = "clipboard_changed_after_paste"
            } else {
              Send-ControlChord -VirtualKey 0x41
              Start-Sleep -Milliseconds 25
              Send-ControlChord -VirtualKey 0x43
              $readbackCopyApplied = $true
              Start-Sleep -Milliseconds 75
              $ownedClipboardSequence = [SmartPromptCodexTargetNative]::GetClipboardSequenceNumber()
              $copiedText = Invoke-ClipboardRetry {
                [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText)
              }
              $readbackText = Normalize-ClipboardReadback -Text ([string]$copiedText)
              $postMetadata = Get-SafeComposerMetadata
              $focusConfirmed = [bool](
                $postMetadata.Ready -and
                (Test-ExpectedIdentity -Metadata $postMetadata -Expected $Command.expected)
              )
              $reasonToken = "write_copied_for_readback"
            }
          }
        }
      }
    }
  } catch {
    if (-not $clipboardCaptured) {
      $reasonToken = "clipboard_capture_failed"
    } elseif (-not $clipboardSetCompleted) {
      $reasonToken = "clipboard_set_failed"
    } elseif (-not $clipboardPayloadConfirmed) {
      $reasonToken = "clipboard_payload_mismatch"
    } elseif ($pasteApplied) {
      $reasonToken = "clipboard_readback_failed"
    } else {
      $reasonToken = "clipboard_key_sequence_failed"
    }
  } finally {
    if ($clipboardMayHaveChanged) {
      $currentClipboardSequence = [SmartPromptCodexTargetNative]::GetClipboardSequenceNumber()
      if ($clipboardSetCompleted -and $ownedClipboardSequence -gt 0 -and $currentClipboardSequence -ne $ownedClipboardSequence) {
        $clipboardRaceDetected = $true
        $clipboardRestored = $false
      } else {
        try {
          Restore-ClipboardDataObject `
            -SavedDataObject $savedDataObject `
            -HadDataObject $hadDataObject
          $clipboardRestored = $true
        } catch {
          $clipboardRestored = $false
        }
      }
    } else {
      $clipboardRestored = $true
    }
  }

  $normalizedText = Normalize-ClipboardReadback -Text $Text
  $readbackMatched = [bool](
    $readbackCopyApplied -and
    $null -ne $readbackText -and
    [string]$readbackText -ceq $normalizedText
  )
  $driverOk = [bool](
    $attempted -and
    $guardMatched -and
    $leaseFreshAtCommit -and
    $focusConfirmed -and
    $selectAllApplied -and
    $pasteApplied -and
    $clipboardRestored -and
    $readbackMatched
  )
  if ($driverOk) {
    $reasonToken = "ready"
  } elseif ($clipboardRaceDetected) {
    $reasonToken = "clipboard_race_detected"
  } elseif (-not $clipboardRestored) {
    $reasonToken = "clipboard_restore_failed"
  } elseif ($pasteApplied -and -not $readbackMatched) {
    $reasonToken = "after_write_mismatch"
  }

  return New-AtomicReply `
    -Before $before `
    -DriverOk $driverOk `
    -ReasonToken $reasonToken `
    -Attempted $attempted `
    -GuardMatched $guardMatched `
    -LeaseFreshAtCommit $leaseFreshAtCommit `
    -Method "controlled_clipboard" `
    -ReplacementMode "ctrl_a_paste" `
    -ReadbackText $readbackText `
    -ClipboardRestored $clipboardRestored `
    -FocusConfirmed $focusConfirmed `
    -SelectAllApplied $selectAllApplied `
    -PasteApplied $pasteApplied
}

function Invoke-InspectOperation {
  $metadata = Get-SafeComposerMetadata
  if (-not $metadata.Ready) {
    return New-DriverFailure -Kind "inspect" -ReasonToken $metadata.ReasonToken
  }
  try {
    $draftText = Read-ExactComposerText -Metadata $metadata
  } catch {
    return New-DriverFailure -Kind "inspect" -ReasonToken "safety_exact_read_required"
  }
  $snapshot = New-SnapshotData -Metadata $metadata -DraftText $draftText
  return New-SnapshotContract -Kind "inspect" -Snapshot $snapshot -DriverOk $true -ReasonToken "ready"
}

function Invoke-ReadOperation {
  param([object]$Command)
  $guard = Get-GuardedSnapshot -Expected $Command.expected
  if ($null -eq $guard.Snapshot) {
    return New-DriverFailure -Kind "read_exact" -ReasonToken $guard.ReasonToken
  }
  return New-SnapshotContract `
    -Kind "read_exact" `
    -Snapshot $guard.Snapshot `
    -DriverOk ([bool]$guard.Matched) `
    -ReasonToken $guard.ReasonToken
}

function Invoke-ReplaceOperation {
  param([object]$Command)
  $guard = Get-GuardedSnapshot -Expected $Command.expected
  if ($null -eq $guard.Snapshot -or -not $guard.Matched) {
    return New-AtomicReply `
      -Before $guard.Snapshot `
      -DriverOk $false `
      -ReasonToken $guard.ReasonToken `
      -Attempted $false `
      -GuardMatched $false `
      -LeaseFreshAtCommit $false `
      -Method "none" `
      -ReplacementMode "none" `
      -ReadbackText $null `
      -ClipboardRestored $null `
      -FocusConfirmed $false `
      -SelectAllApplied $false `
      -PasteApplied $false
  }

  $leaseFreshAtCommit = Test-LeaseFreshAtCommit -Command $Command
  if (-not $leaseFreshAtCommit) {
    return New-AtomicReply `
      -Before $guard.Snapshot `
      -DriverOk $false `
      -ReasonToken "stale_payload" `
      -Attempted $false `
      -GuardMatched $true `
      -LeaseFreshAtCommit $false `
      -Method "none" `
      -ReplacementMode "none" `
      -ReadbackText $null `
      -ClipboardRestored $null `
      -FocusConfirmed $true `
      -SelectAllApplied $false `
      -PasteApplied $false
  }

  # The ChatGPT-packaged Codex composer collapses newlines on ValuePattern
  # SetValue (multi-line prompts get flattened). Its paste handler preserves
  # them, so this profile prefers the controlled clipboard write when the
  # caller allows it. Direct SetValue remains the fallback path.
  $codexWritePolicy = Get-SmartPromptDesktopToolProfilePolicy -ToolProfile "codex"
  $preferClipboard = [bool](
    $null -ne $codexWritePolicy -and
    $null -ne $codexWritePolicy.composerGuard -and
    $codexWritePolicy.composerGuard.preferControlledClipboard -eq $true
  )
  if (
    $preferClipboard -and
    $Command.allowClipboardFallback -eq $true -and
    $guard.Metadata.CanControlledClipboard
  ) {
    return Invoke-ControlledClipboardReplacement -Command $Command -InitialGuard $guard
  }
  if ($guard.Metadata.CanSetValue -and $null -ne $guard.Metadata.ValuePattern) {
    return Invoke-DirectReplacement -Command $Command -Guard $guard
  }
  if ($Command.allowClipboardFallback -eq $true -and $guard.Metadata.CanControlledClipboard) {
    return Invoke-ControlledClipboardReplacement -Command $Command -InitialGuard $guard
  }
  return New-AtomicReply `
    -Before $guard.Snapshot `
    -DriverOk $false `
    -ReasonToken "permission_required_clipboard_fallback" `
    -Attempted $false `
    -GuardMatched $true `
    -LeaseFreshAtCommit $true `
    -Method "none" `
    -ReplacementMode "none" `
    -ReadbackText $null `
    -ClipboardRestored $null `
    -FocusConfirmed $true `
    -SelectAllApplied $false `
    -PasteApplied $false
}

# NOTE: this file MUST stay ASCII-only. PowerShell 5.1 parses no-BOM .ps1 as
# ANSI; non-ASCII bytes can swallow newlines and break here-strings.
# Under CreateNoWindow (native sidecar spawn), the process has no console:
# [Console]::In.ReadToEnd() returns empty and [Console]::OpenStandardInput()
# throws. Read the OS-level stdin handle (redirected pipe) via GetStdHandle.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SmartPromptDriverStdin {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr GetStdHandle(int nStdHandle);
}
"@
$stdinHandle = [SmartPromptDriverStdin]::GetStdHandle(-10)
if ($stdinHandle -eq [IntPtr]::Zero -or $stdinHandle -eq [IntPtr](-1)) {
  throw "stdin_unavailable"
}
$stdinReader = New-Object System.IO.StreamReader(
  (New-Object System.IO.FileStream($stdinHandle, [System.IO.FileAccess]::Read)),
  [System.Text.Encoding]::UTF8)
$rawInput = $stdinReader.ReadToEnd()
$stdinReader.Close()
$command = $null
$kind = "invalid"
$result = $null
$driverStage = "input"

try {
  if ([string]::IsNullOrWhiteSpace($rawInput)) { throw "missing_input" }
  $command = $rawInput | ConvertFrom-Json -ErrorAction Stop
  if ($null -eq $command -or -not (Test-ObjectProperty -Value $command -Name "kind")) {
    throw "missing_kind"
  }
  $kind = [string]$command.kind
  if ($kind -notin $script:AllowedKinds) { throw "unsupported_kind" }
  $driverStage = "contract"
  if (-not (Test-CommandContract -Command $command -Kind $kind)) {
    throw "invalid_contract"
  }
  if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne [System.Threading.ApartmentState]::STA) {
    throw "sta_required"
  }

  $driverStage = "dependencies"
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -AssemblyName System.Windows.Forms
  $profileConfigPath = Join-Path $PSScriptRoot "desktop-tool-profile-config.ps1"
  if (-not (Test-Path -LiteralPath $profileConfigPath)) { throw "profile_config_missing" }
  . $profileConfigPath
  if (-not ([System.Management.Automation.PSTypeName]"SmartPromptCodexTargetNative").Type) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SmartPromptCodexTargetNative {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")]
  public static extern IntPtr GetWindow(IntPtr hWnd, uint command);
  [DllImport("user32.dll")]
  public static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
  [DllImport("user32.dll")]
  public static extern uint GetDpiForWindow(IntPtr hWnd);
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(
    IntPtr hWnd,
    int attribute,
    out int value,
    int valueSize
  );
}
"@
  }

  $driverStage = "operation"
  if ($kind -eq "inspect") {
    $result = Invoke-InspectOperation
  } elseif ($kind -eq "read_exact") {
    $result = Invoke-ReadOperation -Command $command
  } else {
    $result = Invoke-ReplaceOperation -Command $command
  }
} catch {
  $reasonToken = if ($kind -notin $script:AllowedKinds) {
    "invalid_command"
  } elseif ($driverStage -eq "contract") {
    "driver_contract_failed_closed"
  } elseif ($driverStage -eq "dependencies") {
    "driver_dependencies_failed_closed"
  } elseif ($driverStage -eq "operation") {
    "driver_operation_failed_closed"
  } else {
    "driver_input_failed_closed"
  }
  $result = New-DriverFailure -Kind $kind -ReasonToken $reasonToken
}

Write-DriverJson -Value $result
