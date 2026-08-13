use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

pub const SCHEMA_VERSION: &str = "codex-activation@2";
pub const CODEX_ACTIVATION_SCHEMA_VERSION: &str = SCHEMA_VERSION;
pub const PHASE3_ACTIVATION_SCHEMA_VERSION: &str = "phase3-activation@1";
pub const REQUIRED_NATIVE_BUILD_ID: &str = "phase3-native-sidecar-20260719-r18";
pub const CODEX_ACTIVATION_PROGRESS: [&str; 5] = [
    "not_started",
    "configuring",
    "model_ready",
    "awaiting_codex_loop",
    "activated",
];
pub const ACTIVATION_PROGRESS: [&str; 5] = CODEX_ACTIVATION_PROGRESS;
pub const RUNTIME_HEALTH: [&str; 3] = ["healthy", "repairing", "needs_repair"];

const PHASE3_PROGRESS: [&str; 5] = [
    "not_started",
    "configuring",
    "model_ready",
    "awaiting_first_loop",
    "activated",
];
const PHASE3_COMPLETION_KINDS: [&str; 3] = ["", "verified_insert", "copy"];
const STATE_FIELDS: [&str; 14] = [
    "schemaVersion",
    "progress",
    "runtimeHealth",
    "provider",
    "modelTestedAt",
    "legacyActivated",
    "legacySummary",
    "codexVerified",
    "completedAt",
    "completionEventId",
    "completionSignature",
    "migrationAppliedAt",
    "migrationSource",
    "updatedAt",
];

#[derive(Debug)]
pub struct ActivationError {
    pub status: u16,
    pub code: &'static str,
    pub message: &'static str,
}

impl ActivationError {
    fn bad_request(code: &'static str, message: &'static str) -> Self {
        Self {
            status: 400,
            code,
            message,
        }
    }

