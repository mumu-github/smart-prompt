#![allow(dead_code)]

use crate::outcome_contracts::validate_contract;
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    error::Error,
    fmt,
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

pub const STORE_SCHEMA_VERSION: &str = "pending-outcome-store@1";
pub const STORE_FILE_NAME: &str = "pending-outcomes-v1.json";
pub const STORE_BACKUP_FILE_NAME: &str = "pending-outcomes-v1.backup.json";
pub const FEEDBACK_DELAY_MS: i64 = 60_000;
pub const OUTCOME_TTL_MS: i64 = 86_400_000;
pub const IMPLICIT_SIGNAL_TYPES: [&str; 4] = ["retry", "undo", "regenerated", "insert_failed"];
pub const FAILURE_REASON_TOKENS: [&str; 8] = [
    "missing_context",
    "wrong_format",
    "not_actionable",
    "too_long",
    "token_waste",
    "tool_mismatch",
    "low_quality",
    "insert_failed",
];

const FEEDBACK_STATES: [&str; 6] = [
    "unasked",
    "asked",
    "reason_required",
    "resolved",
    "expired",
    "invalidated",
];
const PENDING_OUTCOME_STATUSES: [&str; 5] = [
    "unknown",
    "succeeded",
    "failed",
    "expired_unknown",
    "invalidated",
];
const PRIVACY_FLAG_NAMES: [&str; 8] = [
    "rawInputStored",
    "generatedPromptStored",
    "chatContentStored",
    "clipboardContentStored",
    "windowTitleStored",
    "absoluteProjectPathStored",
    "credentialStored",
    "rawEvidenceStored",
];

static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutcomeErrorDetail {
    pub code: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingOutcomeError {
    pub status: u16,
    pub code: &'static str,
    pub message: String,
    pub details: Vec<OutcomeErrorDetail>,
}

impl PendingOutcomeError {
    fn new(status: u16, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            details: Vec::new(),
        }
    }

    fn with_details(mut self, details: Vec<OutcomeErrorDetail>) -> Self {
        self.details = details;
        self
    }

    fn bad_request(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(400, code, message)
    }

    fn conflict(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(409, code, message)
    }

    fn not_found(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(404, code, message)
    }

    fn storage() -> Self {
        Self::new(
            500,
            "pending_outcome_storage_error",
            "Pending outcome state could not be read or saved.",
        )
    }

    fn corrupt(message: impl Into<String>) -> Self {
        Self::new(500, "pending_outcome_store_corrupt", message)
    }
}

impl fmt::Display for PendingOutcomeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl Error for PendingOutcomeError {}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoreState {
    schema_version: String,
    outcomes: Vec<OutcomeEntry>,
    implicit_signals: Vec<Value>,
    event_receipts: Vec<EventReceipt>,
    ask_receipts: Vec<AskReceipt>,
    feedback_receipts: Vec<FeedbackReceipt>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OutcomeEntry {
    outcome: Value,
    feedback_state: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EventReceipt {
    id: String,
    digest: String,
    kind: String,
    outcome_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AskReceipt {
    id: String,
    digest: String,
    outcome_id: Option<String>,
    feedback_prompted_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FeedbackReceipt {
    id: String,
    digest: String,
    outcome_id: String,
    result_state: String,
    outcome_status: String,
    failure_reason_tokens: Vec<String>,
}

fn default_state() -> StoreState {
    StoreState {
        schema_version: STORE_SCHEMA_VERSION.to_string(),
        outcomes: Vec::new(),
        implicit_signals: Vec::new(),
        event_receipts: Vec::new(),
        ask_receipts: Vec::new(),
        feedback_receipts: Vec::new(),
    }
}

pub fn state_file(data_dir: &Path) -> PathBuf {
    data_dir.join(STORE_FILE_NAME)
}

pub fn backup_file(data_dir: &Path) -> PathBuf {
    data_dir.join(STORE_BACKUP_FILE_NAME)
}

fn lock_store() -> MutexGuard<'static, ()> {
    STORE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn canonical_timestamp(value: &str) -> Result<String, PendingOutcomeError> {
    DateTime::parse_from_rfc3339(value)
        .map(|timestamp| {
            timestamp
                .with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Millis, true)
        })
        .map_err(|_| {
            PendingOutcomeError::bad_request(
                "invalid_outcome_clock",
                "A valid clock timestamp is required.",
            )
        })
}

fn timestamp_millis(value: &str) -> Result<i64, PendingOutcomeError> {
    DateTime::parse_from_rfc3339(value)
        .map(|timestamp| timestamp.timestamp_millis())
        .map_err(|_| PendingOutcomeError::corrupt("Stored outcome timestamp is invalid."))
}

fn add_milliseconds(value: &str, milliseconds: i64) -> Result<String, PendingOutcomeError> {
    let timestamp = DateTime::parse_from_rfc3339(value).map_err(|_| {
        PendingOutcomeError::bad_request(
            "invalid_prompt_session_event",
            "Prompt session event timestamp is invalid.",
        )
    })?;
    timestamp
        .with_timezone(&Utc)
        .checked_add_signed(Duration::milliseconds(milliseconds))
        .map(|next| next.to_rfc3339_opts(SecondsFormat::Millis, true))
        .ok_or_else(|| {
            PendingOutcomeError::bad_request(
                "invalid_prompt_session_event",
                "Prompt session event timestamp is outside the supported outcome window.",
            )
        })
}

fn compact_key(key: &str) -> String {
    key.chars()
        .filter_map(|character| {
            let lowered = character.to_ascii_lowercase();
            (lowered.is_ascii_alphanumeric() || lowered == '_').then_some(lowered)
        })
        .collect()
}

fn forbidden_raw_field(key: &str) -> bool {
    matches!(
        key,
        "prompt"
            | "prompttext"
            | "rawprompt"
            | "path"
            | "title"
            | "key"
            | "rawinput"
            | "inputtext"
            | "draft"
            | "chatcontent"
            | "chattext"
            | "clipboardcontent"
            | "clipboardtext"
            | "windowtitle"
            | "rawtitle"
            | "projectpath"
            | "absolutepath"
            | "apikey"
            | "api_key"
            | "keymaterial"
            | "secret"
            | "credential"
            | "rawevidence"
            | "evidencetext"
            | "rawuia"
            | "rawdom"
            | "embeddingvector"
            | "vector"
    )
}

fn looks_like_absolute_path(value: &str) -> bool {
    if value.starts_with("\\\\") || value.starts_with("/Users/") || value.starts_with("/home/") {
        return true;
    }
    let bytes = value.as_bytes();
    bytes.windows(3).enumerate().any(|(index, window)| {
        let boundary = index == 0
            || bytes[index - 1].is_ascii_whitespace()
            || matches!(bytes[index - 1], b'\'' | b'"' | b'(');
        boundary
            && window[0].is_ascii_alphabetic()
            && window[1] == b':'
            && matches!(window[2], b'\\' | b'/')
    })
}

fn looks_like_credential(value: &str) -> bool {
    let lowered = value.to_ascii_lowercase();
    if lowered.contains("-----begin ") && lowered.contains("private key-----") {
        return true;
    }
    for token in value.split_whitespace() {
        if (token.starts_with("sk-") && token.len() >= 15)
            || (token.starts_with("AKIA") && token.len() >= 16)
        {
            return true;
        }
    }
    lowered
        .find("bearer ")
        .and_then(|index| lowered[index + 7..].split_whitespace().next())
        .is_some_and(|token| token.len() >= 12)
}

fn collect_privacy_violations(
    value: &Value,
    path: &str,
    parent_key: &str,
    violations: &mut Vec<OutcomeErrorDetail>,
) {
    match value {
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                collect_privacy_violations(
                    item,
                    &format!("{path}[{index}]"),
                    parent_key,
                    violations,
                );
            }
        }
        Value::Object(object) => {
            for (key, item) in object {
                let item_path = format!("{path}.{key}");
                if forbidden_raw_field(&compact_key(key)) {
                    violations.push(OutcomeErrorDetail {
                        code: "privacy_forbidden_field".to_string(),
                        path: item_path.clone(),
                    });
                }
                if PRIVACY_FLAG_NAMES.contains(&key.as_str()) && item != &Value::Bool(false) {
                    violations.push(OutcomeErrorDetail {
                        code: "privacy_flag".to_string(),
                        path: item_path.clone(),
                    });
                }
                collect_privacy_violations(item, &item_path, key, violations);
            }
        }
        Value::String(text) => {
            if looks_like_absolute_path(text) || looks_like_credential(text) {
                violations.push(OutcomeErrorDetail {
                    code: "privacy_forbidden_value".to_string(),
                    path: path.to_string(),
                });
            }
            let sensitive_parent = ["title", "path", "key", "secret", "credential"]
                .iter()
                .any(|token| parent_key.to_ascii_lowercase().contains(token));
            if sensitive_parent && text.len() > 180 {
                violations.push(OutcomeErrorDetail {
                    code: "privacy_forbidden_value".to_string(),
                    path: path.to_string(),
                });
            }
        }
        _ => {}
    }
}

fn privacy_violations(value: &Value) -> Vec<OutcomeErrorDetail> {
    let mut violations = Vec::new();
    collect_privacy_violations(value, "$", "", &mut violations);
    violations.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then_with(|| left.code.cmp(&right.code))
    });
    violations.dedup();
    violations
}

