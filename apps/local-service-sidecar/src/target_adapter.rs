use chrono::{SecondsFormat, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fmt,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub const ADAPTER_VERSION: &str = "codex-windows-target-adapter@1";
pub const LEASE_VERSION: &str = "codex-target-lease@1";
pub const RESULT_CONTRACT_VERSION: &str = "codex-target-adapter-result@1";
pub const DEFAULT_LEASE_TTL_MS: i64 = 30_000;
pub const MAX_LEASE_TTL_MS: i64 = 45_000;
pub const VERIFIED_TRANSACTION_TTL_MS: i64 = 5 * 60 * 1_000;
pub const TRANSACTION_VERSION: &str = "codex-verified-insert-transaction@1";
pub const TRANSACTION_CLAIM_VERSION: &str = "codex-verified-insert-claim@1";
pub const DRIVER_SCHEMA_VERSION: &str = "codex-target-adapter-driver@1";
// UIA traversal on the Codex/ChatGPT desktop app (OpenAI.Codex package) can
// take ~89s; 30s made real closure inspects time out deterministically.
// Timeout still aborts and refuses writes — safety guards unchanged.
pub const DEFAULT_DRIVER_TIMEOUT_MS: u64 = 90_000;
pub const MAX_DRIVER_TIMEOUT_MS: u64 = 120_000;
pub const MAX_DRIVER_IO_BYTES: usize = 512 * 1024;
pub const DRIVER_FILE_NAME: &str = "codex-target-adapter-driver.ps1";

pub fn normalize_editor_readback(value: &str) -> String {
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    let mut fence_marker: Option<&str> = None;

    normalized
        .split('\n')
        .map(|line| {
            let trimmed_start = line.trim_start_matches([' ', '\t']);
            let marker = if trimmed_start.starts_with("```") {
                Some("```")
            } else if trimmed_start.starts_with("~~~") {
                Some("~~~")
            } else {
                None
            };

            if fence_marker.is_none() && marker.is_some() {
                fence_marker = marker;
                return line.trim_end_matches([' ', '\t']).to_string();
            }
            if let Some(active_marker) = fence_marker {
                if marker == Some(active_marker) {
                    fence_marker = None;
                    return line.trim_end_matches([' ', '\t']).to_string();
                }
                return line.to_string();
            }

            let leading_len = line
                .find(|character| character != ' ' && character != '\t')
                .unwrap_or(line.len());
            let (leading, body) = line.split_at(leading_len);
            let body = body.trim_end_matches([' ', '\t']);
            let mut collapsed = String::with_capacity(body.len());
            let mut previous_was_space = false;
            for character in body.chars() {
                if character == ' ' {
                    if !previous_was_space {
                        collapsed.push(character);
                    }
                    previous_was_space = true;
                } else {
                    collapsed.push(character);
                    previous_was_space = false;
                }
            }
            format!("{leading}{collapsed}")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WriteMethod {
    None,
    Direct,
    ControlledClipboard,
}

impl WriteMethod {
    fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Direct => "direct",
            Self::ControlledClipboard => "controlled_clipboard",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposerSnapshot {
    pub owner_hwnd: String,
    pub candidate_token: String,
    pub focused: bool,
    pub focus_identity_hash: String,
    pub can_read_exact: bool,
    pub can_replace_all: bool,
    pub can_set_value: bool,
    pub can_controlled_clipboard: bool,
    pub draft_text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSnapshot {
    pub target: String,
    pub foreground_hwnd: String,
    pub hwnd: String,
    pub pid: u32,
    pub is_main_window: bool,
    pub is_visible: bool,
    pub is_minimized: bool,
    pub is_cloaked: bool,
    pub runtime_identity_hash: String,
    #[serde(default)]
    pub project_identity_hash: Option<String>,
    #[serde(default)]
    pub project_identity_reliable: bool,
    pub composer: ComposerSnapshot,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TargetExpectation {
    pub target: String,
    pub hwnd: String,
    pub pid: u32,
    pub runtime_identity_hash: String,
    pub focus_identity_hash: String,
    pub candidate_token: String,
    pub draft_hash: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LeaseFreshnessExpectation {
    pub lease_id: String,
    pub issued_at_ms: i64,
    pub expires_at_ms: i64,
    pub require_fresh_at_commit: bool,
}

#[derive(Clone, Debug)]
pub struct AtomicReplaceRequest {
    pub operation: String,
    pub expected: TargetExpectation,
    pub text: String,
    pub prefer_direct_set_value: bool,
    pub allow_clipboard_fallback: bool,
    pub lease_freshness: Option<LeaseFreshnessExpectation>,
    pub replacement_intent: String,
    pub no_submit: bool,
    pub prohibited_actions: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AtomicReplaceReply {
    pub before: ProbeSnapshot,
    pub attempted: bool,
    pub guard_matched: bool,
    pub lease_fresh_at_commit: bool,
    pub candidate_remapped: bool,
    pub method: WriteMethod,
    pub replacement_mode: String,
    pub readback_text: Option<String>,
    pub clipboard_restored: Option<bool>,
    pub focus_confirmed: bool,
    pub select_all_applied: bool,
    pub paste_applied: bool,
    pub submit_count: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProbeError {
    pub code: String,
}

impl ProbeError {
    pub fn new(code: impl Into<String>) -> Self {
        Self { code: code.into() }
    }
}

impl fmt::Display for ProbeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.code)
    }
}

impl std::error::Error for ProbeError {}

pub trait ProbeRunner {
    fn inspect(&mut self) -> Result<ProbeSnapshot, ProbeError>;
    fn read_exact(&mut self, expected: &TargetExpectation) -> Result<ProbeSnapshot, ProbeError>;
    fn replace_all_atomic(
        &mut self,
        request: &AtomicReplaceRequest,
    ) -> Result<AtomicReplaceReply, ProbeError>;
}

impl<T: ProbeRunner + ?Sized> ProbeRunner for Box<T> {
    fn inspect(&mut self) -> Result<ProbeSnapshot, ProbeError> {
        (**self).inspect()
    }

    fn read_exact(&mut self, expected: &TargetExpectation) -> Result<ProbeSnapshot, ProbeError> {
        (**self).read_exact(expected)
    }

    fn replace_all_atomic(
        &mut self,
        request: &AtomicReplaceRequest,
    ) -> Result<AtomicReplaceReply, ProbeError> {
        (**self).replace_all_atomic(request)
    }
}

#[derive(Clone, Debug)]
pub struct PowerShellProbeRunner {
    executable: String,
    script_path: PathBuf,
    timeout_ms: u64,
}

impl PowerShellProbeRunner {
    pub fn new(script_path: impl Into<PathBuf>) -> Result<Self, ProbeError> {
        let script_path = script_path.into();
        if !script_path.is_file() {
            return Err(ProbeError::new("codex_probe_driver_missing"));
        }
        Ok(Self {
            executable: "powershell.exe".to_string(),
            script_path,
            timeout_ms: DEFAULT_DRIVER_TIMEOUT_MS,
        })
    }

    pub fn from_environment() -> Result<Self, ProbeError> {
        #[cfg(not(windows))]
        {
            return Err(ProbeError::new("codex_probe_windows_only"));
        }

        #[cfg(windows)]
        {
            #[cfg(debug_assertions)]
            if let Some(configured) = std::env::var_os("SMART_PROMPT_CODEX_TARGET_DRIVER") {
                return Self::new(PathBuf::from(configured));
            }
            let executable = std::env::current_exe()
                .map_err(|_| ProbeError::new("codex_probe_driver_missing"))?;
            if let Some(bundled) = bundled_driver_path_for_executable(&executable) {
                if bundled.is_file() {
                    return Self::new(bundled);
                }
            }
            #[cfg(debug_assertions)]
            {
                let source_driver = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("..")
                    .join("..")
                    .join("scripts")
                    .join(DRIVER_FILE_NAME);
                if source_driver.is_file() {
                    return Self::new(source_driver);
                }
            }
            Err(ProbeError::new("codex_probe_driver_missing"))
        }
    }

    pub fn with_timeout_ms(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = timeout_ms.clamp(1, MAX_DRIVER_TIMEOUT_MS);
        self
    }

    pub fn script_path(&self) -> &Path {
        &self.script_path
    }

    fn run(&self, kind: &str, command: Value) -> Result<Value, ProbeError> {
        #[cfg(not(windows))]
        {
            let _ = (kind, command);
            return Err(ProbeError::new("codex_probe_windows_only"));
        }

        #[cfg(windows)]
        {
            if !["inspect", "read_exact", "replace_all_atomic"].contains(&kind) {
                return Err(ProbeError::new("codex_probe_invalid_command"));
            }
            let input = serde_json::to_vec(&command)
                .map_err(|_| ProbeError::new("codex_probe_invalid_command"))?;
            if input.is_empty() || input.len() > MAX_DRIVER_IO_BYTES {
                return Err(ProbeError::new("codex_probe_invalid_command"));
            }

            let mut process = Command::new(&self.executable);
            process.args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-STA",
                "-File",
            ]);
            process.arg(&self.script_path);
            process
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            use std::os::windows::process::CommandExt;
            process.creation_flags(0x0800_0000);
            let mut child = process
                .spawn()
                .map_err(|_| ProbeError::new("codex_probe_process_failed"))?;

            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| ProbeError::new("codex_probe_process_failed"))?;
            stdin
                .write_all(&input)
                .map_err(|_| ProbeError::new("codex_probe_process_failed"))?;
            drop(stdin);

            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| ProbeError::new("codex_probe_process_failed"))?;
            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| ProbeError::new("codex_probe_process_failed"))?;
            let stdout_reader = thread::spawn(move || read_driver_stream(stdout));
            let stderr_reader = thread::spawn(move || read_driver_stream(stderr));

            let deadline = Instant::now() + Duration::from_millis(self.timeout_ms);
            let status = loop {
                match child.try_wait() {
                    Ok(Some(status)) => break status,
                    Ok(None) if Instant::now() < deadline => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Ok(None) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        let _ = stdout_reader.join();
                        let _ = stderr_reader.join();
                        return Err(ProbeError::new("codex_probe_timeout"));
                    }
                    Err(_) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        let _ = stdout_reader.join();
                        let _ = stderr_reader.join();
                        return Err(ProbeError::new("codex_probe_process_failed"));
                    }
                }
            };
            let stdout = stdout_reader
                .join()
                .map_err(|_| ProbeError::new("codex_probe_process_failed"))??;
            let stderr = stderr_reader
                .join()
                .map_err(|_| ProbeError::new("codex_probe_process_failed"))??;
            if stdout.len() > MAX_DRIVER_IO_BYTES || stderr.len() > MAX_DRIVER_IO_BYTES {
                return Err(ProbeError::new("codex_probe_output_too_large"));
            }
            if !status.success() {
                eprintln!("[diag] probe nonzero exit {status}: stderr={}", String::from_utf8_lossy(&stderr).chars().take(500).collect::<String>());
                return Err(ProbeError::new("codex_probe_process_failed"));
            }
            let contract = extract_driver_contract(&stdout, kind)
                .ok_or_else(|| {
                    eprintln!("[diag] probe invalid output: stdout={}", String::from_utf8_lossy(&stdout).chars().take(500).collect::<String>());
                    ProbeError::new("codex_probe_invalid_output")
                })?;
            if contract.get("driverOk").and_then(Value::as_bool) != Some(true) {
                eprintln!("[diag] probe driverOk=false contract={}", contract);
                return Err(ProbeError::new(
                    contract
                        .get("reasonToken")
                        .and_then(Value::as_str)
                        .unwrap_or("codex_probe_failed_closed"),
                ));
            }
            Ok(contract)
        }
    }
}