    fn storage() -> Self {
        Self {
            status: 500,
            code: "activation_storage_error",
            message: "Codex activation state could not be read or saved.",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacySummary {
    schema_version: String,
    progress: String,
    runtime_health: String,
    completion_kind: String,
    completion_verified: bool,
    completed_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivationState {
    schema_version: String,
    progress: String,
    runtime_health: String,
    provider: String,
    model_tested_at: String,
    legacy_activated: bool,
    legacy_summary: Option<LegacySummary>,
    codex_verified: bool,
    completed_at: String,
    completion_event_id: String,
    completion_signature: String,
    migration_applied_at: String,
    migration_source: String,
    updated_at: String,
}

#[derive(Debug)]
struct CompletionEvidence {
    event_id: String,
    raw_event_id_present: bool,
    target: String,
    site: String,
    target_conflict: bool,
    completion_kind: String,
    target_kind: String,
    stable_readback: bool,
    verified: bool,
    no_auto_submit: bool,
    native_build_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignaturePayload<'a> {
    event_id: &'a str,
    target: &'a str,
    site: &'a str,
    target_conflict: bool,
    completion_kind: &'a str,
    target_kind: &'a str,
    stable_readback: bool,
    verified: bool,
    no_auto_submit: bool,
    native_build_id: &'a str,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn string_field<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

fn bool_field(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool) == Some(true)
}

fn safe_iso(value: &str) -> String {
    let value = value.trim();
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
        || bytes.get(19) != Some(&b'.')
        || bytes.get(23) != Some(&b'Z')
    {
        return String::new();
    }
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| {
            timestamp
                .with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Millis, true)
        })
        .unwrap_or_default()
}

fn safe_iso_or(value: &str, fallback: &str) -> String {
    let timestamp = safe_iso(value);
    if timestamp.is_empty() {
        fallback.to_string()
    } else {
        timestamp
    }
}

fn safe_provider_token(value: &str) -> String {
    let token = value.trim();
    if token.is_empty()
        || token.len() > 80
        || !token.as_bytes()[0].is_ascii_alphanumeric()
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.:+-".contains(&byte))
    {
        String::new()
    } else {
        token.to_string()
    }
}

fn safe_provider_token_or(value: &str, fallback: &str) -> String {
    let token = safe_provider_token(value);
    if token.is_empty() {
        fallback.to_string()
    } else {
        token
    }
}

fn safe_event_id(value: &str) -> String {
    let event_id = value.trim();
    let Some(digits) = event_id.strip_prefix("activation-verified_insert-") else {
        return String::new();
    };
    if (10..=16).contains(&digits.len()) && digits.bytes().all(|byte| byte.is_ascii_digit()) {
        event_id.to_string()
    } else {
        String::new()
    }
}

fn event_follows_model_test(event_id: &str, model_tested_at: &str) -> bool {
    let event_timestamp = safe_event_id(event_id)
        .rsplit_once('-')
        .and_then(|(_, digits)| digits.parse::<i64>().ok());
    let model_timestamp = DateTime::parse_from_rfc3339(model_tested_at)
        .ok()
        .map(|timestamp| timestamp.timestamp_millis());
    matches!((event_timestamp, model_timestamp), (Some(event), Some(model)) if event > model)
}

fn safe_legacy_summary(raw: Option<&Value>) -> Option<LegacySummary> {
    let raw = raw.filter(|value| value.is_object())?;
    let progress = string_field(raw, "progress");
    let progress = if PHASE3_PROGRESS.contains(&progress) {
        progress
    } else {
        "not_started"
    };
    let runtime_health = string_field(raw, "runtimeHealth");
    let runtime_health = if RUNTIME_HEALTH.contains(&runtime_health) {
        runtime_health
    } else {
        "healthy"
    };
    let completion_kind = string_field(raw, "completionKind");
    let completion_kind = if PHASE3_COMPLETION_KINDS.contains(&completion_kind) {
        completion_kind
    } else {
        ""
    };
    Some(LegacySummary {
        schema_version: PHASE3_ACTIVATION_SCHEMA_VERSION.to_string(),
        progress: progress.to_string(),
        runtime_health: runtime_health.to_string(),
        completion_kind: completion_kind.to_string(),
        completion_verified: completion_kind == "verified_insert"
            && bool_field(raw, "completionVerified"),
        completed_at: safe_iso(string_field(raw, "completedAt")),
    })
}

fn default_state(timestamp: &str) -> ActivationState {
    let fallback = now_iso();
    ActivationState {
        schema_version: SCHEMA_VERSION.to_string(),
        progress: "not_started".to_string(),
        runtime_health: "healthy".to_string(),
        provider: String::new(),
        model_tested_at: String::new(),
        legacy_activated: false,
        legacy_summary: None,
        codex_verified: false,
        completed_at: String::new(),
        completion_event_id: String::new(),
        completion_signature: String::new(),
        migration_applied_at: String::new(),
        migration_source: String::new(),
        updated_at: safe_iso_or(timestamp, &fallback),
    }
}

fn normalize(raw: &Value, timestamp: &str) -> ActivationState {
    let defaults = default_state(timestamp);
    let source = if raw.is_object() { raw } else { &Value::Null };
    let progress = string_field(source, "progress");
    let mut progress = if CODEX_ACTIVATION_PROGRESS.contains(&progress) {
        progress.to_string()
    } else {
        defaults.progress.clone()
    };
    let runtime_health = string_field(source, "runtimeHealth");
    let runtime_health = if RUNTIME_HEALTH.contains(&runtime_health) {
        runtime_health.to_string()
    } else {
        defaults.runtime_health.clone()
    };
    let provider = safe_provider_token(string_field(source, "provider"));
    let model_tested_at = safe_iso(string_field(source, "modelTestedAt"));
    let legacy_summary = safe_legacy_summary(source.get("legacySummary"));
    let completed_at = safe_iso(string_field(source, "completedAt"));
    let completion_event_id = safe_event_id(string_field(source, "completionEventId"));
    let completion_signature = string_field(source, "completionSignature");
    let completion_signature = if completion_signature.len() == 64
        && completion_signature
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        completion_signature.to_string()
    } else {
        String::new()
    };
    let has_valid_completion = progress == "activated"
        && bool_field(source, "codexVerified")
        && !completed_at.is_empty()
        && !completion_signature.is_empty()
        && event_follows_model_test(&completion_event_id, &model_tested_at);

    if progress == "activated" && !has_valid_completion {
        progress = if !model_tested_at.is_empty() {
            "model_ready"
        } else if !provider.is_empty() {
            "configuring"
        } else {
            "not_started"
        }
        .to_string();
    }

    ActivationState {
        schema_version: SCHEMA_VERSION.to_string(),
        progress,
        runtime_health,
        provider,
        model_tested_at,
        legacy_activated: legacy_summary
            .as_ref()
            .is_some_and(|summary| summary.progress == "activated"),
        legacy_summary,
        codex_verified: has_valid_completion,
        completed_at: if has_valid_completion {
            completed_at
        } else {
            String::new()
        },
        completion_event_id: if has_valid_completion {
            completion_event_id
        } else {
            String::new()
        },
        completion_signature: if has_valid_completion {
            completion_signature
        } else {
            String::new()
        },
        migration_applied_at: safe_iso(string_field(source, "migrationAppliedAt")),
        migration_source: if string_field(source, "migrationSource") == "phase3-public-snapshot" {
            "phase3-public-snapshot".to_string()
        } else {
            String::new()
        },
        updated_at: safe_iso_or(string_field(source, "updatedAt"), &defaults.updated_at),
    }
}

pub fn state_file(data_dir: &Path) -> PathBuf {
    data_dir.join("activation-v2.json")
}

fn write_raw_state(data_dir: &Path, state: &ActivationState) -> Result<(), ActivationError> {
    fs::create_dir_all(data_dir).map_err(|_| ActivationError::storage())?;
    let text = serde_json::to_string_pretty(state).map_err(|_| ActivationError::storage())?;
    fs::write(state_file(data_dir), format!("{text}\n")).map_err(|_| ActivationError::storage())
}

fn read_state(data_dir: &Path) -> Result<ActivationState, ActivationError> {
    let file = state_file(data_dir);
    let (raw, parsed) = match fs::read_to_string(&file) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(value) => (value, true),
            Err(_) => (Value::Null, false),
        },
        Err(error) if error.kind() == ErrorKind::NotFound => (Value::Null, false),
        Err(_) => return Err(ActivationError::storage()),
    };
    let state = normalize(&raw, &now_iso());
    let normalized = serde_json::to_value(&state).map_err(|_| ActivationError::storage())?;
    let has_only_state_fields = parsed
        && raw.as_object().is_some_and(|object| {
            object
                .keys()
                .all(|key| STATE_FIELDS.contains(&key.as_str()))
        });
    if !has_only_state_fields || raw != normalized {
        write_raw_state(data_dir, &state)?;
    }
    Ok(state)
}