fn assert_privacy_safe(value: &Value) -> Result<(), PendingOutcomeError> {
    let violations = privacy_violations(value);
    if violations.is_empty() {
        Ok(())
    } else {
        Err(PendingOutcomeError::bad_request(
            "outcome_privacy_violation",
            "Outcome data contains a forbidden raw or sensitive field.",
        )
        .with_details(violations))
    }
}

fn object_with_only_keys<'a>(
    value: &'a Value,
    allowed_keys: &[&str],
    code: &'static str,
) -> Result<&'a Map<String, Value>, PendingOutcomeError> {
    let object = value.as_object().ok_or_else(|| {
        PendingOutcomeError::bad_request(code, "Outcome request must be an object.")
    })?;
    let unknown = object
        .keys()
        .filter(|key| !allowed_keys.contains(&key.as_str()))
        .map(|key| OutcomeErrorDetail {
            code: "unknown_field".to_string(),
            path: format!("$.{key}"),
        })
        .collect::<Vec<_>>();
    if unknown.is_empty() {
        Ok(object)
    } else {
        Err(
            PendingOutcomeError::bad_request(code, "Outcome request contains unsupported fields.")
                .with_details(unknown),
        )
    }
}

fn valid_token(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 180
        && bytes[0].is_ascii_alphanumeric()
        && bytes.iter().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'@' | b'-')
        })
}

fn required_token(object: &Map<String, Value>, field: &str) -> Result<String, PendingOutcomeError> {
    let value = object.get(field).and_then(Value::as_str).unwrap_or("");
    if valid_token(value) {
        Ok(value.to_string())
    } else {
        Err(PendingOutcomeError::bad_request(
            "invalid_outcome_token",
            format!("{field} must be a bounded opaque token."),
        ))
    }
}

fn optional_token(
    object: &Map<String, Value>,
    field: &str,
) -> Result<Option<String>, PendingOutcomeError> {
    match object.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if valid_token(value) => Ok(Some(value.clone())),
        _ => Err(PendingOutcomeError::bad_request(
            "invalid_outcome_token",
            format!("{field} must be a bounded opaque token."),
        )),
    }
}

fn resolve_request_id(
    object: &Map<String, Value>,
    names: &[&str],
) -> Result<String, PendingOutcomeError> {
    let mut supplied = Vec::new();
    for name in names {
        if object.contains_key(*name) {
            supplied.push(required_token(object, name)?);
        }
    }
    let Some(first) = supplied.first() else {
        return Err(PendingOutcomeError::bad_request(
            "outcome_idempotency_key_required",
            "An idempotency key is required.",
        ));
    };
    if supplied.iter().any(|value| value != first) {
        return Err(PendingOutcomeError::conflict(
            "outcome_idempotency_conflict",
            "Conflicting idempotency keys were provided.",
        ));
    }
    Ok(first.clone())
}

fn digest(value: &Value) -> Result<String, PendingOutcomeError> {
    let serialized = serde_json::to_vec(value).map_err(|_| PendingOutcomeError::storage())?;
    Ok(format!("{:x}", Sha256::digest(serialized)))
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validation_details(value: &Value, contract: &str) -> Vec<OutcomeErrorDetail> {
    validate_contract(contract, value)
        .ok()
        .map(|result| {
            result
                .errors
                .into_iter()
                .map(|error| OutcomeErrorDetail {
                    code: error.code,
                    path: error.path,
                })
                .collect()
        })
        .unwrap_or_else(|| {
            vec![OutcomeErrorDetail {
                code: "unsupported_contract".to_string(),
                path: "$".to_string(),
            }]
        })
}

fn assert_contract(
    contract: &str,
    value: &Value,
    code: &'static str,
) -> Result<Value, PendingOutcomeError> {
    assert_privacy_safe(value)?;
    let details = validation_details(value, contract);
    if details.is_empty() {
        Ok(value.clone())
    } else {
        Err(
            PendingOutcomeError::bad_request(code, format!("Invalid {contract} contract."))
                .with_details(details),
        )
    }
}

fn validate_stored_contract(contract: &str, value: &Value) -> Result<Value, PendingOutcomeError> {
    let details = validation_details(value, contract);
    if details.is_empty() {
        Ok(value.clone())
    } else {
        Err(
            PendingOutcomeError::corrupt(format!("Stored {contract} contract is invalid."))
                .with_details(details),
        )
    }
}

fn outcome_string<'a>(outcome: &'a Value, key: &str) -> &'a str {
    outcome.get(key).and_then(Value::as_str).unwrap_or("")
}

fn set_outcome_field(outcome: &mut Value, key: &str, value: Value) {
    outcome
        .as_object_mut()
        .expect("validated pending outcomes are objects")
        .insert(key.to_string(), value);
}