impl ProbeRunner for PowerShellProbeRunner {
    fn inspect(&mut self) -> Result<ProbeSnapshot, ProbeError> {
        let contract = self.run(
            "inspect",
            serde_json::json!({
                "kind": "inspect",
                "target": "codex",
                "foregroundSource": "GetForegroundWindow",
                "focusedComposerOnly": true,
                "requireExactRead": true,
                "requireFullReplace": true
            }),
        )?;
        serde_json::from_value(contract).map_err(|_| ProbeError::new("codex_probe_invalid_output"))
    }

    fn read_exact(&mut self, expected: &TargetExpectation) -> Result<ProbeSnapshot, ProbeError> {
        let contract = self.run(
            "read_exact",
            serde_json::json!({
                "kind": "read_exact",
                "expected": target_expectation_value(expected),
                "scope": "same_focused_composer",
                "forbidScopes": ["nearby", "root", "chat"]
            }),
        )?;
        serde_json::from_value(contract).map_err(|_| ProbeError::new("codex_probe_invalid_output"))
    }

    fn replace_all_atomic(
        &mut self,
        request: &AtomicReplaceRequest,
    ) -> Result<AtomicReplaceReply, ProbeError> {
        let lease_freshness = request.lease_freshness.as_ref().map(|lease| {
            serde_json::json!({
                "leaseId": lease.lease_id,
                "issuedAtMs": lease.issued_at_ms,
                "expiresAtMs": lease.expires_at_ms,
                "requireFreshAtCommit": lease.require_fresh_at_commit
            })
        });
        let contract = self.run(
            "replace_all_atomic",
            serde_json::json!({
                "kind": "replace_all_atomic",
                "operation": request.operation,
                "expected": target_expectation_value(&request.expected),
                "text": request.text,
                "preferDirectSetValue": request.prefer_direct_set_value,
                "allowClipboardFallback": request.allow_clipboard_fallback,
                "leaseFreshness": lease_freshness,
                "replacementIntent": request.replacement_intent,
                "noSubmit": request.no_submit,
                "prohibitedActions": request.prohibited_actions
            }),
        )?;
        serde_json::from_value(contract).map_err(|_| ProbeError::new("codex_probe_invalid_output"))
    }
}