fn write_state(
    data_dir: &Path,
    mut state: ActivationState,
) -> Result<ActivationState, ActivationError> {
    let timestamp = now_iso();
    state.updated_at = timestamp.clone();
    let raw = serde_json::to_value(state).map_err(|_| ActivationError::storage())?;
    let normalized = normalize(&raw, &timestamp);
    write_raw_state(data_dir, &normalized)?;
    Ok(normalized)
}

fn status_tokens(state: &ActivationState) -> (&'static str, &'static str) {
    match state.runtime_health.as_str() {
        "repairing" => ("runtime_repairing", "wait_for_runtime"),
        "needs_repair" => ("runtime_needs_repair", "repair_runtime"),
        _ => match state.progress.as_str() {
            "not_started" => ("codex_activation_not_started", "configure_provider"),
            "configuring" => ("provider_configuration_required", "test_model"),
            "model_ready" => (
                "model_ready_codex_verification_required",
                "start_codex_loop",
            ),
            "awaiting_codex_loop" => ("codex_verification_required", "complete_codex_loop"),
            "activated" => ("codex_activation_complete", "open_assistant"),
            _ => ("codex_activation_not_started", "configure_provider"),
        },
    }
}

fn public_status(state: &ActivationState) -> Value {
    let (reason, next_action) = status_tokens(state);
    json!({
        "schemaVersion": SCHEMA_VERSION,
        "progress": state.progress,
        "runtimeHealth": state.runtime_health,
        "provider": state.provider,
        "modelTestedAt": state.model_tested_at,
        "legacyActivated": state.legacy_activated,
        "legacySummary": state.legacy_summary,
        "codexVerified": state.codex_verified,
        "completedAt": state.completed_at,
        "reason": reason,
        "nextAction": next_action,
        "privacy": {
            "promptTextNotStored": true,
            "draftTextNotStored": true,
            "targetInputTextNotStored": true,
            "clipboardTextNotStored": true,
            "projectPathNotStored": true,
            "rawTitleNotStored": true,
            "apiKeyNotStored": true,
            "evidencePayloadNotExposed": true,
            "noAutoSubmitRequired": true
        }
    })
}