fn validate_outcome_entry(entry: &OutcomeEntry) -> Result<(), PendingOutcomeError> {
    validate_stored_contract("pending_outcome", &entry.outcome)?;
    if !FEEDBACK_STATES.contains(&entry.feedback_state.as_str()) {
        return Err(PendingOutcomeError::corrupt(
            "Stored feedback state is invalid.",
        ));
    }
    let status = outcome_string(&entry.outcome, "status");
    let prompted = !entry
        .outcome
        .get("feedbackPromptedAt")
        .unwrap_or(&Value::Null)
        .is_null();
    let consistent = match entry.feedback_state.as_str() {
        "unasked" => status == "unknown" && !prompted,
        "asked" | "reason_required" => status == "unknown" && prompted,
        "resolved" => matches!(status, "succeeded" | "failed") && prompted,
        "expired" => status == "expired_unknown",
        "invalidated" => status == "invalidated",
        _ => false,
    };
    if consistent {
        Ok(())
    } else {
        Err(PendingOutcomeError::corrupt(
            "Stored outcome and feedback states are inconsistent.",
        ))
    }
}

fn assert_unique<'a>(
    values: impl IntoIterator<Item = &'a str>,
    label: &str,
) -> Result<(), PendingOutcomeError> {
    let mut seen = HashSet::new();
    for value in values {
        if !seen.insert(value) {
            return Err(PendingOutcomeError::corrupt(format!(
                "{label} contains duplicate identifiers."
            )));
        }
    }
    Ok(())
}

fn hydrate_legacy_policy_attribution(raw: &mut Value) {
    let Some(outcomes) = raw.get_mut("outcomes").and_then(Value::as_array_mut) else {
        return;
    };
    for entry in outcomes {
        let Some(outcome) = entry.get_mut("outcome").and_then(Value::as_object_mut) else {
            continue;
        };
        if !outcome.contains_key("policyId") && !outcome.contains_key("policyVersion") {
            outcome.insert("policyId".to_string(), Value::Null);
            outcome.insert("policyVersion".to_string(), Value::Null);
        }
    }
}

fn validate_state_value(mut raw: Value) -> Result<StoreState, PendingOutcomeError> {
    let violations = privacy_violations(&raw);
    if !violations.is_empty() {
        return Err(
            PendingOutcomeError::corrupt("Pending outcome state contains forbidden data.")
                .with_details(violations),
        );
    }
    hydrate_legacy_policy_attribution(&mut raw);
    let state: StoreState = serde_json::from_value(raw).map_err(|_| {
        PendingOutcomeError::corrupt("Pending outcome state has an unsupported shape.")
    })?;
    if state.schema_version != STORE_SCHEMA_VERSION {
        return Err(PendingOutcomeError::corrupt(
            "Pending outcome store version is unsupported.",
        ));
    }
    for entry in &state.outcomes {
        validate_outcome_entry(entry)?;
    }
    for event in &state.implicit_signals {
        validate_stored_contract("prompt_session_event", event)?;
        if !IMPLICIT_SIGNAL_TYPES.contains(&outcome_string(event, "eventType")) {
            return Err(PendingOutcomeError::corrupt(
                "Stored implicit signal type is invalid.",
            ));
        }
    }
    for receipt in &state.event_receipts {
        if !valid_token(&receipt.id)
            || !valid_digest(&receipt.digest)
            || !["pending_outcome", "implicit_signal"].contains(&receipt.kind.as_str())
            || receipt
                .outcome_id
                .as_deref()
                .is_some_and(|value| !valid_token(value))
        {
            return Err(PendingOutcomeError::corrupt(
                "Stored event receipt is invalid.",
            ));
        }
    }
    for receipt in &state.ask_receipts {
        let timestamp_valid = receipt
            .feedback_prompted_at
            .as_deref()
            .map(canonical_timestamp)
            .transpose()
            .is_ok();
        if !valid_token(&receipt.id)
            || !valid_digest(&receipt.digest)
            || receipt
                .outcome_id
                .as_deref()
                .is_some_and(|value| !valid_token(value))
            || (receipt.outcome_id.is_none() && receipt.feedback_prompted_at.is_some())
            || !timestamp_valid
        {
            return Err(PendingOutcomeError::corrupt(
                "Stored ask receipt is invalid.",
            ));
        }
    }
    for receipt in &state.feedback_receipts {
        if !valid_token(&receipt.id)
            || !valid_token(&receipt.outcome_id)
            || !valid_digest(&receipt.digest)
            || !["reason_required", "completed", "not_completed"]
                .contains(&receipt.result_state.as_str())
            || !["unknown", "succeeded", "failed"].contains(&receipt.outcome_status.as_str())
            || receipt
                .failure_reason_tokens
                .iter()
                .any(|token| !FAILURE_REASON_TOKENS.contains(&token.as_str()))
        {
            return Err(PendingOutcomeError::corrupt(
                "Stored feedback receipt is invalid.",
            ));
        }
    }
    assert_unique(
        state
            .outcomes
            .iter()
            .map(|entry| outcome_string(&entry.outcome, "outcomeId")),
        "Stored outcomes",
    )?;
    assert_unique(
        state
            .implicit_signals
            .iter()
            .map(|event| outcome_string(event, "eventId")),
        "Stored implicit signals",
    )?;
    assert_unique(
        state
            .event_receipts
            .iter()
            .map(|receipt| receipt.id.as_str()),
        "Stored event receipts",
    )?;
    assert_unique(
        state.ask_receipts.iter().map(|receipt| receipt.id.as_str()),
        "Stored ask receipts",
    )?;
    assert_unique(
        state
            .feedback_receipts
            .iter()
            .map(|receipt| receipt.id.as_str()),
        "Stored feedback receipts",
    )?;
    Ok(state)
}

fn parse_state_text(text: &str) -> Result<StoreState, PendingOutcomeError> {
    let raw = serde_json::from_str::<Value>(text)
        .map_err(|_| PendingOutcomeError::corrupt("Pending outcome state is not valid JSON."))?;
    validate_state_value(raw)
}

fn overwrite_file(path: &Path, text: &str) -> Result<(), PendingOutcomeError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| PendingOutcomeError::storage())?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(|_| PendingOutcomeError::storage())?;
    file.write_all(text.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|_| PendingOutcomeError::storage())
}

fn read_optional_text(path: &Path) -> Result<Option<String>, PendingOutcomeError> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(_) => Err(PendingOutcomeError::storage()),
    }
}

fn state_text(state: &StoreState) -> Result<String, PendingOutcomeError> {
    let raw = serde_json::to_value(state).map_err(|_| PendingOutcomeError::storage())?;
    let validated = validate_state_value(raw)?;
    serde_json::to_string_pretty(&validated)
        .map(|text| format!("{text}\n"))
        .map_err(|_| PendingOutcomeError::storage())
}

