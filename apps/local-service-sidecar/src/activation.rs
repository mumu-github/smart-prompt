use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, io::ErrorKind, path::Path};

pub const SCHEMA_VERSION: &str = "phase3-activation@1";
pub const REQUIRED_EXTENSION_BUILD_ID: &str = "phase3-extension-20260717-r5";

const PROGRESS: [&str; 5] = [
    "not_started",
    "configuring",
    "model_ready",
    "awaiting_first_loop",
    "activated",
];
const RUNTIME_HEALTH: [&str; 3] = ["healthy", "repairing", "needs_repair"];
const STATE_FIELDS: [&str; 14] = [
    "schemaVersion",
    "progress",
    "runtimeHealth",
    "provider",
    "modelTestedAt",
    "browserSeenAt",
    "completionKind",
    "completionVerified",
    "completedAt",
    "lastEventId",
    "lastErrorCode",
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
            message: "Activation state could not be read or saved.",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
struct ActivationState {
    schema_version: String,
    progress: String,
    runtime_health: String,
    provider: String,
    model_tested_at: String,
    browser_seen_at: String,
    completion_kind: String,
    completion_verified: bool,
    completed_at: String,
    last_event_id: String,
    last_error_code: String,
    migration_applied_at: String,
    migration_source: String,
    updated_at: String,
}

impl Default for ActivationState {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION.to_string(),
            progress: "not_started".to_string(),
            runtime_health: "healthy".to_string(),
            provider: String::new(),
            model_tested_at: String::new(),
            browser_seen_at: String::new(),
            completion_kind: String::new(),
            completion_verified: false,
            completed_at: String::new(),
            last_event_id: String::new(),
            last_error_code: String::new(),
            migration_applied_at: String::new(),
            migration_source: String::new(),
            updated_at: now_iso(),
        }
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn safe_token(value: &str, max_length: usize) -> String {
    let normalized = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || "_.:+-".contains(character) {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    normalized
        .trim_matches('-')
        .chars()
        .take(max_length)
        .collect()
}

fn safe_iso(value: &str) -> String {
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

fn valid_event_id(value: &str) -> bool {
    let suffix = value
        .strip_prefix("activation-verified_insert-")
        .or_else(|| value.strip_prefix("activation-copy-"));
    suffix.is_some_and(|digits| {
        (10..=16).contains(&digits.len())
            && digits.chars().all(|character| character.is_ascii_digit())
    })
}

fn event_follows_model_test(value: &str, model_tested_at: &str) -> bool {
    let event_timestamp = value
        .rsplit_once('-')
        .and_then(|(_, digits)| digits.parse::<i64>().ok());
    let model_timestamp = DateTime::parse_from_rfc3339(model_tested_at)
        .ok()
        .map(|timestamp| timestamp.timestamp_millis());
    matches!((event_timestamp, model_timestamp), (Some(event), Some(model)) if event > model)
}

fn normalize(mut state: ActivationState) -> ActivationState {
    state.schema_version = SCHEMA_VERSION.to_string();
    if !PROGRESS.contains(&state.progress.as_str()) {
        state.progress = "not_started".to_string();
    }
    if !RUNTIME_HEALTH.contains(&state.runtime_health.as_str()) {
        state.runtime_health = "healthy".to_string();
    }
    state.provider = safe_token(&state.provider, 80);
    state.model_tested_at = safe_iso(&state.model_tested_at);
    state.browser_seen_at = safe_iso(&state.browser_seen_at);
    state.completion_kind = safe_token(&state.completion_kind, 80);
    state.completed_at = safe_iso(&state.completed_at);
    state.last_event_id = if state.last_event_id == "legacy-migration" {
        state.last_event_id
    } else if valid_event_id(&state.last_event_id) {
        state.last_event_id
    } else {
        String::new()
    };
    state.last_error_code = safe_token(&state.last_error_code, 80);
    state.migration_applied_at = safe_iso(&state.migration_applied_at);
    state.migration_source = safe_token(&state.migration_source, 80);
    state.updated_at = now_iso();
    state
}

fn state_file(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join("activation.json")
}

fn read_state(data_dir: &Path) -> Result<ActivationState, ActivationError> {
    let file = state_file(data_dir);
    let text = match fs::read_to_string(&file) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(ActivationState::default()),
        Err(_) => return Err(ActivationError::storage()),
    };
    let raw: Value = serde_json::from_str(&text).map_err(|_| ActivationError::storage())?;
    let should_sanitize = !raw.is_object()
        || raw.as_object().is_some_and(|object| {
            object
                .keys()
                .any(|key| !STATE_FIELDS.contains(&key.as_str()))
        });
    let state: ActivationState =
        serde_json::from_value(raw).map_err(|_| ActivationError::storage())?;
    let normalized = normalize(state);
    if should_sanitize {
        write_state(data_dir, normalized.clone())?;
    }
    Ok(normalized)
}

fn write_state(
    data_dir: &Path,
    state: ActivationState,
) -> Result<ActivationState, ActivationError> {
    fs::create_dir_all(data_dir).map_err(|_| ActivationError::storage())?;
    let normalized = normalize(state);
    let text = serde_json::to_string_pretty(&normalized).map_err(|_| ActivationError::storage())?;
    fs::write(state_file(data_dir), format!("{text}\n")).map_err(|_| ActivationError::storage())?;
    Ok(normalized)
}

fn next_action(state: &ActivationState) -> &'static str {
    if state.runtime_health == "needs_repair" {
        return "repair_runtime";
    }
    if state.progress == "awaiting_first_loop" && state.model_tested_at.is_empty() {
        return "test_model";
    }
    match state.progress.as_str() {
        "not_started" | "configuring" => "configure_provider",
        "model_ready" => "open_chatgpt",
        "awaiting_first_loop" => "finish_first_loop",
        "activated" => "open_assistant",
        _ => "configure_provider",
    }
}

fn public_status(state: &ActivationState) -> Value {
    json!({
        "schemaVersion": SCHEMA_VERSION,
        "progress": state.progress,
        "runtimeHealth": state.runtime_health,
        "provider": state.provider,
        "modelTestedAt": state.model_tested_at,
        "browserSeenAt": state.browser_seen_at,
        "completionKind": state.completion_kind,
        "completionVerified": state.completion_verified,
        "completedAt": state.completed_at,
        "lastErrorCode": state.last_error_code,
        "nextAction": next_action(state),
        "privacy": {
            "promptTextNotStored": true,
            "draftTextNotStored": true,
            "targetInputTextNotStored": true,
            "clipboardTextNotStored": true,
            "rawTitleNotStored": true,
            "rawDomTextNotStored": true,
            "apiKeyNotStored": true,
            "noAutoSubmitRequired": true
        }
    })
}

pub fn initialize(
    data_dir: &Path,
    legacy_data_present: bool,
    has_provider: bool,
    provider: &str,
    historical_events: &[Value],
) -> Result<(), ActivationError> {
    if state_file(data_dir).exists() {
        let _ = get_status(data_dir)?;
        return Ok(());
    }

    if !legacy_data_present {
        write_state(data_dir, ActivationState::default())?;
        return Ok(());
    }

    let migrated_at = now_iso();
    let mut state = ActivationState {
        provider: safe_token(provider, 80),
        migration_applied_at: migrated_at.clone(),
        migration_source: "legacy".to_string(),
        ..ActivationState::default()
    };
    if !has_provider {
        state.progress = "configuring".to_string();
        state.provider.clear();
        write_state(data_dir, state)?;
        return Ok(());
    }

    let evidence = historical_events.iter().find(|event| {
        let source = event
            .get("source")
            .or_else(|| event.get("eventSource"))
            .or_else(|| event.get("channel"))
            .and_then(Value::as_str)
            .map(|value| safe_token(value, 80))
            .unwrap_or_default();
        let site = event
            .get("site")
            .or_else(|| event.get("adapterId"))
            .and_then(Value::as_str)
            .map(|value| safe_token(value, 80))
            .unwrap_or_default();
        let action = event.get("action").and_then(Value::as_str).unwrap_or("");
        source == "browser-extension"
            && (site == "chatgpt" || site == "chatgpt.com")
            && (action == "insert" || action == "copy")
            && event.get("verified").and_then(Value::as_bool) == Some(true)
    });

    if let Some(event) = evidence {
        let action = event.get("action").and_then(Value::as_str).unwrap_or("");
        state.progress = "activated".to_string();
        state.completion_kind = if action == "insert" {
            "verified_insert".to_string()
        } else {
            "copy".to_string()
        };
        state.completion_verified = action == "insert";
        state.completed_at = event
            .get("created_at")
            .or_else(|| event.get("createdAt"))
            .and_then(Value::as_str)
            .map(safe_iso)
            .filter(|value| !value.is_empty())
            .unwrap_or(migrated_at);
        state.last_event_id = "legacy-migration".to_string();
    } else {
        state.progress = "awaiting_first_loop".to_string();
    }
    write_state(data_dir, state)?;
    Ok(())
}

pub fn get_status(data_dir: &Path) -> Result<Value, ActivationError> {
    Ok(public_status(&read_state(data_dir)?))
}

pub fn record_settings_saved(data_dir: &Path, provider: &str) -> Result<Value, ActivationError> {
    let mut state = read_state(data_dir)?;
    if state.progress == "not_started" {
        state.progress = "configuring".to_string();
        state.provider = safe_token(provider, 80);
        state.last_error_code.clear();
        state = write_state(data_dir, state)?;
    }
    Ok(public_status(&state))
}

pub fn record_model_ready(data_dir: &Path, provider: &str) -> Result<Value, ActivationError> {
    let mut state = read_state(data_dir)?;
    if ![
        "configuring",
        "model_ready",
        "awaiting_first_loop",
        "activated",
    ]
    .contains(&state.progress.as_str())
    {
        return Err(ActivationError::bad_request(
            "activation_not_ready_for_model_test",
            "Activation is not ready for a model test.",
        ));
    }
    if state.progress == "configuring" {
        state.progress = "model_ready".to_string();
    }
    state.provider = safe_token(provider, 80);
    state.model_tested_at = now_iso();
    state.last_error_code.clear();
    let state = write_state(data_dir, state)?;
    Ok(public_status(&state))
}

pub fn mark_browser_seen(
    data_dir: &Path,
    site: &str,
    seen_at: &str,
) -> Result<Value, ActivationError> {
    if safe_token(site, 80) != "chatgpt" {
        return Err(ActivationError::bad_request(
            "unsupported_activation_site",
            "Only the ChatGPT activation target is supported in phase 3.",
        ));
    }
    let mut state = read_state(data_dir)?;
    if !["model_ready", "awaiting_first_loop", "activated"].contains(&state.progress.as_str()) {
        return Err(ActivationError::bad_request(
            "activation_not_ready_for_browser_seen",
            "Activation is not ready for browser verification.",
        ));
    }
    let timestamp = if seen_at.trim().is_empty() {
        now_iso()
    } else {
        safe_iso(seen_at)
    };
    if timestamp.is_empty() {
        return Err(ActivationError::bad_request(
            "invalid_activation_timestamp",
            "Activation browser timestamp is invalid.",
        ));
    }
    if state.progress == "model_ready" {
        state.progress = "awaiting_first_loop".to_string();
    }
    state.browser_seen_at = timestamp;
    let state = write_state(data_dir, state)?;
    Ok(public_status(&state))
}

pub fn complete(
    data_dir: &Path,
    event_id: &str,
    site: &str,
    completion_kind: &str,
    target_kind: &str,
    stable_readback: bool,
    extension_build_id: &str,
    verified: bool,
    copied: bool,
) -> Result<Value, ActivationError> {
    if safe_token(site, 80) != "chatgpt" {
        return Err(ActivationError::bad_request(
            "unsupported_activation_site",
            "Only the ChatGPT activation target is supported in phase 3.",
        ));
    }
    let mut state = read_state(data_dir)?;
    if state.progress == "activated" {
        return Ok(public_status(&state));
    }
    if state.progress != "awaiting_first_loop" {
        return Err(ActivationError::bad_request(
            "activation_not_ready_for_completion",
            "Activation requires a real first loop before completion.",
        ));
    }
    let kind = safe_token(completion_kind, 80);
    let event_matches_kind = match kind.as_str() {
        "verified_insert" => event_id.starts_with("activation-verified_insert-"),
        "copy" => event_id.starts_with("activation-copy-"),
        _ => false,
    };
    if !valid_event_id(event_id)
        || !event_matches_kind
        || !event_follows_model_test(event_id, &state.model_tested_at)
    {
        return Err(ActivationError::bad_request(
            "invalid_activation_event_id",
            "Activation completion event id is invalid.",
        ));
    }
    let current_extension = extension_build_id == REQUIRED_EXTENSION_BUILD_ID;
    let valid_insert = current_extension
        && kind == "verified_insert"
        && target_kind == "chatgpt-composer"
        && stable_readback
        && verified;
    let valid_copy = current_extension && kind == "copy" && copied;
    if !valid_insert && !valid_copy {
        return Err(ActivationError::bad_request(
            "invalid_activation_completion_evidence",
            "Activation completion evidence is not valid.",
        ));
    }
    state.progress = "activated".to_string();
    state.completion_kind = kind;
    state.completion_verified = valid_insert;
    state.completed_at = now_iso();
    state.last_event_id = event_id.to_string();
    state.runtime_health = "healthy".to_string();
    state.last_error_code.clear();
    let state = write_state(data_dir, state)?;
    Ok(public_status(&state))
}

pub fn set_runtime_health(
    data_dir: &Path,
    runtime_health: &str,
    error_code: &str,
) -> Result<Value, ActivationError> {
    if !RUNTIME_HEALTH.contains(&runtime_health) {
        return Err(ActivationError::bad_request(
            "invalid_runtime_health",
            "Runtime health update was rejected.",
        ));
    }
    let mut state = read_state(data_dir)?;
    state.runtime_health = runtime_health.to_string();
    state.last_error_code = if runtime_health == "healthy" {
        String::new()
    } else {
        safe_token(error_code, 80)
    };
    let state = write_state(data_dir, state)?;
    Ok(public_status(&state))
}

pub fn reset(data_dir: &Path) -> Result<Value, ActivationError> {
    let state = read_state(data_dir)?;
    let reset = ActivationState {
        provider: state.provider,
        migration_applied_at: state.migration_applied_at,
        migration_source: state.migration_source,
        ..ActivationState::default()
    };
    let reset = write_state(data_dir, reset)?;
    Ok(public_status(&reset))
}