fn transition_allowed(current: &str, next: &str) -> bool {
    matches!(
        (current, next),
        ("not_started", "configuring")
            | ("configuring", "model_ready")
            | ("model_ready", "awaiting_codex_loop")
    )
}

fn completion_evidence(payload: &Value) -> CompletionEvidence {
    let raw_event_id = string_field(payload, "eventId").trim();
    let target = safe_provider_token(string_field(payload, "target"));
    let site = safe_provider_token(string_field(payload, "site"));
    let effective_target = if target.is_empty() {
        site.clone()
    } else {
        target.clone()
    };
    CompletionEvidence {
        event_id: safe_event_id(raw_event_id),
        raw_event_id_present: !raw_event_id.is_empty(),
        target: effective_target,
        site: site.clone(),
        target_conflict: !target.is_empty() && !site.is_empty() && target != site,
        completion_kind: string_field(payload, "completionKind").trim().to_string(),
        target_kind: string_field(payload, "targetKind").trim().to_string(),
        stable_readback: bool_field(payload, "stableReadback"),
        verified: bool_field(payload, "verified"),
        no_auto_submit: bool_field(payload, "noAutoSubmit"),
        native_build_id: string_field(payload, "nativeBuildId").trim().to_string(),
    }
}

fn completion_signature(evidence: &CompletionEvidence) -> Result<String, ActivationError> {
    let canonical = serde_json::to_string(&SignaturePayload {
        event_id: &evidence.event_id,
        target: &evidence.target,
        site: &evidence.site,
        target_conflict: evidence.target_conflict,
        completion_kind: &evidence.completion_kind,
        target_kind: &evidence.target_kind,
        stable_readback: evidence.stable_readback,
        verified: evidence.verified,
        no_auto_submit: evidence.no_auto_submit,
        native_build_id: &evidence.native_build_id,
    })
    .map_err(|_| ActivationError::storage())?;
    Ok(format!("{:x}", Sha256::digest(canonical.as_bytes())))
}

fn valid_codex_completion_evidence(evidence: &CompletionEvidence) -> bool {
    evidence.target == "codex"
        && (evidence.site.is_empty() || evidence.site == "codex")
        && !evidence.target_conflict
        && evidence.completion_kind == "verified_insert"
        && evidence.target_kind == "codex-composer"
        && evidence.stable_readback
        && evidence.verified
        && evidence.no_auto_submit
        && evidence.native_build_id == REQUIRED_NATIVE_BUILD_ID
}

pub fn initialize(
    data_dir: &Path,
    phase3_snapshot: Option<&Value>,
) -> Result<Value, ActivationError> {
    let state = read_state(data_dir)?;
    if let Some(snapshot) = phase3_snapshot {
        initialize_from_phase3(data_dir, snapshot)
    } else {
        Ok(public_status(&state))
    }
}

pub fn get_status(data_dir: &Path) -> Result<Value, ActivationError> {
    Ok(public_status(&read_state(data_dir)?))
}