fn persist_state_locked(data_dir: &Path, state: &StoreState) -> Result<(), PendingOutcomeError> {
    let text = state_text(state)?;
    let primary = state_file(data_dir);
    let backup = backup_file(data_dir);
    let prior = read_optional_text(&primary)?;
    match prior {
        Some(ref prior_text) if parse_state_text(prior_text).is_ok() => {
            overwrite_file(&backup, prior_text)?;
        }
        None => overwrite_file(&backup, &text)?,
        Some(_) => {
            if read_optional_text(&backup)?.is_none() {
                overwrite_file(&backup, &text)?;
            }
        }
    }
    overwrite_file(&primary, &text)
}

fn load_state_locked(data_dir: &Path) -> Result<StoreState, PendingOutcomeError> {
    fs::create_dir_all(data_dir).map_err(|_| PendingOutcomeError::storage())?;
    let primary = state_file(data_dir);
    let backup = backup_file(data_dir);
    let primary_text = read_optional_text(&primary)?;
    let primary_error = match primary_text.as_deref() {
        Some(text) => match parse_state_text(text) {
            Ok(state) => return Ok(state),
            Err(error) => Some(error),
        },
        None => None,
    };

    if let Some(backup_text) = read_optional_text(&backup)? {
        match parse_state_text(&backup_text) {
            Ok(state) => {
                overwrite_file(&primary, &backup_text)?;
                return Ok(state);
            }
            Err(backup_error) if primary_error.is_none() => return Err(backup_error),
            Err(_) => {}
        }
    }

    if let Some(error) = primary_error {
        return Err(error);
    }

    let state = default_state();
    persist_state_locked(data_dir, &state)?;
    Ok(state)
}

fn validated_pending_outcome(value: Value) -> Result<Value, PendingOutcomeError> {
    let details = validation_details(&value, "pending_outcome");
    if details.is_empty() {
        Ok(value)
    } else {
        Err(PendingOutcomeError::new(
            500,
            "invalid_pending_outcome",
            "Pending outcome transition produced an invalid contract.",
        )
        .with_details(details))
    }
}

fn create_pending_outcome(event: &Value) -> Result<Value, PendingOutcomeError> {
    let created_at = outcome_string(event, "occurredAt");
    validated_pending_outcome(json!({
        "contractVersion": "pending-outcome@1",
        "outcomeId": event["outcomeId"],
        "generationId": event["generationId"],
        "sessionId": event["sessionId"],
        "strategyId": event["strategyId"],
        "strategyVersion": event["strategyVersion"],
        "target": event["target"],
        "projectScopeToken": event["projectScopeToken"],
        "modelFamilyToken": event["modelFamilyToken"],
        "createdAt": created_at,
        "eligibleAt": add_milliseconds(created_at, FEEDBACK_DELAY_MS)?,
        "expiresAt": add_milliseconds(created_at, OUTCOME_TTL_MS)?,
        "status": "unknown",
        "insertVerified": true,
        "policyId": event["policyId"],
        "policyVersion": event["policyVersion"],
        "feedbackPromptedAt": Value::Null,
        "failureReasonTokens": [],
        "privacyFlags": {
            "rawInputStored": false,
            "generatedPromptStored": false,
            "chatContentStored": false,
            "clipboardContentStored": false,
            "windowTitleStored": false,
            "absoluteProjectPathStored": false,
            "credentialStored": false,
            "rawEvidenceStored": false
        }
    }))
}

fn find_outcome_index(state: &StoreState, outcome_id: &str) -> Option<usize> {
    state
        .outcomes
        .iter()
        .position(|entry| outcome_string(&entry.outcome, "outcomeId") == outcome_id)
}

fn expire_state(
    state: &mut StoreState,
    timestamp: &str,
) -> Result<Vec<Value>, PendingOutcomeError> {
    let now_ms = timestamp_millis(timestamp)?;
    let mut expired = Vec::new();
    for entry in &mut state.outcomes {
        if outcome_string(&entry.outcome, "status") != "unknown"
            || now_ms < timestamp_millis(outcome_string(&entry.outcome, "expiresAt"))?
        {
            continue;
        }
        let mut outcome = entry.outcome.clone();
        set_outcome_field(&mut outcome, "status", json!("expired_unknown"));
        set_outcome_field(&mut outcome, "failureReasonTokens", json!([]));
        entry.outcome = validated_pending_outcome(outcome)?;
        entry.feedback_state = "expired".to_string();
        expired.push(entry.outcome.clone());
    }
    Ok(expired)
}

fn read_current_state_locked(
    data_dir: &Path,
    timestamp: &str,
) -> Result<StoreState, PendingOutcomeError> {
    let mut state = load_state_locked(data_dir)?;
    if !expire_state(&mut state, timestamp)?.is_empty() {
        persist_state_locked(data_dir, &state)?;
    }
    Ok(state)
}

fn event_result(
    state: &StoreState,
    receipt: &EventReceipt,
    duplicate: bool,
) -> Result<Value, PendingOutcomeError> {
    if receipt.kind == "pending_outcome" {
        let outcome = receipt
            .outcome_id
            .as_deref()
            .and_then(|outcome_id| find_outcome_index(state, outcome_id))
            .map(|index| state.outcomes[index].outcome.clone())
            .unwrap_or(Value::Null);
        Ok(json!({
            "kind": "pending_outcome",
            "created": false,
            "duplicate": duplicate,
            "outcome": outcome
        }))
    } else {
        let signal = state
            .implicit_signals
            .iter()
            .find(|event| outcome_string(event, "eventId") == receipt.id)
            .cloned()
            .unwrap_or(Value::Null);
        Ok(json!({
            "kind": "implicit_signal",
            "recorded": false,
            "duplicate": duplicate,
            "signal": signal
        }))
    }
}

pub fn initialize(data_dir: &Path) -> Result<(), PendingOutcomeError> {
    initialize_at(data_dir, &now_iso())
}

pub fn initialize_at(data_dir: &Path, now: &str) -> Result<(), PendingOutcomeError> {
    let timestamp = canonical_timestamp(now)?;
    let _guard = lock_store();
    read_current_state_locked(data_dir, &timestamp).map(|_| ())
}

pub fn record_prompt_session_event(
    data_dir: &Path,
    input: &Value,
) -> Result<Value, PendingOutcomeError> {
    record_prompt_session_event_at(data_dir, input, &now_iso())
}

pub fn record_event(data_dir: &Path, input: &Value) -> Result<Value, PendingOutcomeError> {
    record_prompt_session_event(data_dir, input)
}