pub fn bundled_driver_path_for_executable(executable: &Path) -> Option<PathBuf> {
    executable
        .parent()
        .and_then(Path::parent)
        .map(|root| root.join("scripts").join(DRIVER_FILE_NAME))
}

pub fn extract_driver_contract(stdout: &[u8], expected_kind: &str) -> Option<Value> {
    if !["inspect", "read_exact", "replace_all_atomic"].contains(&expected_kind) {
        return None;
    }
    let text = String::from_utf8_lossy(stdout);
    text.trim_start_matches('\u{feff}')
        .lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
        .find(|value| {
            value.get("schemaVersion").and_then(Value::as_str) == Some(DRIVER_SCHEMA_VERSION)
                && value.get("kind").and_then(Value::as_str) == Some(expected_kind)
                && value.get("driverOk").and_then(Value::as_bool).is_some()
                && value.get("reasonToken").and_then(Value::as_str).is_some()
        })
}

fn read_driver_stream<R: Read>(reader: R) -> Result<Vec<u8>, ProbeError> {
    let mut output = Vec::new();
    reader
        .take((MAX_DRIVER_IO_BYTES + 1) as u64)
        .read_to_end(&mut output)
        .map_err(|_| ProbeError::new("codex_probe_process_failed"))?;
    Ok(output)
}

fn target_expectation_value(expected: &TargetExpectation) -> Value {
    serde_json::json!({
        "target": expected.target,
        "hwnd": expected.hwnd,
        "pid": expected.pid,
        "runtimeIdentityHash": expected.runtime_identity_hash,
        "focusIdentityHash": expected.focus_identity_hash,
        "candidateToken": expected.candidate_token,
        "draftHash": expected.draft_hash
    })
}

pub trait Clock: Clone {
    fn now_ms(&self) -> i64;
}