pub fn initialize_from_phase3(data_dir: &Path, snapshot: &Value) -> Result<Value, ActivationError> {
    if !snapshot.is_object()
        || snapshot.get("schemaVersion").is_some_and(|value| {
            value.as_str().is_none_or(|schema| {
                !schema.is_empty() && schema != PHASE3_ACTIVATION_SCHEMA_VERSION
            })
        })
    {
        return Err(ActivationError::bad_request(
            "invalid_phase3_activation_snapshot",
            "A supported phase 3 public activation snapshot is required.",
        ));
    }

    let state = read_state(data_dir)?;
    let has_codex_progress = state.progress != "not_started"
        || !state.provider.is_empty()
        || !state.model_tested_at.is_empty()
        || state.codex_verified;
    if !state.migration_applied_at.is_empty() || has_codex_progress {
        return Ok(public_status(&state));
    }

    let provider = safe_provider_token(string_field(snapshot, "provider"));
    let model_tested_at = safe_iso(string_field(snapshot, "modelTestedAt"));
    let legacy_summary = safe_legacy_summary(Some(snapshot));
    let runtime_health = string_field(snapshot, "runtimeHealth");
    let runtime_health = if RUNTIME_HEALTH.contains(&runtime_health) {
        runtime_health.to_string()
    } else {
        "healthy".to_string()
    };
    let progress = if !model_tested_at.is_empty() {
        "model_ready"
    } else if !provider.is_empty() {
        "configuring"
    } else {
        "not_started"
    };
    let migrated_at = now_iso();
    let mut migrated = default_state(&migrated_at);
    migrated.progress = progress.to_string();
    migrated.runtime_health = runtime_health;
    migrated.provider = provider;
    migrated.model_tested_at = model_tested_at;
    migrated.legacy_activated = legacy_summary
        .as_ref()
        .is_some_and(|summary| summary.progress == "activated");
    migrated.legacy_summary = legacy_summary;
    migrated.migration_applied_at = migrated_at;
    migrated.migration_source = "phase3-public-snapshot".to_string();
    Ok(public_status(&write_state(data_dir, migrated)?))
}

pub fn migrate_from_phase3(data_dir: &Path, snapshot: &Value) -> Result<Value, ActivationError> {
    initialize_from_phase3(data_dir, snapshot)
}

pub fn set_progress(
    data_dir: &Path,
    progress: &str,
    metadata: &Value,
) -> Result<Value, ActivationError> {
    if !CODEX_ACTIVATION_PROGRESS.contains(&progress) {
        return Err(ActivationError::bad_request(
            "invalid_codex_activation_progress",
            "The Codex activation progress token is not supported.",
        ));
    }
    let mut state = read_state(data_dir)?;
    if progress == "activated" {
        if state.progress == "activated" {
            return Ok(public_status(&state));
        }
        return Err(ActivationError::bad_request(
            "invalid_codex_activation_transition",
            "Codex activation can only complete from verified evidence.",
        ));
    }
    if state.progress != progress && !transition_allowed(&state.progress, progress) {
        return Err(ActivationError::bad_request(
            "invalid_codex_activation_transition",
            "The requested Codex activation transition is not allowed.",
        ));
    }

    if metadata
        .as_object()
        .is_some_and(|object| object.contains_key("provider"))
    {
        state.provider =
            safe_provider_token_or(string_field(metadata, "provider"), &state.provider);
    }
    if progress == "model_ready" {
        let requested_timestamp = ["modelTestedAt", "testedAt"]
            .into_iter()
            .map(|key| string_field(metadata, key).trim())
            .find(|value| !value.is_empty())
            .unwrap_or("");
        state.model_tested_at = safe_iso_or(requested_timestamp, &state.model_tested_at);
        if state.model_tested_at.is_empty() {
            return Err(ActivationError::bad_request(
                "activation_model_test_required",
                "A successful model test timestamp is required before Codex verification.",
            ));
        }
    }
    if progress == "awaiting_codex_loop" && state.model_tested_at.is_empty() {
        return Err(ActivationError::bad_request(
            "activation_model_test_required",
            "A successful model test is required before the Codex loop.",
        ));
    }
    state.progress = progress.to_string();
    Ok(public_status(&write_state(data_dir, state)?))
}

pub fn record_model_ready(data_dir: &Path, provider: &str) -> Result<Value, ActivationError> {
    record_model_ready_at(data_dir, provider, "")
}

pub fn record_model_ready_at(
    data_dir: &Path,
    provider: &str,
    tested_at: &str,
) -> Result<Value, ActivationError> {
    let mut state = read_state(data_dir)?;
    if state.progress == "activated" {
        return Ok(public_status(&state));
    }
    if !["configuring", "model_ready", "awaiting_codex_loop"].contains(&state.progress.as_str()) {
        return Err(ActivationError::bad_request(
            "activation_not_ready_for_model_test",
            "Codex activation is not ready for a model test.",
        ));
    }
    let model_tested_at = if tested_at.trim().is_empty() {
        now_iso()
    } else {
        safe_iso(tested_at)
    };
    if model_tested_at.is_empty() {
        return Err(ActivationError::bad_request(
            "invalid_activation_timestamp",
            "The model test timestamp is invalid.",
        ));
    }
    state.progress = "model_ready".to_string();
    state.provider = safe_provider_token_or(provider, &state.provider);
    state.model_tested_at = model_tested_at;
    Ok(public_status(&write_state(data_dir, state)?))
}