pub fn record_prompt_session_event_at(
    data_dir: &Path,
    input: &Value,
    now: &str,
) -> Result<Value, PendingOutcomeError> {
    let timestamp = canonical_timestamp(now)?;
    let event = assert_contract(
        "prompt_session_event",
        input,
        "invalid_prompt_session_event",
    )?;
    let event_type = outcome_string(&event, "eventType");
    if event_type != "verified_insert" && !IMPLICIT_SIGNAL_TYPES.contains(&event_type) {
        return Err(PendingOutcomeError::bad_request(
            "unsupported_outcome_event",
            "This event type is not handled by the pending outcome store.",
        ));
    }

    let _guard = lock_store();
    let mut state = read_current_state_locked(data_dir, &timestamp)?;
    let event_id = outcome_string(&event, "eventId");
    let event_digest = digest(&event)?;
    if let Some(receipt) = state
        .event_receipts
        .iter()
        .find(|receipt| receipt.id == event_id)
    {
        if receipt.digest != event_digest {
            return Err(PendingOutcomeError::conflict(
                "outcome_idempotency_conflict",
                "The event id was already used with different data.",
            ));
        }
        return event_result(&state, receipt, true);
    }

    if event_type == "verified_insert" {
        let pending = create_pending_outcome(&event)?;
        let outcome_id = outcome_string(&pending, "outcomeId").to_string();
        let mut created = false;
        if let Some(index) = find_outcome_index(&state, &outcome_id) {
            let mut original = state.outcomes[index].outcome.clone();
            set_outcome_field(&mut original, "status", json!("unknown"));
            set_outcome_field(&mut original, "feedbackPromptedAt", Value::Null);
            set_outcome_field(&mut original, "failureReasonTokens", json!([]));
            if digest(&original)? != digest(&pending)? {
                return Err(PendingOutcomeError::conflict(
                    "outcome_idempotency_conflict",
                    "The outcome id was already used with different data.",
                ));
            }
        } else {
            state.outcomes.push(OutcomeEntry {
                outcome: pending.clone(),
                feedback_state: "unasked".to_string(),
            });
            created = true;
        }
        state.event_receipts.push(EventReceipt {
            id: event_id.to_string(),
            digest: event_digest,
            kind: "pending_outcome".to_string(),
            outcome_id: Some(outcome_id),
        });
        persist_state_locked(data_dir, &state)?;
        Ok(json!({
            "kind": "pending_outcome",
            "created": created,
            "duplicate": false,
            "outcome": pending
        }))
    } else {
        let outcome_id = event
            .get("outcomeId")
            .and_then(Value::as_str)
            .map(str::to_string);
        state.implicit_signals.push(event.clone());
        state.event_receipts.push(EventReceipt {
            id: event_id.to_string(),
            digest: event_digest,
            kind: "implicit_signal".to_string(),
            outcome_id,
        });
        persist_state_locked(data_dir, &state)?;
        Ok(json!({
            "kind": "implicit_signal",
            "recorded": true,
            "duplicate": false,
            "signal": event
        }))
    }
}

pub fn record_event_at(
    data_dir: &Path,
    input: &Value,
    now: &str,
) -> Result<Value, PendingOutcomeError> {
    record_prompt_session_event_at(data_dir, input, now)
}

pub fn record_verified_insert(
    data_dir: &Path,
    event: &Value,
) -> Result<Value, PendingOutcomeError> {
    record_verified_insert_at(data_dir, event, &now_iso())
}

pub fn record_verified_insert_at(
    data_dir: &Path,
    event: &Value,
    now: &str,
) -> Result<Value, PendingOutcomeError> {
    if outcome_string(event, "eventType") != "verified_insert" {
        return Err(PendingOutcomeError::bad_request(
            "verified_insert_required",
            "Only a verified_insert event can create an outcome.",
        ));
    }
    record_prompt_session_event_at(data_dir, event, now)
}

pub fn record_implicit_signal(
    data_dir: &Path,
    event: &Value,
) -> Result<Value, PendingOutcomeError> {
    record_implicit_signal_at(data_dir, event, &now_iso())
}

pub fn record_implicit_signal_at(
    data_dir: &Path,
    event: &Value,
    now: &str,
) -> Result<Value, PendingOutcomeError> {
    if !IMPLICIT_SIGNAL_TYPES.contains(&outcome_string(event, "eventType")) {
        return Err(PendingOutcomeError::bad_request(
            "implicit_signal_required",
            "The event is not a supported implicit signal.",
        ));
    }
    record_prompt_session_event_at(data_dir, event, now)
}

fn ask_response_from_receipt(
    state: &StoreState,
    receipt: &AskReceipt,
) -> Result<Value, PendingOutcomeError> {
    let Some(outcome_id) = receipt.outcome_id.as_deref() else {
        return Ok(json!({ "state": "none", "outcome": Value::Null }));
    };
    let index = find_outcome_index(state, outcome_id).ok_or_else(|| {
        PendingOutcomeError::corrupt("An ask receipt references a missing outcome.")
    })?;
    let mut snapshot = state.outcomes[index].outcome.clone();
    set_outcome_field(&mut snapshot, "status", json!("unknown"));
    set_outcome_field(
        &mut snapshot,
        "feedbackPromptedAt",
        receipt
            .feedback_prompted_at
            .as_ref()
            .map_or(Value::Null, |value| json!(value)),
    );
    set_outcome_field(&mut snapshot, "failureReasonTokens", json!([]));
    Ok(json!({ "state": "question", "outcome": snapshot }))
}

pub fn claim_next_feedback(data_dir: &Path, input: &Value) -> Result<Value, PendingOutcomeError> {
    claim_next_feedback_at(data_dir, input, &now_iso())
}

pub fn ask_next(data_dir: &Path, input: &Value) -> Result<Value, PendingOutcomeError> {
    claim_next_feedback(data_dir, input)
}

pub fn claim_next_feedback_at(
    data_dir: &Path,
    input: &Value,
    now: &str,
) -> Result<Value, PendingOutcomeError> {
    assert_privacy_safe(input)?;
    let object = object_with_only_keys(
        input,
        &[
            "askId",
            "requestId",
            "eventId",
            "target",
            "projectScopeToken",
        ],
        "invalid_outcome_request",
    )?;
    let ask_id = resolve_request_id(object, &["askId", "requestId", "eventId"])?;
    let target = required_token(object, "target")?;
    let project_scope_token = required_token(object, "projectScopeToken")?;
    if target != "codex" {
        return Err(PendingOutcomeError::bad_request(
            "invalid_outcome_target",
            "Pending outcome feedback is limited to Codex.",
        ));
    }
    let timestamp = canonical_timestamp(now)?;
    let request_digest = digest(&json!({
        "target": target,
        "projectScopeToken": project_scope_token
    }))?;

    let _guard = lock_store();
    let mut state = read_current_state_locked(data_dir, &timestamp)?;
    if let Some(receipt) = state
        .ask_receipts
        .iter()
        .find(|receipt| receipt.id == ask_id)
    {
        if receipt.digest != request_digest {
            return Err(PendingOutcomeError::conflict(
                "outcome_idempotency_conflict",
                "The ask id was already used for another queue.",
            ));
        }
        return ask_response_from_receipt(&state, receipt);
    }

    let now_ms = timestamp_millis(&timestamp)?;
    let candidate_index = state
        .outcomes
        .iter()
        .enumerate()
        .filter(|(_, entry)| {
            outcome_string(&entry.outcome, "target") == target
                && outcome_string(&entry.outcome, "projectScopeToken") == project_scope_token
                && outcome_string(&entry.outcome, "status") == "unknown"
                && entry.feedback_state == "unasked"
                && entry
                    .outcome
                    .get("feedbackPromptedAt")
                    .is_some_and(Value::is_null)
                && timestamp_millis(outcome_string(&entry.outcome, "eligibleAt"))
                    .is_ok_and(|eligible| eligible <= now_ms)
                && timestamp_millis(outcome_string(&entry.outcome, "expiresAt"))
                    .is_ok_and(|expires| now_ms < expires)
        })
        .max_by(|(_, left), (_, right)| {
            let left_created =
                timestamp_millis(outcome_string(&left.outcome, "createdAt")).unwrap_or(i64::MIN);
            let right_created =
                timestamp_millis(outcome_string(&right.outcome, "createdAt")).unwrap_or(i64::MIN);
            left_created.cmp(&right_created).then_with(|| {
                outcome_string(&left.outcome, "outcomeId")
                    .cmp(outcome_string(&right.outcome, "outcomeId"))
            })
        })
        .map(|(index, _)| index);

    let (outcome_id, feedback_prompted_at) = if let Some(index) = candidate_index {
        let mut outcome = state.outcomes[index].outcome.clone();
        set_outcome_field(&mut outcome, "feedbackPromptedAt", json!(timestamp));
        state.outcomes[index].outcome = validated_pending_outcome(outcome)?;
        state.outcomes[index].feedback_state = "asked".to_string();
        (
            Some(outcome_string(&state.outcomes[index].outcome, "outcomeId").to_string()),
            Some(timestamp.clone()),
        )
    } else {
        (None, None)
    };
    let receipt = AskReceipt {
        id: ask_id,
        digest: request_digest,
        outcome_id,
        feedback_prompted_at,
    };
    state.ask_receipts.push(receipt.clone());
    persist_state_locked(data_dir, &state)?;
    ask_response_from_receipt(&state, &receipt)
}