#[derive(Clone, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaseCapabilities {
    pub exact_read: bool,
    pub full_replace: bool,
    pub direct_set_value: bool,
    pub controlled_clipboard: bool,
    pub project_scope_reliable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetLease {
    pub lease_version: String,
    pub lease_id: String,
    pub target: String,
    pub hwnd: String,
    pub pid: u32,
    pub runtime_identity_hash: String,
    pub focused: bool,
    pub focus_identity_hash: String,
    pub draft_hash: String,
    pub project_scope_token: String,
    pub project_scope_kind: String,
    pub project_scope_reliable: bool,
    pub project_scope_reason: String,
    pub issued_at: String,
    pub expires_at: String,
    pub capabilities: LeaseCapabilities,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyFlags {
    pub raw_input_stored: bool,
    pub generated_prompt_stored: bool,
    pub chat_content_stored: bool,
    pub clipboard_content_stored: bool,
    pub window_title_stored: bool,
    pub absolute_project_path_stored: bool,
    pub credential_stored: bool,
    pub raw_evidence_stored: bool,
}

impl Default for PrivacyFlags {
    fn default() -> Self {
        Self {
            raw_input_stored: false,
            generated_prompt_stored: false,
            chat_content_stored: false,
            clipboard_content_stored: false,
            window_title_stored: false,
            absolute_project_path_stored: false,
            credential_stored: false,
            raw_evidence_stored: false,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterResult {
    pub contract_version: String,
    pub adapter_result_id: String,
    pub operation: String,
    pub status: String,
    pub target: String,
    pub attempted: bool,
    pub verified: bool,
    pub verification: String,
    pub write_method: String,
    pub reason_token: String,
    pub public_reason: String,
    pub foreground_verified: bool,
    pub target_identity_verified: bool,
    pub focus_verified: bool,
    pub draft_unchanged: bool,
    pub payload_fresh: bool,
    pub readback_matched: bool,
    pub clipboard_restored: Option<bool>,
    pub no_auto_submit: bool,
    pub occurred_at: String,
    pub privacy_flags: PrivacyFlags,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectResponse {
    pub result: AdapterResult,
    pub lease: Option<TargetLease>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadDraftResponse {
    pub result: AdapterResult,
    pub draft_text: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertResponse {
    pub result: AdapterResult,
    pub undo_token: Option<String>,
    pub transaction: Option<VerifiedTransactionHandle>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoResponse {
    pub result: AdapterResult,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedTransactionHandle {
    pub transaction_version: String,
    pub transaction_id: String,
    pub target: String,
    pub project_scope_token: String,
    pub project_scope_kind: String,
    pub project_scope_reliable: bool,
    pub project_scope_reason: String,
    pub issued_at: String,
    pub expires_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionClaimReceipt {
    pub claim_version: String,
    pub transaction_id: String,
    pub binding: String,
    pub target: String,
    pub adapter_result_id: String,
    pub project_scope_token: String,
    pub project_scope_kind: String,
    pub project_scope_reliable: bool,
    pub project_scope_reason: String,
    pub verification: String,
    pub insert_verified: bool,
    pub no_auto_submit: bool,
    pub issued_at: String,
    pub claimed_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionClaimResponse {
    pub status: String,
    pub reason_token: String,
    pub receipt: Option<TransactionClaimReceipt>,
}

#[derive(Clone, Copy, Debug, Default)]
struct SnapshotChecks {
    foreground_verified: bool,
    target_identity_verified: bool,
    focus_verified: bool,
}

#[derive(Clone, Debug)]
struct SnapshotValidation {
    ok: bool,
    reason_token: String,
    checks: SnapshotChecks,
}

#[derive(Clone, Debug)]
struct TargetRecord {
    lease_id: String,
    hwnd: String,
    pid: u32,
    runtime_identity_hash: String,
    focus_identity_hash: String,
    candidate_token: String,
    draft_hash: String,
    original_draft: String,
    issued_at_ms: i64,
    expires_at_ms: i64,
    project_scope: ProjectScope,
    capabilities: LeaseCapabilities,
}

#[derive(Clone, Debug)]
struct ProjectScope {
    token: String,
    kind: String,
    reliable: bool,
    reason: String,
}

#[derive(Clone, Debug)]
struct UndoRecord {
    target: TargetRecord,
    original_draft: String,
    written_text: String,
}

#[derive(Clone, Debug)]
struct VerifiedTransactionRecord {
    transaction_id: String,
    adapter_result_id: String,
    project_scope: ProjectScope,
    issued_at_ms: i64,
    expires_at_ms: i64,
    claims: HashMap<String, TransactionClaimReceipt>,
}

#[derive(Clone, Debug)]
struct ResultFacts {
    status: String,
    reason_token: String,
    attempted: bool,
    verified: bool,
    verification: String,
    write_method: WriteMethod,
    checks: SnapshotChecks,
    draft_unchanged: bool,
    payload_fresh: bool,
    readback_matched: bool,
    clipboard_restored: Option<bool>,
}

impl ResultFacts {
    fn new(status: &str, reason_token: &str) -> Self {
        Self {
            status: status.to_string(),
            reason_token: reason_token.to_string(),
            attempted: false,
            verified: false,
            verification: "none".to_string(),
            write_method: WriteMethod::None,
            checks: SnapshotChecks::default(),
            draft_unchanged: false,
            payload_fresh: false,
            readback_matched: false,
            clipboard_restored: None,
        }
    }
}

#[derive(Debug)]
struct AtomicOutcome {
    success: bool,
    result: AdapterResult,
}

pub struct CodexTargetAdapter<R: ProbeRunner, C: Clock = SystemClock> {
    runner: R,
    clock: C,
    lease_ttl_ms: i64,
    leases: HashMap<String, TargetRecord>,
    undo_records: HashMap<String, UndoRecord>,
    reliable_project_scopes: HashMap<String, String>,
    session_project_scopes: HashMap<String, String>,
    verified_transactions: HashMap<String, VerifiedTransactionRecord>,
    result_sequence: u64,
}

impl<R: ProbeRunner> CodexTargetAdapter<R, SystemClock> {
    pub fn new(runner: R) -> Self {
        Self::with_clock(runner, SystemClock, DEFAULT_LEASE_TTL_MS)
    }
}

impl<R: ProbeRunner, C: Clock> CodexTargetAdapter<R, C> {
    pub fn with_clock(runner: R, clock: C, lease_ttl_ms: i64) -> Self {
        Self {
            runner,
            clock,
            lease_ttl_ms: lease_ttl_ms.clamp(1, MAX_LEASE_TTL_MS),
            leases: HashMap::new(),
            undo_records: HashMap::new(),
            reliable_project_scopes: HashMap::new(),
            session_project_scopes: HashMap::new(),
            verified_transactions: HashMap::new(),
            result_sequence: 0,
        }
    }

    pub fn adapter_version(&self) -> &'static str {
        ADAPTER_VERSION
    }

    pub fn lease_ttl_ms(&self) -> i64 {
        self.lease_ttl_ms
    }

    pub fn runner(&self) -> &R {
        &self.runner
    }

    pub fn invalidate_undo(&mut self) -> usize {
        let count = self.undo_records.len();
        self.undo_records.clear();
        count
    }

    pub fn invalidate_project_scope(&mut self, project_scope_token: &str) -> usize {
        let mut invalidated = 0;
        self.leases.retain(|_, record| {
            let keep = record.project_scope.token != project_scope_token;
            if !keep {
                invalidated += 1;
            }
            keep
        });
        self.undo_records.retain(|_, record| {
            let keep = record.target.project_scope.token != project_scope_token;
            if !keep {
                invalidated += 1;
            }
            keep
        });
        self.verified_transactions.retain(|_, transaction| {
            let keep = transaction.project_scope.token != project_scope_token;
            if !keep {
                invalidated += 1;
            }
            keep
        });
        self.reliable_project_scopes
            .retain(|_, token| token != project_scope_token);
        self.session_project_scopes
            .retain(|_, token| token != project_scope_token);
        invalidated
    }

    pub fn inspect(&mut self) -> InspectResponse {
        let snapshot = match self.runner.inspect() {
            Ok(snapshot) => snapshot,
            Err(_) => {
                let at_ms = self.clock.now_ms();
                return InspectResponse {
                    result: self.build_result(
                        "inspect",
                        at_ms,
                        ResultFacts::new("failed", "probe_failed"),
                    ),
                    lease: None,
                };
            }
        };
        let at_ms = self.clock.now_ms();

        let validation = validate_snapshot(&snapshot);
        if !validation.ok {
            let mut facts = ResultFacts::new("blocked", &validation.reason_token);
            facts.checks = validation.checks;
            return InspectResponse {
                result: self.build_result("inspect", at_ms, facts),
                lease: None,
            };
        }

        let project_scope = self.resolve_project_scope(&snapshot);
        let record = target_record(&snapshot, at_ms, self.lease_ttl_ms, project_scope);
        let lease = public_lease(&record);
        self.leases.insert(record.lease_id.clone(), record);
        let mut facts = ResultFacts::new("ready", "ready");
        facts.verification = "machine".to_string();
        facts.checks = validation.checks;
        facts.draft_unchanged = true;
        facts.payload_fresh = true;
        facts.readback_matched = true;
        InspectResponse {
            result: self.build_result("inspect", at_ms, facts),
            lease: Some(lease),
        }
    }

    pub fn read_draft(&mut self, lease_id: &str) -> ReadDraftResponse {
        let at_ms = self.clock.now_ms();
        let record = match self.leases.get(lease_id).cloned() {
            Some(record) if is_fresh(&record, at_ms) => record,
            Some(record) => {
                self.leases.remove(&record.lease_id);
                return ReadDraftResponse {
                    result: self.stale_result("read", at_ms),
                    draft_text: None,
                };
            }
            None => {
                return ReadDraftResponse {
                    result: self.stale_result("read", at_ms),
                    draft_text: None,
                }
            }
        };

        let snapshot = match self
            .runner
            .read_exact(&expected_target(&record, &record.draft_hash))
        {
            Ok(snapshot) => snapshot,
            Err(_) => {
                self.leases.remove(&record.lease_id);
                return ReadDraftResponse {
                    result: self.build_result(
                        "read",
                        at_ms,
                        ResultFacts::new("failed", "readback_unavailable"),
                    ),
                    draft_text: None,
                };
            }
        };

        let comparison = compare_snapshot(&record, &snapshot, &record.draft_hash, "draft_changed");
        if !comparison.ok {
            self.leases.remove(&record.lease_id);
            let mut facts = ResultFacts::new("blocked", &comparison.reason_token);
            facts.checks = comparison.checks;
            facts.payload_fresh = true;
            return ReadDraftResponse {
                result: self.build_result("read", at_ms, facts),
                draft_text: None,
            };
        }

        let mut facts = ResultFacts::new("ready", "ready");
        facts.attempted = true;
        facts.verification = "machine".to_string();
        facts.checks = comparison.checks;
        facts.draft_unchanged = true;
        facts.payload_fresh = true;
        facts.readback_matched = true;
        ReadDraftResponse {
            result: self.build_result("read", at_ms, facts),
            draft_text: Some(snapshot.composer.draft_text),
        }
    }

    pub fn insert(
        &mut self,
        lease_id: &str,
        text: &str,
        allow_clipboard_fallback: bool,
    ) -> InsertResponse {
        let at_ms = self.clock.now_ms();
        let record = match self.leases.get(lease_id).cloned() {
            Some(record) if is_fresh(&record, at_ms) => record,
            Some(record) => {
                self.leases.remove(&record.lease_id);
                return InsertResponse {
                    result: self.stale_result("insert", at_ms),
                    undo_token: None,
                    transaction: None,
                };
            }
            None => {
                return InsertResponse {
                    result: self.stale_result("insert", at_ms),
                    undo_token: None,
                    transaction: None,
                }
            }
        };

        let replacement = self.atomic_replace(
            "insert",
            &record,
            &record.draft_hash,
            text,
            allow_clipboard_fallback,
            at_ms,
            "draft_changed",
        );
        if !replacement.success {
            if replacement.result.status != "copy_only" {
                self.leases.remove(&record.lease_id);
            }
            return InsertResponse {
                result: replacement.result,
                undo_token: None,
                transaction: None,
            };
        }

        self.leases.remove(&record.lease_id);
        self.undo_records.clear();
        let undo_token = opaque_token("undo");
        self.undo_records.insert(
            undo_token.clone(),
            UndoRecord {
                target: record.clone(),
                original_draft: record.original_draft.clone(),
                written_text: text.to_string(),
            },
        );
        let transaction = self.create_verified_transaction(&record, &replacement.result, at_ms);
        InsertResponse {
            result: replacement.result,
            undo_token: Some(undo_token),
            transaction: Some(transaction),
        }
    }

    pub fn undo(&mut self, undo_token: &str, allow_clipboard_fallback: bool) -> UndoResponse {
        let at_ms = self.clock.now_ms();
        let undo_record = match self.undo_records.get(undo_token).cloned() {
            Some(record) => record,
            None => {
                return UndoResponse {
                    result: self.stale_result("undo", at_ms),
                }
            }
        };

        let replacement = self.atomic_replace(
            "undo",
            &undo_record.target,
            &sha256_hex(&undo_record.written_text),
            &undo_record.original_draft,
            allow_clipboard_fallback,
            at_ms,
            "target_changed_written_draft",
        );
        if replacement.result.status != "copy_only" {
            self.undo_records.remove(undo_token);
        }
        UndoResponse {
            result: replacement.result,
        }
    }

    pub fn claim_verified_transaction(
        &mut self,
        transaction_id: &str,
        binding: &str,
    ) -> TransactionClaimResponse {
        let at_ms = self.clock.now_ms();
        if !["activation", "pending_outcome"].contains(&binding) {
            return TransactionClaimResponse {
                status: "blocked".to_string(),
                reason_token: "transaction_binding_invalid".to_string(),
                receipt: None,
            };
        }
        let valid = self
            .verified_transactions
            .get(transaction_id)
            .map(|transaction| {
                at_ms >= transaction.issued_at_ms && at_ms <= transaction.expires_at_ms
            })
            .unwrap_or(false);
        if !valid {
            self.verified_transactions.remove(transaction_id);
            return TransactionClaimResponse {
                status: "blocked".to_string(),
                reason_token: "verified_transaction_missing".to_string(),
                receipt: None,
            };
        }
        if let Some(receipt) = self
            .verified_transactions
            .get(transaction_id)
            .and_then(|transaction| transaction.claims.get(binding))
            .cloned()
        {
            return TransactionClaimResponse {
                status: "ready".to_string(),
                reason_token: "ready".to_string(),
                receipt: Some(receipt),
            };
        }

        let transaction = self
            .verified_transactions
            .get(transaction_id)
            .expect("validated transaction must remain in memory");
        let receipt = TransactionClaimReceipt {
            claim_version: TRANSACTION_CLAIM_VERSION.to_string(),
            transaction_id: transaction.transaction_id.clone(),
            binding: binding.to_string(),
            target: "codex".to_string(),
            adapter_result_id: transaction.adapter_result_id.clone(),
            project_scope_token: transaction.project_scope.token.clone(),
            project_scope_kind: transaction.project_scope.kind.clone(),
            project_scope_reliable: transaction.project_scope.reliable,
            project_scope_reason: transaction.project_scope.reason.clone(),
            verification: "machine".to_string(),
            insert_verified: true,
            no_auto_submit: true,
            issued_at: iso_timestamp(transaction.issued_at_ms),
            claimed_at: iso_timestamp(at_ms),
        };
        self.verified_transactions
            .get_mut(transaction_id)
            .expect("validated transaction must remain mutable")
            .claims
            .insert(binding.to_string(), receipt.clone());
        TransactionClaimResponse {
            status: "ready".to_string(),
            reason_token: "ready".to_string(),
            receipt: Some(receipt),
        }
    }

    fn resolve_project_scope(&mut self, snapshot: &ProbeSnapshot) -> ProjectScope {
        if snapshot.project_identity_reliable {
            if let Some(identity_hash) = snapshot.project_identity_hash.as_deref() {
                if valid_hash(identity_hash) {
                    let token = self
                        .reliable_project_scopes
                        .entry(identity_hash.to_string())
                        .or_insert_with(|| opaque_token("project_scope"))
                        .clone();
                    return ProjectScope {
                        token,
                        kind: "reliable_hash".to_string(),
                        reliable: true,
                        reason: "project_scope_reliable".to_string(),
                    };
                }
            }
        }
        let window_runtime_key = sha256_hex(&format!(
            "{}\n{}\n{}",
            snapshot.hwnd.to_ascii_lowercase(),
            snapshot.pid,
            snapshot.runtime_identity_hash
        ));
        let token = self
            .session_project_scopes
            .entry(window_runtime_key)
            .or_insert_with(|| opaque_token("project_scope_session"))
            .clone();
        ProjectScope {
            token,
            kind: "session_opaque".to_string(),
            reliable: false,
            reason: "project_scope_window_runtime_session_only".to_string(),
        }
    }

    fn create_verified_transaction(
        &mut self,
        record: &TargetRecord,
        adapter_result: &AdapterResult,
        at_ms: i64,
    ) -> VerifiedTransactionHandle {
        let transaction = VerifiedTransactionRecord {
            transaction_id: opaque_token("transaction"),
            adapter_result_id: adapter_result.adapter_result_id.clone(),
            project_scope: record.project_scope.clone(),
            issued_at_ms: at_ms,
            expires_at_ms: at_ms + VERIFIED_TRANSACTION_TTL_MS,
            claims: HashMap::new(),
        };
        let handle = transaction_handle(&transaction);
        self.verified_transactions
            .insert(transaction.transaction_id.clone(), transaction);
        handle
    }

    #[allow(clippy::too_many_arguments)]
    fn atomic_replace(
        &mut self,
        operation: &str,
        record: &TargetRecord,
        expected_draft_hash: &str,
        desired_text: &str,
        allow_clipboard_fallback: bool,
        at_ms: i64,
        draft_reason: &str,
    ) -> AtomicOutcome {
        if !record.capabilities.direct_set_value && !allow_clipboard_fallback {
            let mut facts = ResultFacts::new("copy_only", "permission_required_clipboard_fallback");
            facts.payload_fresh = true;
            return AtomicOutcome {
                success: false,
                result: self.build_result(operation, at_ms, facts),
            };
        }

        let request = AtomicReplaceRequest {
            operation: operation.to_string(),
            expected: expected_target(record, expected_draft_hash),
            text: desired_text.to_string(),
            prefer_direct_set_value: true,
            allow_clipboard_fallback,
            lease_freshness: (operation == "insert").then(|| LeaseFreshnessExpectation {
                lease_id: record.lease_id.clone(),
                issued_at_ms: record.issued_at_ms,
                expires_at_ms: record.expires_at_ms,
                require_fresh_at_commit: true,
            }),
            replacement_intent: "full".to_string(),
            no_submit: true,
            prohibited_actions: vec![
                "enter".to_string(),
                "submit".to_string(),
                "send".to_string(),
            ],
        };
        let reply = match self.runner.replace_all_atomic(&request) {
            Ok(reply) => reply,
            Err(_) => {
                let mut facts = ResultFacts::new("failed", "write_failed_probe");
                facts.payload_fresh = true;
                return AtomicOutcome {
                    success: false,
                    result: self.build_result(operation, at_ms, facts),
                };
            }
        };

        let comparison = compare_snapshot(record, &reply.before, expected_draft_hash, draft_reason);
        if !comparison.ok {
            let guard_bypassed = reply.attempted;
            let reason = if guard_bypassed {
                "safety_atomic_guard_bypassed"
            } else {
                &comparison.reason_token
            };
            let mut facts =
                ResultFacts::new(if guard_bypassed { "failed" } else { "blocked" }, reason);
            facts.attempted = guard_bypassed;
            facts.checks = comparison.checks;
            facts.payload_fresh = true;
            return AtomicOutcome {
                success: false,
                result: self.build_result(operation, at_ms, facts),
            };
        }
        let checks = comparison.checks;

        if operation == "insert" && !reply.lease_fresh_at_commit {
            let guard_bypassed = reply.attempted;
            let mut facts = ResultFacts::new(
                if guard_bypassed { "failed" } else { "blocked" },
                if guard_bypassed {
                    "safety_atomic_guard_bypassed"
                } else {
                    "stale_payload"
                },
            );
            facts.attempted = guard_bypassed;
            facts.checks = checks;
            facts.payload_fresh = false;
            return AtomicOutcome {
                success: false,
                result: self.build_result(operation, at_ms, facts),
            };
        }

        if !reply.guard_matched {
            let mut facts = ResultFacts::new("failed", "safety_atomic_revalidation_required");
            facts.attempted = reply.attempted;
            facts.checks = checks;
            facts.draft_unchanged = true;
            facts.payload_fresh = true;
            return AtomicOutcome {
                success: false,
                result: self.build_result(operation, at_ms, facts),
            };
        }
        if reply.candidate_remapped {
            let mut facts = ResultFacts::new("failed", "safety_candidate_remap");
            facts.attempted = reply.attempted;
            facts.checks = checks;
            facts.draft_unchanged = true;
            facts.payload_fresh = true;
            return AtomicOutcome {
                success: false,
                result: self.build_result(operation, at_ms, facts),
            };
        }
        if !reply.attempted {
            let mut facts = ResultFacts::new("failed", "write_failed_not_attempted");
            facts.checks = checks;
            facts.draft_unchanged = true;
            facts.payload_fresh = true;
            return AtomicOutcome {
                success: false,
                result: self.build_result(operation, at_ms, facts),
            };
        }
        if reply.submit_count != 0 {
            let mut facts = ResultFacts::new("failed", "safety_auto_submit_signal");
            facts.attempted = true;
            facts.checks = checks;
            facts.draft_unchanged = true;
            facts.payload_fresh = true;
            return AtomicOutcome {
                success: false,
                result: self.build_result(operation, at_ms, facts),
            };
        }

        let (write_method, clipboard_restored) = match reply.method {
            WriteMethod::Direct => {
                if !reply.before.composer.can_set_value || reply.replacement_mode != "set_value" {
                    let mut facts = ResultFacts::new("failed", "safety_full_replace_required");
                    facts.attempted = true;
                    facts.checks = checks;
                    facts.draft_unchanged = true;
                    facts.payload_fresh = true;
                    return AtomicOutcome {
                        success: false,
                        result: self.build_result(operation, at_ms, facts),
                    };
                }
                (WriteMethod::Direct, None)
            }
            WriteMethod::ControlledClipboard => {
                if !allow_clipboard_fallback {
                    let mut facts =
                        ResultFacts::new("blocked", "permission_required_clipboard_fallback");
                    facts.attempted = true;
                    facts.checks = checks;
                    facts.draft_unchanged = true;
                    facts.payload_fresh = true;
                    return AtomicOutcome {
                        success: false,
                        result: self.build_result(operation, at_ms, facts),
                    };
                }
                if reply.before.composer.can_set_value {
                    let mut facts = ResultFacts::new("failed", "safety_direct_write_bypassed");
                    facts.attempted = true;
                    facts.checks = checks;
                    facts.draft_unchanged = true;
                    facts.payload_fresh = true;
                    return AtomicOutcome {
                        success: false,
                        result: self.build_result(operation, at_ms, facts),
                    };
                }
                if !reply.before.composer.can_controlled_clipboard
                    || reply.replacement_mode != "ctrl_a_paste"
                    || !reply.focus_confirmed
                    || !reply.select_all_applied
                    || !reply.paste_applied
                {
                    let mut facts = ResultFacts::new("failed", "safety_full_replace_required");
                    facts.attempted = true;
                    facts.checks = checks;
                    facts.draft_unchanged = true;
                    facts.payload_fresh = true;
                    return AtomicOutcome {
                        success: false,
                        result: self.build_result(operation, at_ms, facts),
                    };
                }
                if reply.clipboard_restored != Some(true) {
                    let mut facts = ResultFacts::new("failed", "write_failed_clipboard_restore");
                    facts.attempted = true;
                    facts.write_method = WriteMethod::None;
                    facts.checks = checks;
                    facts.draft_unchanged = true;
                    facts.payload_fresh = true;
                    facts.readback_matched =
                        reply.readback_text.as_deref().is_some_and(|readback| {
                            normalize_editor_readback(readback)
                                == normalize_editor_readback(desired_text)
                        });
                    facts.clipboard_restored = Some(false);
                    return AtomicOutcome {
                        success: false,
                        result: self.build_result(operation, at_ms, facts),
                    };
                }
                (WriteMethod::ControlledClipboard, Some(true))
            }
            WriteMethod::None => {
                let mut facts = ResultFacts::new("failed", "write_failed_method");
                facts.attempted = true;
                facts.checks = checks;
                facts.draft_unchanged = true;
                facts.payload_fresh = true;
                return AtomicOutcome {
                    success: false,
                    result: self.build_result(operation, at_ms, facts),
                };
            }
        };

        let readback_matched = reply.readback_text.as_deref().is_some_and(|readback| {
            normalize_editor_readback(readback) == normalize_editor_readback(desired_text)
        });
        if !readback_matched {
            let mut facts = ResultFacts::new("failed", "after_write_mismatch");
            facts.attempted = true;
            facts.write_method = write_method;
            facts.checks = checks;
            facts.draft_unchanged = true;
            facts.payload_fresh = true;
            facts.clipboard_restored = clipboard_restored;
            return AtomicOutcome {
                success: false,
                result: self.build_result(operation, at_ms, facts),
            };
        }

        let mut facts = ResultFacts::new(
            "ready",
            if operation == "insert" {
                "inserted"
            } else {
                "succeeded"
            },
        );
        facts.attempted = true;
        facts.verified = operation == "insert";
        facts.verification = "machine".to_string();
        facts.write_method = write_method;
        facts.checks = checks;
        facts.draft_unchanged = true;
        facts.payload_fresh = true;
        facts.readback_matched = true;
        facts.clipboard_restored = clipboard_restored;
        AtomicOutcome {
            success: true,
            result: self.build_result(operation, at_ms, facts),
        }
    }

    fn stale_result(&mut self, operation: &str, at_ms: i64) -> AdapterResult {
        self.build_result(
            operation,
            at_ms,
            ResultFacts::new("blocked", "stale_payload"),
        )
    }

    fn build_result(&mut self, operation: &str, at_ms: i64, facts: ResultFacts) -> AdapterResult {
        self.result_sequence += 1;
        AdapterResult {
            contract_version: RESULT_CONTRACT_VERSION.to_string(),
            adapter_result_id: format!(
                "adapter_result_{}_{}",
                std::process::id(),
                self.result_sequence
            ),
            operation: operation.to_string(),
            status: facts.status,
            target: "codex".to_string(),
            attempted: facts.attempted,
            verified: facts.verified,
            verification: facts.verification,
            write_method: facts.write_method.as_str().to_string(),
            reason_token: facts.reason_token.clone(),
            public_reason: public_reason_for(&facts.reason_token).to_string(),
            foreground_verified: facts.checks.foreground_verified,
            target_identity_verified: facts.checks.target_identity_verified,
            focus_verified: facts.checks.focus_verified,
            draft_unchanged: facts.draft_unchanged,
            payload_fresh: facts.payload_fresh,
            readback_matched: facts.readback_matched,
            clipboard_restored: facts.clipboard_restored,
            no_auto_submit: true,
            occurred_at: iso_timestamp(at_ms),
            privacy_flags: PrivacyFlags::default(),
        }
    }
}

fn snapshot_checks(snapshot: &ProbeSnapshot) -> SnapshotChecks {
    SnapshotChecks {
        foreground_verified: valid_hwnd(&snapshot.hwnd)
            && equal_hwnd(&snapshot.foreground_hwnd, &snapshot.hwnd)
            && snapshot.is_visible
            && !snapshot.is_minimized
            && !snapshot.is_cloaked,
        target_identity_verified: snapshot.target == "codex"
            && snapshot.is_main_window
            && snapshot.pid > 0
            && valid_hash(&snapshot.runtime_identity_hash)
            && equal_hwnd(&snapshot.composer.owner_hwnd, &snapshot.hwnd)
            && !snapshot.composer.candidate_token.is_empty(),
        focus_verified: snapshot.composer.focused
            && valid_hash(&snapshot.composer.focus_identity_hash),
    }
}

fn invalid_snapshot(reason_token: &str, checks: SnapshotChecks) -> SnapshotValidation {
    SnapshotValidation {
        ok: false,
        reason_token: reason_token.to_string(),
        checks,
    }
}

fn validate_snapshot(snapshot: &ProbeSnapshot) -> SnapshotValidation {
    let checks = snapshot_checks(snapshot);
    if snapshot.target != "codex" {
        return invalid_snapshot("unsupported_target", checks);
    }
    if !valid_hwnd(&snapshot.hwnd) || !valid_hwnd(&snapshot.foreground_hwnd) {
        return invalid_snapshot("target_missing", checks);
    }
    if !equal_hwnd(&snapshot.foreground_hwnd, &snapshot.hwnd) {
        return invalid_snapshot("not_foreground", checks);
    }
    if !snapshot.is_main_window {
        return invalid_snapshot("unsupported_target_main_window", checks);
    }
    if !snapshot.is_visible || snapshot.is_minimized || snapshot.is_cloaked {
        return invalid_snapshot("target_missing_hidden", checks);
    }
    if snapshot.pid == 0 {
        return invalid_snapshot("target_missing_pid", checks);
    }
    if !valid_hash(&snapshot.runtime_identity_hash) {
        return invalid_snapshot("safety_runtime_identity_required", checks);
    }
    if !equal_hwnd(&snapshot.composer.owner_hwnd, &snapshot.hwnd) {
        return invalid_snapshot("target_changed_composer_owner", checks);
    }
    if snapshot.composer.candidate_token.is_empty() {
        return invalid_snapshot("safety_focused_composer_identity_required", checks);
    }
    if !snapshot.composer.focused || !valid_hash(&snapshot.composer.focus_identity_hash) {
        return invalid_snapshot("focus_required", checks);
    }
    if !snapshot.composer.can_read_exact {
        return invalid_snapshot("safety_exact_read_required", checks);
    }
    if !snapshot.composer.can_replace_all
        || (!snapshot.composer.can_set_value && !snapshot.composer.can_controlled_clipboard)
    {
        return invalid_snapshot("safety_full_replace_required", checks);
    }
    SnapshotValidation {
        ok: true,
        reason_token: "ready".to_string(),
        checks,
    }
}

fn compare_snapshot(
    record: &TargetRecord,
    snapshot: &ProbeSnapshot,
    expected_draft_hash: &str,
    draft_reason: &str,
) -> SnapshotValidation {
    let validation = validate_snapshot(snapshot);
    if !validation.ok {
        return validation;
    }
    let checks = validation.checks;
    if !equal_hwnd(&snapshot.hwnd, &record.hwnd) {
        return invalid_snapshot("window_changed", checks);
    }
    if snapshot.pid != record.pid {
        return invalid_snapshot("target_changed_pid", checks);
    }
    if snapshot.runtime_identity_hash != record.runtime_identity_hash {
        return invalid_snapshot("target_changed_runtime_identity", checks);
    }
    if snapshot.composer.candidate_token != record.candidate_token {
        return invalid_snapshot("target_changed_candidate", checks);
    }
    if snapshot.composer.focus_identity_hash != record.focus_identity_hash {
        return invalid_snapshot("focus_changed", checks);
    }
    if sha256_hex(&snapshot.composer.draft_text) != expected_draft_hash {
        return invalid_snapshot(draft_reason, checks);
    }
    SnapshotValidation {
        ok: true,
        reason_token: "ready".to_string(),
        checks,
    }
}

fn target_record(
    snapshot: &ProbeSnapshot,
    issued_at_ms: i64,
    ttl_ms: i64,
    project_scope: ProjectScope,
) -> TargetRecord {
    TargetRecord {
        lease_id: opaque_token("lease"),
        hwnd: snapshot.hwnd.clone(),
        pid: snapshot.pid,
        runtime_identity_hash: snapshot.runtime_identity_hash.clone(),
        focus_identity_hash: snapshot.composer.focus_identity_hash.clone(),
        candidate_token: snapshot.composer.candidate_token.clone(),
        draft_hash: sha256_hex(&snapshot.composer.draft_text),
        original_draft: snapshot.composer.draft_text.clone(),
        issued_at_ms,
        expires_at_ms: issued_at_ms + ttl_ms,
        project_scope: project_scope.clone(),
        capabilities: LeaseCapabilities {
            exact_read: true,
            full_replace: true,
            direct_set_value: snapshot.composer.can_set_value,
            controlled_clipboard: snapshot.composer.can_controlled_clipboard,
            project_scope_reliable: project_scope.reliable,
        },
    }
}

fn public_lease(record: &TargetRecord) -> TargetLease {
    TargetLease {
        lease_version: LEASE_VERSION.to_string(),
        lease_id: record.lease_id.clone(),
        target: "codex".to_string(),
        hwnd: record.hwnd.clone(),
        pid: record.pid,
        runtime_identity_hash: record.runtime_identity_hash.clone(),
        focused: true,
        focus_identity_hash: record.focus_identity_hash.clone(),
        draft_hash: record.draft_hash.clone(),
        project_scope_token: record.project_scope.token.clone(),
        project_scope_kind: record.project_scope.kind.clone(),
        project_scope_reliable: record.project_scope.reliable,
        project_scope_reason: record.project_scope.reason.clone(),
        issued_at: iso_timestamp(record.issued_at_ms),
        expires_at: iso_timestamp(record.expires_at_ms),
        capabilities: record.capabilities.clone(),
    }
}

fn transaction_handle(transaction: &VerifiedTransactionRecord) -> VerifiedTransactionHandle {
    VerifiedTransactionHandle {
        transaction_version: TRANSACTION_VERSION.to_string(),
        transaction_id: transaction.transaction_id.clone(),
        target: "codex".to_string(),
        project_scope_token: transaction.project_scope.token.clone(),
        project_scope_kind: transaction.project_scope.kind.clone(),
        project_scope_reliable: transaction.project_scope.reliable,
        project_scope_reason: transaction.project_scope.reason.clone(),
        issued_at: iso_timestamp(transaction.issued_at_ms),
        expires_at: iso_timestamp(transaction.expires_at_ms),
    }
}

fn expected_target(record: &TargetRecord, draft_hash: &str) -> TargetExpectation {
    TargetExpectation {
        target: "codex".to_string(),
        hwnd: record.hwnd.clone(),
        pid: record.pid,
        runtime_identity_hash: record.runtime_identity_hash.clone(),
        focus_identity_hash: record.focus_identity_hash.clone(),
        candidate_token: record.candidate_token.clone(),
        draft_hash: draft_hash.to_string(),
    }
}

fn is_fresh(record: &TargetRecord, at_ms: i64) -> bool {
    at_ms >= record.issued_at_ms && at_ms <= record.expires_at_ms
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_hwnd(value: &str) -> bool {
    value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .filter(|digits| !digits.is_empty() && digits.len() <= 16)
        .and_then(|digits| u64::from_str_radix(digits, 16).ok())
        .is_some()
}

fn equal_hwnd(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}

fn opaque_token(prefix: &str) -> String {
    let mut bytes = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("{prefix}_{}", hex_bytes(&bytes))
}

fn hex_bytes(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

pub fn sha256_hex(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex_bytes(&hasher.finalize())
}

fn iso_timestamp(epoch_ms: i64) -> String {
    chrono::DateTime::<Utc>::from_timestamp_millis(epoch_ms)
        .unwrap_or_else(|| chrono::DateTime::<Utc>::from_timestamp_millis(0).unwrap())
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn public_reason_for(reason_token: &str) -> &'static str {
    let token = reason_token.to_ascii_lowercase();
    if matches!(
        token.as_str(),
        "none" | "ok" | "pass" | "passed" | "ready" | "inserted" | "succeeded" | "success"
    ) {
        return "none";
    }
    if token.contains("privacy") || token.contains("secret") || token.contains("sensitive") {
        return "privacy_blocked";
    }
    if token.contains("permission") || token.contains("authorization") || token.contains("consent")
    {
        return "permission_required";
    }
    if token.contains("readback") || token.contains("machine_read") || token.contains("unreadable")
    {
        return "readback_unavailable";
    }
    if token.contains("after_write_mismatch")
        || token.contains("write_mismatch")
        || token.contains("insert_failed")
        || token.contains("write_failed")
        || token.contains("paste_failed")
        || token.contains("not_verified")
    {
        return "write_not_verified";
    }
    if token.contains("safe_candidate")
        || token.contains("unsafe")
        || token.contains("auto_submit")
        || token.contains("payload_guard")
        || token.contains("wrong_target")
        || token.contains("safety")
    {
        return "safety_blocked";
    }
    if token.contains("target_changed")
        || token.contains("draft_changed")
        || token.contains("stale_payload")
        || token.contains("focus_changed")
        || token.contains("window_changed")
    {
        return "target_changed";
    }
    if token.contains("not_foreground")
        || token.contains("not_focused")
        || token.contains("focus_required")
        || token.contains("target_not_ready")
    {
        return "target_not_ready";
    }
    if token.contains("target_missing")
        || token.contains("not_found")
        || token.contains("hidden")
        || token.contains("minimized")
        || token.contains("cloaked")
        || token.contains("unsupported_target")
    {
        return "target_unavailable";
    }
    "unknown"
}

pub fn validate_result_semantics(result: &AdapterResult) -> Result<(), String> {
    if result.contract_version != RESULT_CONTRACT_VERSION {
        return Err("contract_version".to_string());
    }
    if !["inspect", "read", "insert", "undo"].contains(&result.operation.as_str()) {
        return Err("operation".to_string());
    }
    if !["ready", "blocked", "copy_only", "failed"].contains(&result.status.as_str()) {
        return Err("status".to_string());
    }
    if result.target != "codex" {
        return Err("target".to_string());
    }
    if result.public_reason != public_reason_for(&result.reason_token) {
        return Err("public_reason_mismatch".to_string());
    }
    if !result.no_auto_submit {
        return Err("safety_invariant".to_string());
    }
    if result.write_method == "controlled_clipboard" && result.clipboard_restored != Some(true) {
        return Err("clipboard_invariant".to_string());
    }
    if result.verified {
        let verified = result.operation == "insert"
            && result.status == "ready"
            && result.attempted
            && result.verification == "machine"
            && ["direct", "controlled_clipboard"].contains(&result.write_method.as_str())
            && result.foreground_verified
            && result.target_identity_verified
            && result.focus_verified
            && result.draft_unchanged
            && result.payload_fresh
            && result.readback_matched
            && result.no_auto_submit;
        if !verified {
            return Err("verification_invariant".to_string());
        }
    }
    let privacy = &result.privacy_flags;
    if privacy.raw_input_stored
        || privacy.generated_prompt_stored
        || privacy.chat_content_stored
        || privacy.clipboard_content_stored
        || privacy.window_title_stored
        || privacy.absolute_project_path_stored
        || privacy.credential_stored
        || privacy.raw_evidence_stored
    {
        return Err("privacy_flag".to_string());
    }
    Ok(())
}