pub fn mark_codex_loop_started(data_dir: &Path) -> Result<Value, ActivationError> {
    let mut state = read_state(data_dir)?;
    if state.progress == "activated" {
        return Ok(public_status(&state));
    }
    if !["model_ready", "awaiting_codex_loop"].contains(&state.progress.as_str())
        || state.model_tested_at.is_empty()
    {
        return Err(ActivationError::bad_request(
            "activation_not_ready_for_codex_loop",
            "Codex activation requires a successful model test first.",
        ));
    }
    if state.progress == "awaiting_codex_loop" {
        return Ok(public_status(&state));
    }
    state.progress = "awaiting_codex_loop".to_string();
    Ok(public_status(&write_state(data_dir, state)?))
}

pub fn begin_codex_loop(data_dir: &Path) -> Result<Value, ActivationError> {
    mark_codex_loop_started(data_dir)
}

pub fn complete(data_dir: &Path, payload: &Value) -> Result<Value, ActivationError> {
    let mut state = read_state(data_dir)?;
    let evidence = completion_evidence(payload);
    let signature = completion_signature(&evidence)?;

    if state.progress == "activated" && state.codex_verified {
        if state.completion_event_id == evidence.event_id && state.completion_signature == signature
        {
            return Ok(public_status(&state));
        }
        return Err(ActivationError::bad_request(
            "activation_completion_conflict",
            "Codex activation has already completed with different evidence.",
        ));
    }
    if state.progress != "awaiting_codex_loop" {
        return Err(ActivationError::bad_request(
            "activation_not_ready_for_completion",
            "Codex activation is not ready for completion.",
        ));
    }
    if evidence.event_id.is_empty()
        || !evidence.raw_event_id_present
        || !event_follows_model_test(&evidence.event_id, &state.model_tested_at)
    {
        return Err(ActivationError::bad_request(
            "invalid_activation_event_id",
            "The Codex activation event id is invalid or stale.",
        ));
    }
    if !valid_codex_completion_evidence(&evidence) {
        return Err(ActivationError::bad_request(
            "invalid_codex_activation_evidence",
            "Codex activation requires verified safe insertion evidence.",
        ));
    }

    state.progress = "activated".to_string();
    state.codex_verified = true;
    state.completed_at = now_iso();
    state.completion_event_id = evidence.event_id;
    state.completion_signature = signature;
    Ok(public_status(&write_state(data_dir, state)?))
}

pub fn complete_codex_activation(
    data_dir: &Path,
    payload: &Value,
) -> Result<Value, ActivationError> {
    complete(data_dir, payload)
}

pub fn set_runtime_health(data_dir: &Path, runtime_health: &str) -> Result<Value, ActivationError> {
    if !RUNTIME_HEALTH.contains(&runtime_health) {
        return Err(ActivationError::bad_request(
            "invalid_runtime_health",
            "The runtime health token is not supported.",
        ));
    }
    let mut state = read_state(data_dir)?;
    state.runtime_health = runtime_health.to_string();
    Ok(public_status(&write_state(data_dir, state)?))
}

pub fn reset_progress(data_dir: &Path) -> Result<Value, ActivationError> {
    let state = read_state(data_dir)?;
    let mut reset = default_state(&now_iso());
    reset.runtime_health = state.runtime_health;
    reset.provider = state.provider;
    reset.legacy_activated = state.legacy_activated;
    reset.legacy_summary = state.legacy_summary;
    reset.migration_applied_at = state.migration_applied_at;
    reset.migration_source = state.migration_source;
    Ok(public_status(&write_state(data_dir, reset)?))
}

pub fn reset(data_dir: &Path) -> Result<Value, ActivationError> {
    reset_progress(data_dir)
}