pub fn ask_next_at(
    data_dir: &Path,
    input: &Value,
    now: &str,
) -> Result<Value, PendingOutcomeError> {
    claim_next_feedback_at(data_dir, input, now)
}

fn feedback_response(
    entry: &OutcomeEntry,
    result_state: &str,
    outcome_override: Option<Value>,
) -> Value {
    json!({
        "state": result_state,
        "outcome": outcome_override.unwrap_or_else(|| entry.outcome.clone()),
        "failureReasonTokens": if result_state == "reason_required" {
            FAILURE_REASON_TOKENS.iter().map(|value| Value::String((*value).to_string())).collect::<Vec<_>>()
        } else {
            Vec::<Value>::new()
        }
    })
}

fn feedback_response_from_receipt(
    state: &StoreState,
    receipt: &FeedbackReceipt,
) -> Result<Value, PendingOutcomeError> {
    let index = find_outcome_index(state, &receipt.outcome_id).ok_or_else(|| {
        PendingOutcomeError::corrupt("A feedback receipt references a missing outcome.")
    })?;
    let mut snapshot = state.outcomes[index].outcome.clone();
    set_outcome_field(&mut snapshot, "status", json!(receipt.outcome_status));
    set_outcome_field(
        &mut snapshot,
        "failureReasonTokens",
        json!(receipt.failure_reason_tokens),
    );
    Ok(feedback_response(
        &state.outcomes[index],
        &receipt.result_state,
        Some(snapshot),
    ))
}

pub fn submit_outcome_feedback(
    data_dir: &Path,
    input: &Value,
) -> Result<Value, PendingOutcomeError> {
    submit_outcome_feedback_at(data_dir, input, &now_iso())
}

pub fn record_feedback(data_dir: &Path, input: &Value) -> Result<Value, PendingOutcomeError> {
    submit_outcome_feedback(data_dir, input)
}

pub fn submit_outcome_feedback_at(
    data_dir: &Path,
    input: &Value,
    now: &str,
) -> Result<Value, PendingOutcomeError> {
    assert_privacy_safe(input)?;
    let object = object_with_only_keys(
        input,
        &[
            "feedbackId",
            "requestId",
            "eventId",
            "outcomeId",
            "taskOutcomeToken",
            "outcome",
            "reasonToken",
            "failureReasonToken",
        ],
        "invalid_outcome_request",
    )?;
    let feedback_id = resolve_request_id(object, &["feedbackId", "requestId", "eventId"])?;
    let outcome_id = required_token(object, "outcomeId")?;
    let task_outcome = match (object.get("taskOutcomeToken"), object.get("outcome")) {
        (Some(left), Some(right)) if left != right => {
            return Err(PendingOutcomeError::conflict(
                "outcome_idempotency_conflict",
                "Conflicting outcome tokens were provided.",
            ));
        }
        (Some(value), _) | (_, Some(value)) => value.as_str().unwrap_or(""),
        _ => "",
    };
    if !["completed", "not_completed"].contains(&task_outcome) {
        return Err(PendingOutcomeError::bad_request(
            "invalid_task_outcome",
            "Feedback must be completed or not_completed.",
        ));
    }
    let reason = match (object.get("reasonToken"), object.get("failureReasonToken")) {
        (Some(left), Some(right)) if left != right => {
            return Err(PendingOutcomeError::conflict(
                "outcome_idempotency_conflict",
                "Conflicting failure reasons were provided.",
            ));
        }
        (Some(_), _) => optional_token(object, "reasonToken")?,
        (_, Some(_)) => optional_token(object, "failureReasonToken")?,
        _ => None,
    };
    let timestamp = canonical_timestamp(now)?;
    let request_digest = digest(&json!({
        "outcomeId": outcome_id,
        "taskOutcomeToken": task_outcome,
        "reasonToken": reason
    }))?;

    let _guard = lock_store();
    let mut state = read_current_state_locked(data_dir, &timestamp)?;
    if let Some(receipt) = state
        .feedback_receipts
        .iter()
        .find(|receipt| receipt.id == feedback_id)
    {
        if receipt.digest != request_digest {
            return Err(PendingOutcomeError::conflict(
                "outcome_idempotency_conflict",
                "The feedback id was already used with different data.",
            ));
        }
        return feedback_response_from_receipt(&state, receipt);
    }

    let index = find_outcome_index(&state, &outcome_id).ok_or_else(|| {
        PendingOutcomeError::not_found(
            "pending_outcome_not_found",
            "Pending outcome was not found.",
        )
    })?;
    let status = outcome_string(&state.outcomes[index].outcome, "status").to_string();
    if status == "expired_unknown" {
        return Err(PendingOutcomeError::conflict(
            "pending_outcome_expired",
            "Expired outcomes cannot accept feedback.",
        ));
    }
    if status == "invalidated" {
        return Err(PendingOutcomeError::conflict(
            "pending_outcome_invalidated",
            "Invalidated outcomes cannot accept feedback.",
        ));
    }

    if status != "unknown" {
        let stored_reason = state.outcomes[index]
            .outcome
            .get("failureReasonTokens")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(Value::as_str);
        let same_completed =
            task_outcome == "completed" && status == "succeeded" && reason.is_none();
        let same_failed = task_outcome == "not_completed"
            && status == "failed"
            && (reason.is_none() || reason.as_deref() == stored_reason);
        if !same_completed && !same_failed {
            return Err(PendingOutcomeError::conflict(
                "outcome_feedback_conflict",
                "Outcome feedback has already been finalized.",
            ));
        }
        let receipt = FeedbackReceipt {
            id: feedback_id,
            digest: request_digest,
            outcome_id,
            result_state: if same_completed {
                "completed".to_string()
            } else {
                "not_completed".to_string()
            },
            outcome_status: status,
            failure_reason_tokens: state.outcomes[index]
                .outcome
                .get("failureReasonTokens")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
        };
        state.feedback_receipts.push(receipt.clone());
        persist_state_locked(data_dir, &state)?;
        return feedback_response_from_receipt(&state, &receipt);
    }

    if state.outcomes[index].feedback_state == "unasked"
        || state.outcomes[index]
            .outcome
            .get("feedbackPromptedAt")
            .is_none_or(Value::is_null)
    {
        return Err(PendingOutcomeError::bad_request(
            "outcome_not_prompted",
            "Feedback is accepted only after the outcome question is claimed.",
        ));
    }

    let result_state;
    if task_outcome == "completed" {
        if reason.is_some() {
            return Err(PendingOutcomeError::bad_request(
                "unexpected_failure_reason",
                "Completed outcomes cannot include a failure reason.",
            ));
        }
        let mut outcome = state.outcomes[index].outcome.clone();
        set_outcome_field(&mut outcome, "status", json!("succeeded"));
        set_outcome_field(&mut outcome, "failureReasonTokens", json!([]));
        state.outcomes[index].outcome = validated_pending_outcome(outcome)?;
        state.outcomes[index].feedback_state = "resolved".to_string();
        result_state = "completed";
    } else if state.outcomes[index].feedback_state == "asked" {
        if reason.is_some() {
            return Err(PendingOutcomeError::bad_request(
                "failure_reason_not_requested",
                "Choose not_completed before submitting a reason.",
            ));
        }
        state.outcomes[index].feedback_state = "reason_required".to_string();
        result_state = "reason_required";
    } else if state.outcomes[index].feedback_state == "reason_required" {
        if let Some(reason_token) = reason.as_deref() {
            if !FAILURE_REASON_TOKENS.contains(&reason_token) {
                return Err(PendingOutcomeError::bad_request(
                    "invalid_failure_reason",
                    "Failure reason is not in the finite allowlist.",
                ));
            }
            let mut outcome = state.outcomes[index].outcome.clone();
            set_outcome_field(&mut outcome, "status", json!("failed"));
            set_outcome_field(&mut outcome, "failureReasonTokens", json!([reason_token]));
            state.outcomes[index].outcome = validated_pending_outcome(outcome)?;
            state.outcomes[index].feedback_state = "resolved".to_string();
            result_state = "not_completed";
        } else {
            result_state = "reason_required";
        }
    } else {
        return Err(PendingOutcomeError::conflict(
            "outcome_feedback_conflict",
            "Outcome feedback cannot be changed from its current state.",
        ));
    }

    let receipt = FeedbackReceipt {
        id: feedback_id,
        digest: request_digest,
        outcome_id,
        result_state: result_state.to_string(),
        outcome_status: outcome_string(&state.outcomes[index].outcome, "status").to_string(),
        failure_reason_tokens: state.outcomes[index]
            .outcome
            .get("failureReasonTokens")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
    };
    state.feedback_receipts.push(receipt.clone());
    persist_state_locked(data_dir, &state)?;
    feedback_response_from_receipt(&state, &receipt)
}

pub fn record_feedback_at(
    data_dir: &Path,
    input: &Value,
    now: &str,
) -> Result<Value, PendingOutcomeError> {
    submit_outcome_feedback_at(data_dir, input, now)
}

pub fn submit_failure_reason(data_dir: &Path, input: &Value) -> Result<Value, PendingOutcomeError> {
    submit_failure_reason_at(data_dir, input, &now_iso())
}

pub fn submit_failure_reason_at(
    data_dir: &Path,
    input: &Value,
    now: &str,
) -> Result<Value, PendingOutcomeError> {
    let mut request = input.clone();
    request
        .as_object_mut()
        .ok_or_else(|| {
            PendingOutcomeError::bad_request(
                "invalid_outcome_request",
                "Outcome request must be an object.",
            )
        })?
        .insert("taskOutcomeToken".to_string(), json!("not_completed"));
    submit_outcome_feedback_at(data_dir, &request, now)
}

pub fn expire_due_outcomes(data_dir: &Path) -> Result<Value, PendingOutcomeError> {
    expire_due_outcomes_at(data_dir, &now_iso())
}

pub fn expire_due_outcomes_at(data_dir: &Path, now: &str) -> Result<Value, PendingOutcomeError> {
    let timestamp = canonical_timestamp(now)?;
    let _guard = lock_store();
    let mut state = load_state_locked(data_dir)?;
    let expired = expire_state(&mut state, &timestamp)?;
    if !expired.is_empty() {
        persist_state_locked(data_dir, &state)?;
    }
    Ok(Value::Array(expired))
}

pub fn get_outcome(data_dir: &Path, outcome_id: &str) -> Result<Value, PendingOutcomeError> {
    get_outcome_at(data_dir, outcome_id, &now_iso())
}

pub fn get_outcome_at(
    data_dir: &Path,
    outcome_id: &str,
    now: &str,
) -> Result<Value, PendingOutcomeError> {
    assert_privacy_safe(&json!({ "outcomeId": outcome_id }))?;
    if !valid_token(outcome_id) {
        return Err(PendingOutcomeError::bad_request(
            "invalid_outcome_token",
            "outcomeId must be a bounded opaque token.",
        ));
    }
    let timestamp = canonical_timestamp(now)?;
    let _guard = lock_store();
    let state = read_current_state_locked(data_dir, &timestamp)?;
    Ok(find_outcome_index(&state, outcome_id)
        .map(|index| state.outcomes[index].outcome.clone())
        .unwrap_or(Value::Null))
}

pub fn get_feedback_state(data_dir: &Path, outcome_id: &str) -> Result<Value, PendingOutcomeError> {
    get_feedback_state_at(data_dir, outcome_id, &now_iso())
}

pub fn get_feedback_state_at(
    data_dir: &Path,
    outcome_id: &str,
    now: &str,
) -> Result<Value, PendingOutcomeError> {
    assert_privacy_safe(&json!({ "outcomeId": outcome_id }))?;
    if !valid_token(outcome_id) {
        return Err(PendingOutcomeError::bad_request(
            "invalid_outcome_token",
            "outcomeId must be a bounded opaque token.",
        ));
    }
    let timestamp = canonical_timestamp(now)?;
    let _guard = lock_store();
    let state = read_current_state_locked(data_dir, &timestamp)?;
    Ok(find_outcome_index(&state, outcome_id)
        .map(|index| {
            json!({
                "state": state.outcomes[index].feedback_state,
                "outcome": state.outcomes[index].outcome
            })
        })
        .unwrap_or(Value::Null))
}

fn list_outcomes_locked(state: &StoreState, options: &Map<String, Value>) -> Vec<Value> {
    let target = options.get("target").and_then(Value::as_str);
    let project_scope_token = options.get("projectScopeToken").and_then(Value::as_str);
    let status = options.get("status").and_then(Value::as_str);
    let mut outcomes = state
        .outcomes
        .iter()
        .map(|entry| entry.outcome.clone())
        .filter(|outcome| target.is_none_or(|value| outcome_string(outcome, "target") == value))
        .filter(|outcome| {
            project_scope_token
                .is_none_or(|value| outcome_string(outcome, "projectScopeToken") == value)
        })
        .filter(|outcome| status.is_none_or(|value| outcome_string(outcome, "status") == value))
        .collect::<Vec<_>>();
    outcomes.sort_by(|left, right| {
        let left_created = timestamp_millis(outcome_string(left, "createdAt")).unwrap_or(i64::MIN);
        let right_created =
            timestamp_millis(outcome_string(right, "createdAt")).unwrap_or(i64::MIN);
        right_created
            .cmp(&left_created)
            .then_with(|| outcome_string(right, "outcomeId").cmp(outcome_string(left, "outcomeId")))
    });
    outcomes
}

fn validate_list_options(input: &Value) -> Result<Map<String, Value>, PendingOutcomeError> {
    assert_privacy_safe(input)?;
    let object = object_with_only_keys(
        input,
        &["target", "projectScopeToken", "status"],
        "invalid_outcome_request",
    )?;
    if object.contains_key("target") {
        required_token(object, "target")?;
    }
    if object.contains_key("projectScopeToken") {
        required_token(object, "projectScopeToken")?;
    }
    if let Some(status) = object.get("status") {
        let status = status.as_str().unwrap_or("");
        if !PENDING_OUTCOME_STATUSES.contains(&status) {
            return Err(PendingOutcomeError::bad_request(
                "invalid_outcome_status",
                "Outcome status is not supported.",
            ));
        }
    }
    Ok(object.clone())
}

pub fn list_outcomes(data_dir: &Path, options: &Value) -> Result<Value, PendingOutcomeError> {
    list_outcomes_at(data_dir, options, &now_iso())
}

pub fn list_outcomes_at(
    data_dir: &Path,
    options: &Value,
    now: &str,
) -> Result<Value, PendingOutcomeError> {
    let options = validate_list_options(options)?;
    let timestamp = canonical_timestamp(now)?;
    let _guard = lock_store();
    let state = read_current_state_locked(data_dir, &timestamp)?;
    Ok(Value::Array(list_outcomes_locked(&state, &options)))
}

pub fn list_pending_outcomes(
    data_dir: &Path,
    options: &Value,
) -> Result<Value, PendingOutcomeError> {
    list_pending_outcomes_at(data_dir, options, &now_iso())
}

pub fn list_pending_outcomes_at(
    data_dir: &Path,
    options: &Value,
    now: &str,
) -> Result<Value, PendingOutcomeError> {
    assert_privacy_safe(options)?;
    let object = object_with_only_keys(
        options,
        &["target", "projectScopeToken", "status"],
        "invalid_outcome_request",
    )?;
    let mut pending_options = object.clone();
    pending_options.insert("status".to_string(), json!("unknown"));
    list_outcomes_at(data_dir, &Value::Object(pending_options), now)
}

pub fn list_implicit_signals(
    data_dir: &Path,
    options: &Value,
) -> Result<Value, PendingOutcomeError> {
    list_implicit_signals_at(data_dir, options, &now_iso())
}

pub fn list_implicit_signals_at(
    data_dir: &Path,
    options: &Value,
    now: &str,
) -> Result<Value, PendingOutcomeError> {
    assert_privacy_safe(options)?;
    let object = object_with_only_keys(
        options,
        &["target", "projectScopeToken", "outcomeId"],
        "invalid_outcome_request",
    )?;
    for field in ["target", "projectScopeToken", "outcomeId"] {
        if object.contains_key(field) {
            required_token(object, field)?;
        }
    }
    let timestamp = canonical_timestamp(now)?;
    let _guard = lock_store();
    let state = read_current_state_locked(data_dir, &timestamp)?;
    let target = object.get("target").and_then(Value::as_str);
    let project_scope_token = object.get("projectScopeToken").and_then(Value::as_str);
    let outcome_id = object.get("outcomeId").and_then(Value::as_str);
    Ok(Value::Array(
        state
            .implicit_signals
            .into_iter()
            .filter(|event| target.is_none_or(|value| outcome_string(event, "target") == value))
            .filter(|event| {
                project_scope_token
                    .is_none_or(|value| outcome_string(event, "projectScopeToken") == value)
            })
            .filter(|event| {
                outcome_id.is_none_or(|value| outcome_string(event, "outcomeId") == value)
            })
            .collect(),
    ))
}

pub fn invalidate_project(
    data_dir: &Path,
    project_scope_token: &str,
) -> Result<Value, PendingOutcomeError> {
    invalidate_project_at(data_dir, project_scope_token, &now_iso())
}

pub fn invalidate_project_outcomes(
    data_dir: &Path,
    project_scope_token: &str,
) -> Result<Value, PendingOutcomeError> {
    invalidate_project(data_dir, project_scope_token)
}

pub fn invalidate_project_at(
    data_dir: &Path,
    project_scope_token: &str,
    now: &str,
) -> Result<Value, PendingOutcomeError> {
    let request = json!({ "projectScopeToken": project_scope_token });
    assert_privacy_safe(&request)?;
    if !valid_token(project_scope_token) {
        return Err(PendingOutcomeError::bad_request(
            "invalid_outcome_token",
            "projectScopeToken must be a bounded opaque token.",
        ));
    }
    let timestamp = canonical_timestamp(now)?;
    let _guard = lock_store();
    let mut state = read_current_state_locked(data_dir, &timestamp)?;
    let mut invalidated = Vec::new();
    for entry in &mut state.outcomes {
        if outcome_string(&entry.outcome, "projectScopeToken") != project_scope_token
            || outcome_string(&entry.outcome, "status") == "invalidated"
        {
            continue;
        }
        let mut outcome = entry.outcome.clone();
        set_outcome_field(&mut outcome, "status", json!("invalidated"));
        set_outcome_field(&mut outcome, "failureReasonTokens", json!([]));
        entry.outcome = validated_pending_outcome(outcome)?;
        entry.feedback_state = "invalidated".to_string();
        invalidated.push(entry.outcome.clone());
    }
    if !invalidated.is_empty() {
        persist_state_locked(data_dir, &state)?;
    }
    Ok(json!({
        "projectScopeToken": project_scope_token,
        "invalidatedAt": timestamp,
        "invalidatedCount": invalidated.len(),
        "outcomes": invalidated
    }))
}

pub fn invalidate_project_outcomes_at(
    data_dir: &Path,
    project_scope_token: &str,
    now: &str,
) -> Result<Value, PendingOutcomeError> {
    invalidate_project_at(data_dir, project_scope_token, now)
}
