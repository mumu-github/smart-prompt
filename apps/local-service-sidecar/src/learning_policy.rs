#![allow(dead_code)]

use crate::outcome_contracts;
use chrono::{DateTime, SecondsFormat, Utc};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    error::Error,
    fmt, fs,
    fs::OpenOptions,
    io::{self, ErrorKind, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

pub const LEARNING_STORE_SCHEMA_VERSION: &str = "learning-artifacts-store@1";
pub const LEARNING_ARCHIVE_SCHEMA_VERSION: &str = "learning-project-archive@1";
pub const GENERATION_POLICY_COMPILER_VERSION: &str = "generation-policy-compiler@1";
pub const GENERATION_POLICY_REGISTRY_VERSION: &str = "generation-policy-registry@1";
pub const POLICY_ROLLOUT_ENGINE_VERSION: &str = "generation-policy-rollout@1";
pub const DEFAULT_CANARY_SHARE_BPS: u16 = 1_000;
pub const LEARNING_STATE_FILE_NAME: &str = "learning-artifacts-v1.json";
pub const POLICY_REGISTRY_FILE_NAME: &str = "generation-policy-registry-v1.json";
pub const ALLOWED_POLICY_DIRECTIVE_KINDS: [&str; 5] = [
    "structure_order",
    "detail_level",
    "deduplicate",
    "strategy_selection",
    "context_budget",
];
pub const MIN_POLICY_INPUT_TOKENS: u64 = 256;
pub const MAX_POLICY_INPUT_TOKENS: u64 = 4_096;
pub const MAX_POLICY_CONTEXT_SOURCE_TOKENS: u64 = 1_024;

const LEARNING_OBSERVATION_VERSION: &str = "learning-observation@1";
const LEARNING_ARTIFACT_VERSION: &str = "learning-artifact@1";
const GENERATION_POLICY_VERSION: &str = "generation-policy@1";
const POLICY_ROLLOUT_VERSION: &str = "policy-rollout@1";
const DEFAULT_MIN_PER_ARM: u64 = 10;
const DEFAULT_TOKEN_IMPROVEMENT: f64 = 0.05;
const DEFAULT_MINIMUM_EFFECT: f64 = 0.03;
const DEFAULT_CONFIDENCE: f64 = 0.90;

type Clock = Arc<dyn Fn() -> String + Send + Sync>;

#[derive(Debug, Clone)]
pub struct LearningPolicyError {
    pub code: String,
    pub message: String,
    pub validation_errors: Vec<outcome_contracts::ValidationError>,
}

impl LearningPolicyError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            validation_errors: Vec::new(),
        }
    }

    fn validation(contract: &str, errors: Vec<outcome_contracts::ValidationError>) -> Self {
        let detail = errors
            .iter()
            .map(|error| format!("{} {}", error.path, error.message))
            .collect::<Vec<_>>()
            .join("; ");
        Self {
            code: "contract_validation_failed".to_string(),
            message: format!("Invalid {contract} contract: {detail}"),
            validation_errors: errors,
        }
    }
}

impl fmt::Display for LearningPolicyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl Error for LearningPolicyError {}

pub type LearningPolicyResult<T> = Result<T, LearningPolicyError>;

fn io_error(code: &str, action: &str, error: io::Error) -> LearningPolicyError {
    LearningPolicyError::new(code, format!("{action}: {error}"))
}

fn serde_error(code: &str, action: &str, error: serde_json::Error) -> LearningPolicyError {
    LearningPolicyError::new(code, format!("{action}: {error}"))
}

fn default_clock() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn canonical_timestamp(value: &str) -> LearningPolicyResult<String> {
    DateTime::parse_from_rfc3339(value.trim())
        .map(|timestamp| {
            timestamp
                .with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Millis, true)
        })
        .map_err(|_| {
            LearningPolicyError::new(
                "invalid_learning_clock",
                "The learning timestamp must be RFC3339.",
            )
        })
}

fn clock_now(clock: &Clock) -> LearningPolicyResult<String> {
    canonical_timestamp(&(clock)())
}

fn create_id(prefix: &str) -> String {
    let mut bytes = [0_u8; 12];
    OsRng.fill_bytes(&mut bytes);
    format!("{prefix}_{}", hex_encode(&bytes))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn hex_decode(value: &str) -> Option<Vec<u8>> {
    if value.len() % 2 != 0 {
        return None;
    }
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(value.len() / 2);
    for index in (0..bytes.len()).step_by(2) {
        let high = hex_nibble(bytes[index])?;
        let low = hex_nibble(bytes[index + 1])?;
        output.push((high << 4) | low);
    }
    Some(output)
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
    }
}

fn base64_encode(bytes: &[u8], url_safe: bool, padded: bool) -> String {
    let alphabet = if url_safe {
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    } else {
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    };
    let mut output = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied().unwrap_or_default();
        let third = chunk.get(2).copied().unwrap_or_default();
        output.push(alphabet[(first >> 2) as usize] as char);
        output.push(alphabet[(((first & 0x03) << 4) | (second >> 4)) as usize] as char);
        if chunk.len() >= 2 {
            output.push(alphabet[(((second & 0x0f) << 2) | (third >> 6)) as usize] as char);
        } else if padded {
            output.push('=');
        }
        if chunk.len() == 3 {
            output.push(alphabet[(third & 0x3f) as usize] as char);
        } else if padded {
            output.push('=');
        }
    }
    output
}

fn base64_decode(value: &str) -> Option<Vec<u8>> {
    if value.is_empty() || value.len() % 4 != 0 {
        return None;
    }
    let decode = |byte: u8| -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(value.len() / 4 * 3);
    for (chunk_index, chunk) in bytes.chunks(4).enumerate() {
        let last_chunk = chunk_index + 1 == bytes.len() / 4;
        let padding = usize::from(chunk[3] == b'=') + usize::from(chunk[2] == b'=');
        if (padding > 0 && !last_chunk) || (chunk[2] == b'=' && chunk[3] != b'=') {
            return None;
        }
        let first = decode(chunk[0])?;
        let second = decode(chunk[1])?;
        let third = if chunk[2] == b'=' {
            0
        } else {
            decode(chunk[2])?
        };
        let fourth = if chunk[3] == b'=' {
            0
        } else {
            decode(chunk[3])?
        };
        output.push((first << 2) | (second >> 4));
        if padding < 2 {
            output.push((second << 4) | (third >> 2));
        }
        if padding == 0 {
            output.push((third << 6) | fourth);
        }
    }
    Some(output)
}

fn sha256_hex(value: impl AsRef<[u8]>) -> String {
    let mut digest = Sha256::new();
    digest.update(value.as_ref());
    hex_encode(&digest.finalize())
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    let mut normalized = [0_u8; 64];
    if key.len() > normalized.len() {
        let mut digest = Sha256::new();
        digest.update(key);
        normalized[..32].copy_from_slice(&digest.finalize());
    } else {
        normalized[..key.len()].copy_from_slice(key);
    }

    let mut inner_pad = [0_u8; 64];
    let mut outer_pad = [0_u8; 64];
    for index in 0..64 {
        inner_pad[index] = normalized[index] ^ 0x36;
        outer_pad[index] = normalized[index] ^ 0x5c;
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner_digest = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_digest);
    outer.finalize().into()
}

fn compact_field_name(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn forbidden_learning_field(value: &str) -> bool {
    matches!(
        compact_field_name(value).as_str(),
        "prompt"
            | "prompttext"
            | "rawprompt"
            | "rawinput"
            | "originalinput"
            | "inputtext"
            | "generatedprompt"
            | "draft"
            | "chat"
            | "chatcontent"
            | "chattext"
            | "clipboard"
            | "clipboardcontent"
            | "clipboardtext"
            | "title"
            | "windowtitle"
            | "rawtitle"
            | "path"
            | "projectpath"
            | "absoluteprojectpath"
            | "absolutepath"
            | "key"
            | "apikey"
            | "keymaterial"
            | "credential"
            | "secret"
            | "rawevidence"
            | "evidencetext"
            | "rawuia"
            | "rawdom"
            | "embeddingvector"
            | "vector"
    )
}

fn contains_absolute_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    let drive_path = bytes.windows(3).any(|window| {
        window[0].is_ascii_alphabetic()
            && window[1] == b':'
            && (window[2] == b'\\' || window[2] == b'/')
    });
    drive_path
        || value.starts_with("\\\\")
        || value.contains("/Users/")
        || value.starts_with("/Users/")
        || value.contains("/home/")
        || value.starts_with("/home/")
}

fn credential_value_shaped(value: &str) -> bool {
    let trimmed = value.trim();
    let lower = trimmed.to_ascii_lowercase();
    (lower.starts_with("bearer ") && trimmed.len() >= 20)
        || lower.contains("-----begin private key-----")
        || (lower.starts_with("sk-") && trimmed.len() >= 15)
        || (trimmed.starts_with("AKIA") && trimmed.len() >= 16)
        || (lower.starts_with("ghp_") && trimmed.len() >= 24)
        || (lower.starts_with("github_pat_") && trimmed.len() >= 24)
        || (lower.starts_with("xox") && trimmed.len() >= 16)
        || (trimmed.starts_with("AIza") && trimmed.len() >= 24)
        || (lower.starts_with("ya29.") && trimmed.len() >= 20)
}

fn credential_token_shaped(value: &str) -> bool {
    credential_value_shaped(value)
        || value
            .to_ascii_lowercase()
            .split(['.', '_', ':', '@', '-'])
            .any(|segment| {
                matches!(
                    segment,
                    "secret" | "credential" | "password" | "apikey" | "privatekey"
                )
            })
}

fn privacy_violations(value: &Value, path: &str, output: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            for (key, item) in object {
                let child_path = format!("{path}.{key}");
                if forbidden_learning_field(key) {
                    output.push(child_path.clone());
                }
                if is_privacy_flag(key) && item != &Value::Bool(false) {
                    output.push(child_path.clone());
                }
                privacy_violations(item, &child_path, output);
            }
        }
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                privacy_violations(item, &format!("{path}[{index}]"), output);
            }
        }
        Value::String(text) => {
            if contains_absolute_path(text) || credential_value_shaped(text) {
                output.push(path.to_string());
            }
        }
        _ => {}
    }
}

fn assert_privacy_safe_input(value: &Value) -> LearningPolicyResult<()> {
    let mut violations = Vec::new();
    privacy_violations(value, "$", &mut violations);
    if violations.is_empty() {
        Ok(())
    } else {
        Err(LearningPolicyError::new(
            "privacy_input_rejected",
            format!(
                "Raw, path, or credential input cannot cross the learning boundary: {}",
                violations.join(", ")
            ),
        ))
    }
}

fn is_privacy_flag(value: &str) -> bool {
    matches!(
        value,
        "rawInputStored"
            | "generatedPromptStored"
            | "chatContentStored"
            | "clipboardContentStored"
            | "windowTitleStored"
            | "absoluteProjectPathStored"
            | "credentialStored"
            | "rawEvidenceStored"
    )
}

fn privacy_flags() -> Value {
    json!({
        "rawInputStored": false,
        "generatedPromptStored": false,
        "chatContentStored": false,
        "clipboardContentStored": false,
        "windowTitleStored": false,
        "absoluteProjectPathStored": false,
        "credentialStored": false,
        "rawEvidenceStored": false
    })
}

fn valid_token(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 180
        && bytes[0].is_ascii_alphanumeric()
        && bytes.iter().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'@' | b'-')
        })
        && !credential_value_shaped(value)
}

fn valid_policy_token(value: &str) -> bool {
    valid_token(value) && !credential_token_shaped(value)
}

fn require_token(value: Option<&str>, field: &str) -> LearningPolicyResult<String> {
    let value = value.unwrap_or_default().trim();
    if valid_token(value) {
        Ok(value.to_string())
    } else {
        Err(LearningPolicyError::new(
            "invalid_learning_token",
            format!("{field} must be a bounded opaque token."),
        ))
    }
}

fn safe_token(value: Option<&str>, fallback: &str) -> String {
    let value = value.unwrap_or_default().trim();
    if valid_policy_token(value) {
        value.to_string()
    } else {
        fallback.to_string()
    }
}

fn token_array(
    value: Option<&Value>,
    field: &str,
    minimum: usize,
    maximum: usize,
) -> LearningPolicyResult<Vec<String>> {
    let items = value.and_then(Value::as_array).ok_or_else(|| {
        LearningPolicyError::new(
            "invalid_learning_token",
            format!("{field} must be an array of opaque tokens."),
        )
    })?;
    if items.len() < minimum || items.len() > maximum {
        return Err(LearningPolicyError::new(
            "invalid_learning_token",
            format!("{field} must contain {minimum}-{maximum} opaque tokens."),
        ));
    }
    let mut result = Vec::with_capacity(items.len());
    let mut seen = HashSet::new();
    for (index, item) in items.iter().enumerate() {
        let token = require_token(item.as_str(), &format!("{field}[{index}]"))?;
        if !seen.insert(token.clone()) {
            return Err(LearningPolicyError::new(
                "invalid_learning_token",
                format!("{field} must not contain duplicate tokens."),
            ));
        }
        result.push(token);
    }
    Ok(result)
}

fn validate_contract(contract: &str, value: &Value) -> LearningPolicyResult<()> {
    let result = outcome_contracts::validate_contract(contract, value)
        .map_err(|error| LearningPolicyError::new("unsupported_contract", error.to_string()))?;
    if result.is_valid() {
        Ok(())
    } else {
        Err(LearningPolicyError::validation(contract, result.errors))
    }
}

fn canonical_value(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(canonical_value).collect()),
        Value::Object(object) => {
            let mut ordered = BTreeMap::new();
            for (key, item) in object {
                ordered.insert(key.clone(), canonical_value(item));
            }
            serde_json::to_value(ordered).expect("canonical JSON maps are serializable")
        }
        _ => value.clone(),
    }
}

fn canonical_json(value: &Value) -> String {
    serde_json::to_string(&canonical_value(value)).expect("JSON values are serializable")
}

fn write_json<T: Serialize>(file: &Path, value: &T) -> LearningPolicyResult<()> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| io_error("learning_storage_error", "create data directory", error))?;
    }
    let mut bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| serde_error("learning_storage_error", "serialize JSON state", error))?;
    bytes.push(b'\n');
    fs::write(file, bytes)
        .map_err(|error| io_error("learning_storage_error", "write JSON state", error))
}

fn ensure_safe_root(root: &Path) -> LearningPolicyResult<()> {
    if root.as_os_str().is_empty() || root.parent().is_none() {
        return Err(LearningPolicyError::new(
            "invalid_learning_directory",
            "A non-root learning data directory is required.",
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillGates {
    pub permission: bool,
    pub isolation: bool,
    #[serde(rename = "static")]
    pub static_check: bool,
    pub adversarial: bool,
}

impl SkillGates {
    pub fn all_passed(&self) -> bool {
        self.permission && self.isolation && self.static_check && self.adversarial
    }

    fn from_value(value: Option<&Value>, payload: &Value) -> LearningPolicyResult<Self> {
        let mut gates = SkillGates {
            permission: payload
                .get("permissionCheckPassed")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            isolation: payload
                .get("isolationTestPassed")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            static_check: false,
            adversarial: payload
                .get("adversarialReviewPassed")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        };
        let Some(value) = value else {
            return Ok(gates);
        };
        let object = value.as_object().ok_or_else(|| {
            LearningPolicyError::new(
                "invalid_skill_gates",
                "Skill gates must be an object of finite boolean decisions.",
            )
        })?;
        for key in object.keys() {
            if !matches!(
                key.as_str(),
                "permission" | "isolation" | "static" | "adversarial"
            ) {
                return Err(LearningPolicyError::new(
                    "invalid_skill_gates",
                    "Skill gates contain an unsupported decision.",
                ));
            }
        }
        let read = |key: &str, fallback: bool| -> LearningPolicyResult<bool> {
            match object.get(key) {
                Some(Value::Bool(value)) => Ok(*value),
                Some(_) => Err(LearningPolicyError::new(
                    "invalid_skill_gates",
                    "Skill gate decisions must be boolean.",
                )),
                None => Ok(fallback),
            }
        };
        gates.permission = read("permission", gates.permission)?;
        gates.isolation = read("isolation", gates.isolation)?;
        gates.static_check = read("static", gates.static_check)?;
        gates.adversarial = read("adversarial", gates.adversarial)?;
        Ok(gates)
    }

    fn as_json(&self) -> Value {
        json!({
            "permission": self.permission,
            "isolation": self.isolation,
            "static": self.static_check,
            "adversarial": self.adversarial
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ObservationRecord {
    observation: Value,
    project_scope_token: String,
    session_id: String,
    outcome_id: String,
    #[serde(default)]
    rollout_eligible: bool,
    valid: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CandidateEvidence {
    evidence_id: String,
    observation_id: String,
    project_scope_token: String,
    session_id: String,
    outcome_id: String,
    fingerprint_value_token: String,
    artifact_type: String,
    payload: Value,
    skill_gates: Option<SkillGates>,
    task_outcome_token: String,
    explicit_negative_feedback: bool,
    valid: bool,
    created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ArtifactRecord {
    artifact: Value,
    origin_project_scope_token: String,
    fingerprint_value_token: String,
    source_artifact_type: String,
    narrow_scope_tokens: Vec<String>,
    skill_gates: Option<SkillGates>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PromotionEvidence {
    evidence_id: String,
    promotion_key_token: String,
    project_scope_token: String,
    session_id: String,
    outcome_id: String,
    artifact_type: String,
    payload: Value,
    skill_gates: Option<SkillGates>,
    succeeded: bool,
    explicit_negative_feedback: bool,
    valid: bool,
    created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GlobalProposal {
    proposal_id: String,
    promotion_key_token: String,
    artifact_type: String,
    artifact: Value,
    evidence_ids: Vec<String>,
    project_scope_tokens: Vec<String>,
    successful_outcome_count: u64,
    explicit_negative_feedback_count: u64,
    skill_gates: Option<SkillGates>,
    status: String,
    system_created: bool,
    final_confirmation_required: bool,
    effective: bool,
    created_at: String,
    updated_at: String,
    confirmed_at: Option<String>,
    invalidated_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InvalidationRecord {
    invalidation_id: String,
    archive_token: String,
    project_scope_token: String,
    invalidated_at: String,
    observation_count: usize,
    artifact_count: usize,
    promotion_evidence_count: usize,
    proposal_count: usize,
    policy_count: usize,
    rollout_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LearningState {
    schema_version: String,
    observations: Vec<ObservationRecord>,
    candidate_evidence: Vec<CandidateEvidence>,
    artifacts: Vec<ArtifactRecord>,
    promotion_evidence: Vec<PromotionEvidence>,
    proposals: Vec<GlobalProposal>,
    invalidations: Vec<InvalidationRecord>,
}

impl Default for LearningState {
    fn default() -> Self {
        Self {
            schema_version: LEARNING_STORE_SCHEMA_VERSION.to_string(),
            observations: Vec::new(),
            candidate_evidence: Vec::new(),
            artifacts: Vec::new(),
            promotion_evidence: Vec::new(),
            proposals: Vec::new(),
            invalidations: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordObservationResult {
    pub observation: Value,
    pub candidate: Option<Value>,
    pub card_reminder: Option<Value>,
    pub duplicate: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateDetail {
    pub artifact: Value,
    pub narrow_scope_tokens: Vec<String>,
    pub skill_gates: Option<Value>,
    pub card_reminder_enabled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotionResult {
    pub evidence: Value,
    pub proposal: Option<Value>,
    pub duplicate: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearProjectCounts {
    pub observations: usize,
    pub candidate_evidence: usize,
    pub artifacts: usize,
    pub promotion_evidence: usize,
    pub proposals: usize,
    pub policies: usize,
    pub rollouts: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearProjectResult {
    pub project_scope_token: String,
    pub archive_token: String,
    pub archive_dir: PathBuf,
    pub invalidated_at: String,
    pub key_archived: bool,
    pub counts: ClearProjectCounts,
}

pub struct LearningPolicyStore {
    root: PathBuf,
    state_file: PathBuf,
    archive_root: PathBuf,
    keys_dir: PathBuf,
    clock: Clock,
    lock: Mutex<()>,
}

impl LearningPolicyStore {
    pub fn open(root: impl AsRef<Path>) -> LearningPolicyResult<Self> {
        Self::open_with_clock(root, default_clock)
    }

    pub fn open_with_clock<F>(root: impl AsRef<Path>, clock: F) -> LearningPolicyResult<Self>
    where
        F: Fn() -> String + Send + Sync + 'static,
    {
        let root = root.as_ref().to_path_buf();
        ensure_safe_root(&root)?;
        fs::create_dir_all(&root).map_err(|error| {
            io_error(
                "learning_storage_error",
                "create learning data directory",
                error,
            )
        })?;
        let store = Self {
            state_file: root.join(LEARNING_STATE_FILE_NAME),
            archive_root: root.join("learning-archive"),
            keys_dir: root.join("learning-keys"),
            root,
            clock: Arc::new(clock),
            lock: Mutex::new(()),
        };
        if store.state_file.exists() {
            store.read_state()?;
        } else {
            write_json(&store.state_file, &LearningState::default())?;
        }
        Ok(store)
    }

    pub fn state_file(&self) -> &Path {
        &self.state_file
    }

    pub fn project_key_file(&self, project_scope_token: &str) -> LearningPolicyResult<PathBuf> {
        let project_scope_token = require_token(Some(project_scope_token), "projectScopeToken")?;
        Ok(self.keys_dir.join(format!(
            "{}.hmac.key",
            base64_encode(project_scope_token.as_bytes(), true, false)
        )))
    }

    fn read_state(&self) -> LearningPolicyResult<LearningState> {
        let text = fs::read_to_string(&self.state_file)
            .map_err(|error| io_error("invalid_learning_state", "read learning state", error))?;
        let state: LearningState = serde_json::from_str(&text).map_err(|error| {
            serde_error("invalid_learning_state", "parse learning state", error)
        })?;
        if state.schema_version != LEARNING_STORE_SCHEMA_VERSION {
            return Err(LearningPolicyError::new(
                "invalid_learning_state",
                "The learning state version is unsupported and was not replaced.",
            ));
        }
        for entry in &state.observations {
            validate_contract("learning_observation", &entry.observation).map_err(|error| {
                LearningPolicyError::new(
                    "invalid_learning_state",
                    format!("Stored observation is invalid: {error}"),
                )
            })?;
        }
        for record in &state.artifacts {
            validate_contract("learning_artifact", &record.artifact).map_err(|error| {
                LearningPolicyError::new(
                    "invalid_learning_state",
                    format!("Stored artifact is invalid: {error}"),
                )
            })?;
        }
        for proposal in &state.proposals {
            validate_contract("learning_artifact", &proposal.artifact).map_err(|error| {
                LearningPolicyError::new(
                    "invalid_learning_state",
                    format!("Stored proposal is invalid: {error}"),
                )
            })?;
        }
        Ok(state)
    }

    fn persist_state(&self, state: &LearningState) -> LearningPolicyResult<()> {
        write_json(&self.state_file, state)
    }

    fn key_path(&self, project_scope_token: &str) -> PathBuf {
        self.keys_dir.join(format!(
            "{}.hmac.key",
            base64_encode(project_scope_token.as_bytes(), true, false)
        ))
    }

    fn read_project_key(&self, file: &Path) -> LearningPolicyResult<Vec<u8>> {
        let encoded = fs::read_to_string(file).map_err(|error| {
            io_error("invalid_project_hmac_key", "read project HMAC key", error)
        })?;
        let encoded = encoded.trim();
        let key = base64_decode(encoded).ok_or_else(|| {
            LearningPolicyError::new(
                "invalid_project_hmac_key",
                "The project HMAC key is invalid and was not replaced.",
            )
        })?;
        if key.len() != 32 || base64_encode(&key, false, true) != encoded {
            return Err(LearningPolicyError::new(
                "invalid_project_hmac_key",
                "The project HMAC key is invalid and was not replaced.",
            ));
        }
        Ok(key)
    }

    fn load_or_create_project_key(
        &self,
        project_scope_token: &str,
    ) -> LearningPolicyResult<Vec<u8>> {
        let file = self.key_path(project_scope_token);
        if file.exists() {
            return self.read_project_key(&file);
        }
        fs::create_dir_all(&self.keys_dir).map_err(|error| {
            io_error(
                "learning_storage_error",
                "create learning key directory",
                error,
            )
        })?;
        let mut key = [0_u8; 32];
        OsRng.fill_bytes(&mut key);
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&file) {
            Ok(mut handle) => {
                handle
                    .write_all(format!("{}\n", base64_encode(&key, false, true)).as_bytes())
                    .map_err(|error| {
                        io_error("learning_storage_error", "write project HMAC key", error)
                    })?;
                Ok(key.to_vec())
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => self.read_project_key(&file),
            Err(error) => Err(io_error(
                "learning_storage_error",
                "create project HMAC key",
                error,
            )),
        }
    }

    fn fingerprint(
        &self,
        project_scope_token: &str,
        feature_tokens: &[String],
        create_key: bool,
    ) -> LearningPolicyResult<Option<String>> {
        let file = self.key_path(project_scope_token);
        let key = if create_key {
            self.load_or_create_project_key(project_scope_token)?
        } else if file.exists() {
            self.read_project_key(&file)?
        } else {
            return Ok(None);
        };
        let mut canonical = feature_tokens.to_vec();
        canonical.sort();
        let bytes = serde_json::to_vec(&canonical).expect("feature tokens serialize");
        Ok(Some(hex_encode(&hmac_sha256(&key, &bytes))))
    }

    fn now(&self) -> LearningPolicyResult<String> {
        clock_now(&self.clock)
    }

    fn validate_artifact_payload(
        &self,
        artifact_type: &str,
        payload: &Value,
        project_scope_token: &str,
        timestamp: &str,
        gates: Option<&Value>,
    ) -> LearningPolicyResult<(Value, Option<SkillGates>)> {
        if !matches!(
            artifact_type,
            "memory" | "rule" | "skill" | "generation_policy"
        ) {
            return Err(LearningPolicyError::new(
                "invalid_artifact_type",
                format!("Unsupported learning artifact type: {artifact_type}"),
            ));
        }
        assert_privacy_safe_input(payload)?;
        let mut normalized_payload = payload.clone();
        let skill_gates = if artifact_type == "skill" {
            let skill_gates = SkillGates::from_value(gates, payload)?;
            normalized_payload = with_skill_gates(payload, &skill_gates)?;
            Some(skill_gates)
        } else {
            None
        };
        let artifact = learning_artifact_value(
            "payload_validation",
            artifact_type,
            "pending_review",
            "project",
            Some(project_scope_token),
            normalized_payload.clone(),
            json!({
                "sessionCount": 0,
                "successfulOutcomeCount": 0,
                "explicitNegativeFeedbackCount": 0,
                "evidenceTokenCount": 0
            }),
            false,
            false,
            "pending",
            0,
            timestamp,
        );
        validate_contract("learning_artifact", &artifact)?;
        Ok((normalized_payload, skill_gates))
    }

    pub fn record_observation(
        &self,
        input: &Value,
    ) -> LearningPolicyResult<RecordObservationResult> {
        self.record_observation_with_skill_gates(input, None)
    }

    pub fn create_observation(
        &self,
        input: &Value,
    ) -> LearningPolicyResult<RecordObservationResult> {
        self.record_observation(input)
    }

    pub fn record_observation_with_skill_gates(
        &self,
        input: &Value,
        skill_gates: Option<&Value>,
    ) -> LearningPolicyResult<RecordObservationResult> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new("learning_storage_error", "Learning store lock is poisoned.")
        })?;
        let object = input.as_object().ok_or_else(|| {
            LearningPolicyError::new(
                "invalid_learning_input",
                "Learning observation input must be an object.",
            )
        })?;
        assert_privacy_safe_input(input)?;
        let project_scope_token = require_token(
            object.get("projectScopeToken").and_then(Value::as_str),
            "projectScopeToken",
        )?;
        let session_id =
            require_token(object.get("sessionId").and_then(Value::as_str), "sessionId")?;
        let outcome_id =
            require_token(object.get("outcomeId").and_then(Value::as_str), "outcomeId")?;
        let feature_tokens = token_array(object.get("featureTokens"), "featureTokens", 1, 64)?;
        let mut state = self.read_state()?;
        if let Some(duplicate) = state.observations.iter().find(|entry| {
            entry.project_scope_token == project_scope_token && entry.outcome_id == outcome_id
        }) {
            return Ok(RecordObservationResult {
                observation: duplicate.observation.clone(),
                candidate: None,
                card_reminder: None,
                duplicate: true,
            });
        }

        let timestamp = match object.get("createdAt").and_then(Value::as_str) {
            Some(value) => canonical_timestamp(value)?,
            None => self.now()?,
        };
        let fingerprint_value_token = self
            .fingerprint(&project_scope_token, &feature_tokens, true)?
            .expect("create_key always returns a fingerprint");
        let observation = build_observation(object, &fingerprint_value_token, &timestamp)?;
        let observation_id = observation["observationId"]
            .as_str()
            .expect("validated observation id")
            .to_string();
        state.observations.push(ObservationRecord {
            observation: observation.clone(),
            project_scope_token: project_scope_token.clone(),
            session_id: session_id.clone(),
            outcome_id: outcome_id.clone(),
            rollout_eligible: object
                .get("rolloutEligible")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            valid: true,
        });

        let mut candidate = None;
        if let Some(candidate_input) = object.get("candidate").filter(|value| !value.is_null()) {
            let candidate_object = candidate_input.as_object().ok_or_else(|| {
                LearningPolicyError::new("invalid_learning_input", "candidate must be an object.")
            })?;
            let artifact_type = require_token(
                candidate_object.get("artifactType").and_then(Value::as_str),
                "candidate.artifactType",
            )?;
            let payload = candidate_object.get("payload").ok_or_else(|| {
                LearningPolicyError::new("invalid_learning_input", "candidate.payload is required.")
            })?;
            let candidate_gates = skill_gates.or_else(|| candidate_object.get("skillGates"));
            let (payload, normalized_gates) = self.validate_artifact_payload(
                &artifact_type,
                payload,
                &project_scope_token,
                &timestamp,
                candidate_gates,
            )?;
            let task_outcome_token = observation["taskOutcomeToken"]
                .as_str()
                .unwrap_or("unknown")
                .to_string();
            let evidence = CandidateEvidence {
                evidence_id: create_id("candidate_evidence"),
                observation_id,
                project_scope_token: project_scope_token.clone(),
                session_id,
                outcome_id,
                fingerprint_value_token,
                artifact_type,
                payload,
                skill_gates: normalized_gates,
                task_outcome_token: task_outcome_token.clone(),
                explicit_negative_feedback: object
                    .get("explicitNegativeFeedback")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                    || task_outcome_token == "not_completed",
                valid: true,
                created_at: timestamp.clone(),
            };
            state.candidate_evidence.push(evidence.clone());
            candidate = maybe_create_candidate(&mut state, &evidence, &timestamp)?;
        }
        self.persist_state(&state)?;
        Ok(RecordObservationResult {
            observation,
            candidate,
            card_reminder: None,
            duplicate: false,
        })
    }

    pub fn list_observations(
        &self,
        project_scope_token: Option<&str>,
    ) -> LearningPolicyResult<Vec<Value>> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new("learning_storage_error", "Learning store lock is poisoned.")
        })?;
        if let Some(token) = project_scope_token {
            require_token(Some(token), "projectScopeToken")?;
        }
        Ok(self
            .read_state()?
            .observations
            .into_iter()
            .filter(|entry| {
                project_scope_token
                    .map(|token| entry.project_scope_token == token)
                    .unwrap_or(true)
            })
            .map(|entry| entry.observation)
            .collect())
    }

    pub fn list_observation_records(
        &self,
        project_scope_token: Option<&str>,
    ) -> LearningPolicyResult<Vec<Value>> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new("learning_storage_error", "Learning store lock is poisoned.")
        })?;
        if let Some(token) = project_scope_token {
            require_token(Some(token), "projectScopeToken")?;
        }
        Ok(self
            .read_state()?
            .observations
            .into_iter()
            .filter(|entry| {
                project_scope_token
                    .map(|token| entry.project_scope_token == token)
                    .unwrap_or(true)
            })
            .map(|entry| {
                json!({
                    "projectScopeToken": entry.project_scope_token,
                    "sessionId": entry.session_id,
                    "outcomeId": entry.outcome_id,
                    "rolloutEligible": entry.rollout_eligible,
                    "observation": entry.observation
                })
            })
            .collect())
    }

    pub fn list_artifacts(
        &self,
        project_scope_token: Option<&str>,
        status: Option<&str>,
        artifact_type: Option<&str>,
    ) -> LearningPolicyResult<Vec<Value>> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new("learning_storage_error", "Learning store lock is poisoned.")
        })?;
        let state = self.read_state()?;
        let mut artifacts = state
            .artifacts
            .iter()
            .filter(|record| {
                project_scope_token
                    .map(|token| record.origin_project_scope_token == token)
                    .unwrap_or(true)
            })
            .map(|record| record.artifact.clone())
            .collect::<Vec<_>>();
        if project_scope_token.is_none() {
            artifacts.extend(
                state
                    .proposals
                    .iter()
                    .filter(|proposal| proposal.status == "confirmed")
                    .map(|proposal| proposal.artifact.clone()),
            );
        }
        artifacts.retain(|artifact| {
            status
                .map(|expected| artifact["status"].as_str() == Some(expected))
                .unwrap_or(true)
                && artifact_type
                    .map(|expected| artifact["artifactType"].as_str() == Some(expected))
                    .unwrap_or(true)
        });
        Ok(artifacts)
    }

    pub fn get_candidate_detail(&self, artifact_id: &str) -> LearningPolicyResult<CandidateDetail> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new("learning_storage_error", "Learning store lock is poisoned.")
        })?;
        let artifact_id = require_token(Some(artifact_id), "artifactId")?;
        let state = self.read_state()?;
        let record = find_artifact_record(&state, &artifact_id)?;
        Ok(candidate_detail(record))
    }

    pub fn get_card_reminder(
        &self,
        project_scope_token: &str,
        feature_tokens: &[String],
    ) -> LearningPolicyResult<Option<Value>> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new("learning_storage_error", "Learning store lock is poisoned.")
        })?;
        let project_scope_token = require_token(Some(project_scope_token), "projectScopeToken")?;
        let feature_value =
            Value::Array(feature_tokens.iter().cloned().map(Value::String).collect());
        let feature_tokens = token_array(Some(&feature_value), "featureTokens", 1, 64)?;
        let Some(fingerprint) = self.fingerprint(&project_scope_token, &feature_tokens, false)?
        else {
            return Ok(None);
        };
        let state = self.read_state()?;
        Ok(state
            .artifacts
            .iter()
            .find(|record| {
                record.origin_project_scope_token == project_scope_token
                    && record.fingerprint_value_token == fingerprint
                    && record.artifact["status"] == "pending_review"
                    && record.artifact["review"]["ignoredCount"]
                        .as_u64()
                        .unwrap_or_default()
                        < 3
            })
            .map(|record| {
                json!({
                    "artifactId": record.artifact["artifactId"],
                    "artifactType": record.artifact["artifactType"],
                    "projectScopeToken": project_scope_token,
                    "reminderToken": "reusable_experience_found"
                })
            }))
    }

    pub fn ignore_candidate(&self, artifact_id: &str) -> LearningPolicyResult<Value> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new("learning_storage_error", "Learning store lock is poisoned.")
        })?;
        let artifact_id = require_token(Some(artifact_id), "artifactId")?;
        let mut state = self.read_state()?;
        let index = find_artifact_index(&state, &artifact_id)?;
        if state.artifacts[index].artifact["status"] != "pending_review" {
            return Err(LearningPolicyError::new(
                "candidate_not_pending",
                "Only pending candidates can receive reminder ignores.",
            ));
        }
        let current = state.artifacts[index].artifact["review"]["ignoredCount"]
            .as_u64()
            .unwrap_or_default();
        state.artifacts[index].artifact["review"]["ignoredCount"] =
            Value::from((current + 1).min(3));
        state.artifacts[index].artifact["updatedAt"] = Value::String(self.now()?);
        validate_contract("learning_artifact", &state.artifacts[index].artifact)?;
        let output = state.artifacts[index].artifact.clone();
        self.persist_state(&state)?;
        Ok(output)
    }

    pub fn set_skill_gates(
        &self,
        artifact_id: &str,
        gates: &Value,
    ) -> LearningPolicyResult<CandidateDetail> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new("learning_storage_error", "Learning store lock is poisoned.")
        })?;
        assert_privacy_safe_input(gates)?;
        let artifact_id = require_token(Some(artifact_id), "artifactId")?;
        let mut state = self.read_state()?;
        let index = find_artifact_index(&state, &artifact_id)?;
        let record = &mut state.artifacts[index];
        if record.artifact["artifactType"] != "skill" {
            return Err(LearningPolicyError::new(
                "artifact_not_skill",
                "Skill gates only apply to Skill artifacts.",
            ));
        }
        if record.artifact["status"] != "pending_review" {
            return Err(LearningPolicyError::new(
                "candidate_not_pending",
                "Only pending Skill candidates can update gates.",
            ));
        }
        let normalized = SkillGates::from_value(Some(gates), &record.artifact["payload"])?;
        record.artifact["payload"] = with_skill_gates(&record.artifact["payload"], &normalized)?;
        record.skill_gates = Some(normalized);
        record.artifact["updatedAt"] = Value::String(self.now()?);
        validate_contract("learning_artifact", &record.artifact)?;
        let detail = candidate_detail(record);
        self.persist_state(&state)?;
        Ok(detail)
    }

    pub fn review_candidate(
        &self,
        artifact_id: &str,
        decision: &Value,
    ) -> LearningPolicyResult<Value> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new("learning_storage_error", "Learning store lock is poisoned.")
        })?;
        assert_privacy_safe_input(decision)?;
        let artifact_id = require_token(Some(artifact_id), "artifactId")?;
        let decision = decision.as_object().ok_or_else(|| {
            LearningPolicyError::new(
                "invalid_review_action",
                "Review decision must be an object.",
            )
        })?;
        let action = decision
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let mut state = self.read_state()?;
        let index = find_artifact_index(&state, &artifact_id)?;
        if state.artifacts[index].artifact["status"] != "pending_review" {
            return Err(LearningPolicyError::new(
                "candidate_not_pending",
                "Only pending candidates can be reviewed.",
            ));
        }
        let timestamp = self.now()?;
        let project = state.artifacts[index].origin_project_scope_token.clone();
        match action {
            "edit" => {
                let payload = decision.get("payload").ok_or_else(|| {
                    LearningPolicyError::new("invalid_review_action", "Edited payload is required.")
                })?;
                let artifact_type = state.artifacts[index].artifact["artifactType"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string();
                let gates_value = state.artifacts[index]
                    .skill_gates
                    .as_ref()
                    .map(SkillGates::as_json);
                let (payload, gates) = self.validate_artifact_payload(
                    &artifact_type,
                    payload,
                    &project,
                    &timestamp,
                    gates_value.as_ref(),
                )?;
                state.artifacts[index].artifact["payload"] = payload;
                state.artifacts[index].skill_gates = gates;
            }
            "reclassify" => {
                let artifact_type = require_token(
                    decision.get("artifactType").and_then(Value::as_str),
                    "artifactType",
                )?;
                let payload = decision.get("payload").ok_or_else(|| {
                    LearningPolicyError::new(
                        "invalid_review_action",
                        "Reclassified payload is required.",
                    )
                })?;
                let (payload, gates) = self.validate_artifact_payload(
                    &artifact_type,
                    payload,
                    &project,
                    &timestamp,
                    decision.get("skillGates"),
                )?;
                state.artifacts[index].artifact["artifactType"] =
                    Value::String(artifact_type.clone());
                state.artifacts[index].artifact["payload"] = payload;
                state.artifacts[index].artifact["permissions"] =
                    permissions_for_type(&artifact_type);
                state.artifacts[index].skill_gates = gates;
            }
            "narrow_scope" => {
                state.artifacts[index].narrow_scope_tokens =
                    token_array(decision.get("scopeTokens"), "scopeTokens", 1, 16)?;
            }
            "accept" => {
                if state.artifacts[index].artifact["artifactType"] == "skill"
                    && !state.artifacts[index]
                        .skill_gates
                        .as_ref()
                        .map(SkillGates::all_passed)
                        .unwrap_or(false)
                {
                    return Err(LearningPolicyError::new(
                        "skill_gates_required",
                        "Skill acceptance requires permission, isolation, static, and adversarial gates.",
                    ));
                }
                state.artifacts[index].artifact["status"] = Value::String("active".to_string());
                state.artifacts[index].artifact["autoCreated"] = Value::Bool(false);
                state.artifacts[index].artifact["effective"] = Value::Bool(true);
                state.artifacts[index].artifact["review"]["required"] = Value::Bool(false);
                state.artifacts[index].artifact["review"]["decision"] =
                    Value::String("accepted".to_string());
            }
            "reject" => {
                state.artifacts[index].artifact["status"] = Value::String("rejected".to_string());
                state.artifacts[index].artifact["autoCreated"] = Value::Bool(false);
                state.artifacts[index].artifact["effective"] = Value::Bool(false);
                state.artifacts[index].artifact["review"]["required"] = Value::Bool(false);
                state.artifacts[index].artifact["review"]["decision"] =
                    Value::String("rejected".to_string());
            }
            _ => {
                return Err(LearningPolicyError::new(
                    "invalid_review_action",
                    "Review action must be accept, edit, reclassify, narrow_scope, or reject.",
                ));
            }
        }
        state.artifacts[index].artifact["updatedAt"] = Value::String(timestamp);
        validate_contract("learning_artifact", &state.artifacts[index].artifact)?;
        let output = state.artifacts[index].artifact.clone();
        self.persist_state(&state)?;
        Ok(output)
    }

    pub fn record_promotion_evidence(
        &self,
        input: &Value,
    ) -> LearningPolicyResult<PromotionResult> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new("learning_storage_error", "Learning store lock is poisoned.")
        })?;
        assert_privacy_safe_input(input)?;
        let object = input.as_object().ok_or_else(|| {
            LearningPolicyError::new(
                "invalid_learning_input",
                "Promotion evidence input must be an object.",
            )
        })?;
        let artifact_type = require_token(
            object.get("artifactType").and_then(Value::as_str),
            "artifactType",
        )?;
        if !matches!(artifact_type.as_str(), "memory" | "rule" | "skill") {
            return Err(LearningPolicyError::new(
                "global_promotion_not_supported",
                "Global v1 proposals are limited to Memory, Rule, and gated Skill artifacts.",
            ));
        }
        let promotion_key_token = require_token(
            object.get("promotionKeyToken").and_then(Value::as_str),
            "promotionKeyToken",
        )?;
        let project_scope_token = require_token(
            object.get("projectScopeToken").and_then(Value::as_str),
            "projectScopeToken",
        )?;
        let session_id =
            require_token(object.get("sessionId").and_then(Value::as_str), "sessionId")?;
        let outcome_id =
            require_token(object.get("outcomeId").and_then(Value::as_str), "outcomeId")?;
        let timestamp = match object.get("createdAt").and_then(Value::as_str) {
            Some(value) => canonical_timestamp(value)?,
            None => self.now()?,
        };
        let payload_input = object.get("payload").ok_or_else(|| {
            LearningPolicyError::new("invalid_learning_input", "Promotion payload is required.")
        })?;
        let (payload, skill_gates) = self.validate_artifact_payload(
            &artifact_type,
            payload_input,
            &project_scope_token,
            &timestamp,
            object.get("skillGates"),
        )?;
        let mut state = self.read_state()?;
        if let Some(duplicate) = state
            .promotion_evidence
            .iter()
            .find(|item| {
                item.artifact_type == artifact_type
                    && item.promotion_key_token == promotion_key_token
                    && item.project_scope_token == project_scope_token
                    && item.outcome_id == outcome_id
            })
            .cloned()
        {
            let proposal =
                reconcile_proposal(&mut state, &artifact_type, &promotion_key_token, &timestamp)?;
            return Ok(PromotionResult {
                evidence: serde_json::to_value(duplicate).expect("promotion evidence serializes"),
                proposal,
                duplicate: true,
            });
        }
        let evidence = PromotionEvidence {
            evidence_id: create_id("promotion_evidence"),
            promotion_key_token: promotion_key_token.clone(),
            project_scope_token,
            session_id,
            outcome_id,
            artifact_type: artifact_type.clone(),
            payload,
            skill_gates,
            succeeded: object
                .get("succeeded")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            explicit_negative_feedback: object
                .get("explicitNegativeFeedback")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            valid: true,
            created_at: timestamp.clone(),
        };
        state.promotion_evidence.push(evidence.clone());
        let proposal =
            reconcile_proposal(&mut state, &artifact_type, &promotion_key_token, &timestamp)?;
        self.persist_state(&state)?;
        Ok(PromotionResult {
            evidence: serde_json::to_value(evidence).expect("promotion evidence serializes"),
            proposal,
            duplicate: false,
        })
    }

    pub fn list_global_proposals(&self) -> LearningPolicyResult<Vec<Value>> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new("learning_storage_error", "Learning store lock is poisoned.")
        })?;
        Ok(self
            .read_state()?
            .proposals
            .into_iter()
            .map(|proposal| serde_json::to_value(proposal).expect("proposal serializes"))
            .collect())
    }

    pub fn confirm_global_proposal(
        &self,
        proposal_id: &str,
        confirmed: bool,
    ) -> LearningPolicyResult<Value> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new("learning_storage_error", "Learning store lock is poisoned.")
        })?;
        let proposal_id = require_token(Some(proposal_id), "proposalId")?;
        if !confirmed {
            return Err(LearningPolicyError::new(
                "final_confirmation_required",
                "A global artifact requires explicit final user confirmation.",
            ));
        }
        let mut state = self.read_state()?;
        let index = state
            .proposals
            .iter()
            .position(|proposal| proposal.proposal_id == proposal_id)
            .ok_or_else(|| {
                LearningPolicyError::new(
                    "global_proposal_not_found",
                    "The global proposal does not exist.",
                )
            })?;
        if state.proposals[index].status != "pending_final_confirmation" {
            return Err(LearningPolicyError::new(
                "global_proposal_not_pending",
                "Only a valid pending global proposal can be confirmed.",
            ));
        }
        let summary = summarize_promotion(
            &state,
            &state.proposals[index].artifact_type,
            &state.proposals[index].promotion_key_token,
        );
        if !summary.qualifies {
            return Err(LearningPolicyError::new(
                "global_promotion_threshold_not_met",
                "The global proposal no longer has sufficient valid evidence.",
            ));
        }
        if state.proposals[index].artifact_type == "skill"
            && !summary
                .skill_gates
                .as_ref()
                .map(SkillGates::all_passed)
                .unwrap_or(false)
        {
            return Err(LearningPolicyError::new(
                "skill_gates_required",
                "Global Skill confirmation requires permission, isolation, static, and adversarial gates.",
            ));
        }
        let timestamp = self.now()?;
        let proposal = &mut state.proposals[index];
        proposal.artifact["scope"] = json!({ "kind": "global", "projectScopeToken": null });
        proposal.artifact["status"] = Value::String("active".to_string());
        proposal.artifact["autoCreated"] = Value::Bool(false);
        proposal.artifact["effective"] = Value::Bool(true);
        proposal.artifact["review"]["required"] = Value::Bool(false);
        proposal.artifact["review"]["decision"] = Value::String("accepted".to_string());
        proposal.artifact["updatedAt"] = Value::String(timestamp.clone());
        validate_contract("learning_artifact", &proposal.artifact)?;
        proposal.status = "confirmed".to_string();
        proposal.effective = true;
        proposal.confirmed_at = Some(timestamp.clone());
        proposal.updated_at = timestamp;
        let output = proposal.artifact.clone();
        self.persist_state(&state)?;
        Ok(output)
    }

    pub fn clear_project(
        &self,
        project_scope_token: &str,
    ) -> LearningPolicyResult<ClearProjectResult> {
        self.clear_project_data(project_scope_token)
    }

    pub fn clear_project_data(
        &self,
        project_scope_token: &str,
    ) -> LearningPolicyResult<ClearProjectResult> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new("learning_storage_error", "Learning store lock is poisoned.")
        })?;
        let project_scope_token = require_token(Some(project_scope_token), "projectScopeToken")?;
        let mut state = self.read_state()?;
        let timestamp = self.now()?;
        let archive_token = create_id("archive");
        let archive_dir = self.archive_root.join(&archive_token);

        let selected_observations = state
            .observations
            .iter()
            .filter(|item| item.project_scope_token == project_scope_token)
            .cloned()
            .collect::<Vec<_>>();
        let selected_candidate_evidence = state
            .candidate_evidence
            .iter()
            .filter(|item| item.project_scope_token == project_scope_token)
            .cloned()
            .collect::<Vec<_>>();
        let selected_artifacts = state
            .artifacts
            .iter()
            .filter(|item| item.origin_project_scope_token == project_scope_token)
            .cloned()
            .collect::<Vec<_>>();
        let selected_promotion_evidence = state
            .promotion_evidence
            .iter()
            .filter(|item| item.project_scope_token == project_scope_token)
            .cloned()
            .collect::<Vec<_>>();
        let selected_promotion_ids = selected_promotion_evidence
            .iter()
            .map(|item| item.evidence_id.clone())
            .collect::<HashSet<_>>();
        let affected_indices = state
            .proposals
            .iter()
            .enumerate()
            .filter(|(_, proposal)| {
                proposal.project_scope_tokens.contains(&project_scope_token)
                    || proposal
                        .evidence_ids
                        .iter()
                        .any(|id| selected_promotion_ids.contains(id))
            })
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        let affected_proposals = affected_indices
            .iter()
            .map(|index| state.proposals[*index].clone())
            .collect::<Vec<_>>();

        let policy_archive =
            invalidate_project_policy_registry(&self.root, &project_scope_token, &timestamp)?;
        let archived_observations = selected_observations
            .iter()
            .map(|entry| archived_observation(entry, &timestamp))
            .collect::<LearningPolicyResult<Vec<_>>>()?;
        let archived_artifacts = selected_artifacts
            .iter()
            .map(|record| archived_artifact(record, &timestamp))
            .collect::<LearningPolicyResult<Vec<_>>>()?;
        let archive = json!({
            "schemaVersion": LEARNING_ARCHIVE_SCHEMA_VERSION,
            "archiveToken": archive_token,
            "projectScopeToken": project_scope_token,
            "invalidatedAt": timestamp,
            "keyArchived": self.key_path(&project_scope_token).exists(),
            "observations": archived_observations,
            "candidateEvidence": selected_candidate_evidence.iter().map(|entry| invalidated_value(entry, &timestamp)).collect::<Vec<_>>(),
            "artifacts": archived_artifacts,
            "promotionEvidence": selected_promotion_evidence.iter().map(|entry| invalidated_value(entry, &timestamp)).collect::<Vec<_>>(),
            "proposals": affected_proposals.iter().map(|entry| invalidated_value(entry, &timestamp)).collect::<Vec<_>>(),
            "policyRegistryEvidence": policy_archive
        });
        write_json(&archive_dir.join("learning-data.json"), &archive)?;

        let key_file = self.key_path(&project_scope_token);
        let key_archived = if key_file.exists() {
            fs::create_dir_all(&archive_dir).map_err(|error| {
                io_error("learning_storage_error", "create learning archive", error)
            })?;
            fs::rename(&key_file, archive_dir.join("project-hmac.key")).map_err(|error| {
                io_error("learning_storage_error", "archive project HMAC key", error)
            })?;
            true
        } else {
            false
        };

        state
            .observations
            .retain(|item| item.project_scope_token != project_scope_token);
        state
            .candidate_evidence
            .retain(|item| item.project_scope_token != project_scope_token);
        state
            .artifacts
            .retain(|item| item.origin_project_scope_token != project_scope_token);
        state
            .promotion_evidence
            .retain(|item| item.project_scope_token != project_scope_token);
        for index in affected_indices {
            archive_proposal(&mut state.proposals[index], &timestamp)?;
        }
        let counts = ClearProjectCounts {
            observations: selected_observations.len(),
            candidate_evidence: selected_candidate_evidence.len(),
            artifacts: selected_artifacts.len(),
            promotion_evidence: selected_promotion_evidence.len(),
            proposals: affected_proposals.len(),
            policies: policy_archive.policies.len(),
            rollouts: policy_archive.rollouts.len(),
        };
        state.invalidations.push(InvalidationRecord {
            invalidation_id: create_id("invalidation"),
            archive_token: archive_token.clone(),
            project_scope_token: project_scope_token.clone(),
            invalidated_at: timestamp.clone(),
            observation_count: counts.observations,
            artifact_count: counts.artifacts,
            promotion_evidence_count: counts.promotion_evidence,
            proposal_count: counts.proposals,
            policy_count: counts.policies,
            rollout_count: counts.rollouts,
        });
        self.persist_state(&state)?;
        Ok(ClearProjectResult {
            project_scope_token,
            archive_token,
            archive_dir,
            invalidated_at: timestamp,
            key_archived,
            counts,
        })
    }

    pub fn get_invalidations(&self) -> LearningPolicyResult<Vec<Value>> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new("learning_storage_error", "Learning store lock is poisoned.")
        })?;
        Ok(self
            .read_state()?
            .invalidations
            .into_iter()
            .map(|item| serde_json::to_value(item).expect("invalidation serializes"))
            .collect())
    }
}

pub fn create_learning_artifact_store(
    root: impl AsRef<Path>,
) -> LearningPolicyResult<LearningPolicyStore> {
    LearningPolicyStore::open(root)
}

fn permissions_for_type(artifact_type: &str) -> Value {
    json!({
        "execution": if artifact_type == "skill" { "review_required" } else { "none" },
        "scopeExpansion": "user_confirmation_required"
    })
}

fn with_skill_gates(payload: &Value, gates: &SkillGates) -> LearningPolicyResult<Value> {
    let mut object = payload.as_object().cloned().ok_or_else(|| {
        LearningPolicyError::new(
            "invalid_artifact_payload",
            "Skill payload must be an object.",
        )
    })?;
    if object.get("scriptsExecutable").and_then(Value::as_bool) != Some(false) {
        return Err(LearningPolicyError::new(
            "skill_scripts_not_executable",
            "Generated Skill scripts must remain non-executable.",
        ));
    }
    object.insert("scriptsExecutable".to_string(), Value::Bool(false));
    object.insert(
        "permissionCheckPassed".to_string(),
        Value::Bool(gates.permission),
    );
    object.insert(
        "isolationTestPassed".to_string(),
        Value::Bool(gates.isolation),
    );
    object.insert(
        "adversarialReviewPassed".to_string(),
        Value::Bool(gates.adversarial),
    );
    Ok(Value::Object(object))
}

#[allow(clippy::too_many_arguments)]
fn learning_artifact_value(
    artifact_id: &str,
    artifact_type: &str,
    status: &str,
    scope_kind: &str,
    project_scope_token: Option<&str>,
    payload: Value,
    evidence_summary: Value,
    auto_created: bool,
    effective: bool,
    review_decision: &str,
    ignored_count: u64,
    timestamp: &str,
) -> Value {
    json!({
        "contractVersion": LEARNING_ARTIFACT_VERSION,
        "artifactId": artifact_id,
        "artifactType": artifact_type,
        "status": status,
        "scope": {
            "kind": scope_kind,
            "projectScopeToken": project_scope_token
        },
        "payload": payload,
        "evidenceSummary": evidence_summary,
        "permissions": permissions_for_type(artifact_type),
        "review": {
            "required": review_decision == "pending",
            "decision": review_decision,
            "ignoredCount": ignored_count
        },
        "autoCreated": auto_created,
        "effective": effective,
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "privacyFlags": privacy_flags()
    })
}

fn map_task_outcome(object: &Map<String, Value>) -> String {
    if let Some(value) = object.get("taskOutcomeToken").and_then(Value::as_str) {
        return value.to_string();
    }
    match object.get("outcomeStatus").and_then(Value::as_str) {
        Some("succeeded") => "completed",
        Some("failed") => "not_completed",
        Some("expired_unknown") => "expired_unknown",
        Some("invalidated") => "invalidated",
        _ => "unknown",
    }
    .to_string()
}

fn build_observation(
    object: &Map<String, Value>,
    fingerprint_value_token: &str,
    timestamp: &str,
) -> LearningPolicyResult<Value> {
    let context_source_tokens = object
        .get("contextSourceTokens")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let failure_reason_tokens = object
        .get("failureReasonTokens")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let edit = object.get("editFeatureSummary").and_then(Value::as_object);
    let mut observation = json!({
        "contractVersion": LEARNING_OBSERVATION_VERSION,
        "observationId": object.get("observationId").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| create_id("observation")),
        "projectScopeToken": object.get("projectScopeToken").and_then(Value::as_str).unwrap_or_default(),
        "taskScenarioToken": object.get("taskScenarioToken").and_then(Value::as_str).unwrap_or("unknown_scenario"),
        "modeToken": object.get("modeToken").and_then(Value::as_str).unwrap_or("standard"),
        "strategyId": object.get("strategyId").and_then(Value::as_str).unwrap_or("baseline"),
        "strategyVersion": object.get("strategyVersion").and_then(Value::as_str).unwrap_or("v1"),
        "modelFamilyToken": object.get("modelFamilyToken").and_then(Value::as_str).unwrap_or("unknown_model"),
        "contextSourceTokens": context_source_tokens,
        "editFeatureSummary": {
            "userEdited": edit.and_then(|value| value.get("userEdited")).and_then(Value::as_bool).unwrap_or(false),
            "lengthDeltaBucket": edit.and_then(|value| value.get("lengthDeltaBucket")).and_then(Value::as_str).unwrap_or("none"),
            "structureChanged": edit.and_then(|value| value.get("structureChanged")).and_then(Value::as_bool).unwrap_or(false)
        },
        "insertVerified": object.get("insertVerified").and_then(Value::as_bool).unwrap_or(false),
        "retryCount": object.get("retryCount").cloned().unwrap_or(Value::from(0)),
        "undoUsed": object.get("undoUsed").and_then(Value::as_bool).unwrap_or(false),
        "taskOutcomeToken": map_task_outcome(object),
        "failureReasonTokens": failure_reason_tokens,
        "inputTokens": null,
        "outputTokens": null,
        "cachedTokens": null,
        "reasoningTokens": null,
        "insertedPromptTokenEstimate": null,
        "latencyMs": object.get("latencyMs").cloned().unwrap_or(Value::from(0)),
        "tokenAccountingSource": object.get("tokenAccountingSource").and_then(Value::as_str).unwrap_or("unavailable"),
        "semanticFingerprint": {
            "kind": "keyed_feature_hash",
            "projectScoped": true,
            "algorithm": "hmac_sha256",
            "valueToken": fingerprint_value_token,
            "encryptedAtRest": false,
            "exportable": false,
            "absoluteIrreversibilityClaimed": false,
            "inversionRiskTested": false,
            "membershipInferenceRiskTested": false,
            "residualRisk": "unknown"
        },
        "privacyFlags": privacy_flags(),
        "createdAt": timestamp
    });
    for field in [
        "inputTokens",
        "outputTokens",
        "cachedTokens",
        "reasoningTokens",
        "insertedPromptTokenEstimate",
    ] {
        if let Some(value) = object.get(field) {
            observation[field] = value.clone();
        }
    }
    validate_contract("learning_observation", &observation)?;
    Ok(observation)
}

fn find_artifact_index(state: &LearningState, artifact_id: &str) -> LearningPolicyResult<usize> {
    state
        .artifacts
        .iter()
        .position(|record| record.artifact["artifactId"].as_str() == Some(artifact_id))
        .ok_or_else(|| {
            LearningPolicyError::new(
                "learning_artifact_not_found",
                "The learning artifact does not exist or is no longer active.",
            )
        })
}

fn find_artifact_record<'a>(
    state: &'a LearningState,
    artifact_id: &str,
) -> LearningPolicyResult<&'a ArtifactRecord> {
    let index = find_artifact_index(state, artifact_id)?;
    Ok(&state.artifacts[index])
}

fn candidate_detail(record: &ArtifactRecord) -> CandidateDetail {
    CandidateDetail {
        artifact: record.artifact.clone(),
        narrow_scope_tokens: record.narrow_scope_tokens.clone(),
        skill_gates: record.skill_gates.as_ref().map(SkillGates::as_json),
        card_reminder_enabled: record.artifact["status"] == "pending_review"
            && record.artifact["review"]["ignoredCount"]
                .as_u64()
                .unwrap_or_default()
                < 3,
    }
}

fn maybe_create_candidate(
    state: &mut LearningState,
    evidence: &CandidateEvidence,
    timestamp: &str,
) -> LearningPolicyResult<Option<Value>> {
    let pattern_group = state
        .candidate_evidence
        .iter()
        .filter(|item| {
            item.valid
                && item.project_scope_token == evidence.project_scope_token
                && item.fingerprint_value_token == evidence.fingerprint_value_token
                && item.artifact_type == evidence.artifact_type
        })
        .cloned()
        .collect::<Vec<_>>();
    let payload_token = canonical_json(&evidence.payload);
    let group = pattern_group
        .iter()
        .filter(|item| canonical_json(&item.payload) == payload_token)
        .cloned()
        .collect::<Vec<_>>();
    let successes = group
        .iter()
        .filter(|item| item.task_outcome_token == "completed")
        .cloned()
        .collect::<Vec<_>>();
    let sessions = successes
        .iter()
        .map(|item| item.session_id.clone())
        .collect::<BTreeSet<_>>();
    let pattern_successes = pattern_group
        .iter()
        .filter(|item| item.task_outcome_token == "completed")
        .collect::<Vec<_>>();
    let pattern_sessions = pattern_successes
        .iter()
        .map(|item| item.session_id.clone())
        .collect::<BTreeSet<_>>();
    let explicit_negatives = pattern_group
        .iter()
        .filter(|item| item.explicit_negative_feedback)
        .count();
    let existing_index = state.artifacts.iter().position(|record| {
        record.origin_project_scope_token == evidence.project_scope_token
            && record.fingerprint_value_token == evidence.fingerprint_value_token
            && record.source_artifact_type == evidence.artifact_type
    });
    if explicit_negatives > 0 {
        if let Some(index) = existing_index {
            if state.artifacts[index].artifact["status"] == "pending_review" {
                let record = &mut state.artifacts[index];
                record.artifact["status"] = Value::String("archived".to_string());
                record.artifact["autoCreated"] = Value::Bool(false);
                record.artifact["effective"] = Value::Bool(false);
                record.artifact["evidenceSummary"] = json!({
                    "sessionCount": pattern_sessions.len(),
                    "successfulOutcomeCount": pattern_successes.len(),
                    "explicitNegativeFeedbackCount": explicit_negatives,
                    "evidenceTokenCount": pattern_group.len()
                });
                record.artifact["review"]["required"] = Value::Bool(false);
                record.artifact["review"]["decision"] = Value::String("rejected".to_string());
                record.artifact["updatedAt"] = Value::String(timestamp.to_string());
                validate_contract("learning_artifact", &record.artifact)?;
            }
        }
        return Ok(None);
    }
    if sessions.len() < 2 || successes.len() < 3 || existing_index.is_some() {
        return Ok(None);
    }
    let gates = if evidence.artifact_type == "skill" {
        Some(SkillGates {
            permission: successes
                .iter()
                .all(|item| item.skill_gates.as_ref().map(|gates| gates.permission) == Some(true)),
            isolation: successes
                .iter()
                .all(|item| item.skill_gates.as_ref().map(|gates| gates.isolation) == Some(true)),
            static_check: successes.iter().all(|item| {
                item.skill_gates.as_ref().map(|gates| gates.static_check) == Some(true)
            }),
            adversarial: successes
                .iter()
                .all(|item| item.skill_gates.as_ref().map(|gates| gates.adversarial) == Some(true)),
        })
    } else {
        None
    };
    let payload = if let Some(gates) = &gates {
        with_skill_gates(&evidence.payload, gates)?
    } else {
        evidence.payload.clone()
    };
    let artifact = learning_artifact_value(
        &create_id("artifact"),
        &evidence.artifact_type,
        "pending_review",
        "project",
        Some(&evidence.project_scope_token),
        payload,
        json!({
            "sessionCount": sessions.len(),
            "successfulOutcomeCount": successes.len(),
            "explicitNegativeFeedbackCount": 0,
            "evidenceTokenCount": pattern_group.len()
        }),
        true,
        false,
        "pending",
        0,
        timestamp,
    );
    validate_contract("learning_artifact", &artifact)?;
    state.artifacts.push(ArtifactRecord {
        artifact: artifact.clone(),
        origin_project_scope_token: evidence.project_scope_token.clone(),
        fingerprint_value_token: evidence.fingerprint_value_token.clone(),
        source_artifact_type: evidence.artifact_type.clone(),
        narrow_scope_tokens: Vec::new(),
        skill_gates: gates,
    });
    Ok(Some(artifact))
}

struct PromotionSummary {
    evidence: Vec<PromotionEvidence>,
    successes: Vec<PromotionEvidence>,
    negatives: Vec<PromotionEvidence>,
    project_scope_tokens: Vec<String>,
    session_count: usize,
    skill_gates: Option<SkillGates>,
    qualifies: bool,
}

fn summarize_promotion(
    state: &LearningState,
    artifact_type: &str,
    promotion_key_token: &str,
) -> PromotionSummary {
    let evidence = state
        .promotion_evidence
        .iter()
        .filter(|item| {
            item.valid
                && item.artifact_type == artifact_type
                && item.promotion_key_token == promotion_key_token
        })
        .cloned()
        .collect::<Vec<_>>();
    let successes = evidence
        .iter()
        .filter(|item| item.succeeded)
        .cloned()
        .collect::<Vec<_>>();
    let negatives = evidence
        .iter()
        .filter(|item| item.explicit_negative_feedback)
        .cloned()
        .collect::<Vec<_>>();
    let project_scope_tokens = successes
        .iter()
        .map(|item| item.project_scope_token.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let session_count = successes
        .iter()
        .map(|item| format!("{}:{}", item.project_scope_token, item.session_id))
        .collect::<BTreeSet<_>>()
        .len();
    let one_payload = successes
        .iter()
        .map(|item| canonical_json(&item.payload))
        .collect::<BTreeSet<_>>()
        .len()
        <= 1;
    let skill_gates = if artifact_type == "skill" {
        Some(SkillGates {
            permission: !successes.is_empty()
                && successes.iter().all(|item| {
                    item.skill_gates.as_ref().map(|gates| gates.permission) == Some(true)
                }),
            isolation: !successes.is_empty()
                && successes.iter().all(|item| {
                    item.skill_gates.as_ref().map(|gates| gates.isolation) == Some(true)
                }),
            static_check: !successes.is_empty()
                && successes.iter().all(|item| {
                    item.skill_gates.as_ref().map(|gates| gates.static_check) == Some(true)
                }),
            adversarial: !successes.is_empty()
                && successes.iter().all(|item| {
                    item.skill_gates.as_ref().map(|gates| gates.adversarial) == Some(true)
                }),
        })
    } else {
        None
    };
    let qualifies = negatives.is_empty()
        && one_payload
        && match artifact_type {
            "memory" | "rule" => project_scope_tokens.len() >= 3 && successes.len() >= 5,
            "skill" => {
                project_scope_tokens.len() >= 3
                    && skill_gates
                        .as_ref()
                        .map(SkillGates::all_passed)
                        .unwrap_or(false)
            }
            _ => false,
        };
    PromotionSummary {
        evidence,
        successes,
        negatives,
        project_scope_tokens,
        session_count,
        skill_gates,
        qualifies,
    }
}

fn reconcile_proposal(
    state: &mut LearningState,
    artifact_type: &str,
    promotion_key_token: &str,
    timestamp: &str,
) -> LearningPolicyResult<Option<Value>> {
    let summary = summarize_promotion(state, artifact_type, promotion_key_token);
    let current_index = state.proposals.iter().rposition(|proposal| {
        proposal.artifact_type == artifact_type
            && proposal.promotion_key_token == promotion_key_token
            && matches!(
                proposal.status.as_str(),
                "pending_final_confirmation" | "confirmed"
            )
    });
    if !summary.qualifies {
        if !summary.negatives.is_empty() {
            if let Some(index) = current_index {
                archive_proposal(&mut state.proposals[index], timestamp)?;
            }
        }
        return Ok(None);
    }
    if let Some(index) = current_index {
        return Ok(Some(
            serde_json::to_value(&state.proposals[index]).expect("proposal serializes"),
        ));
    }
    let first = summary
        .successes
        .first()
        .expect("qualified promotion has successes");
    let payload = if let Some(gates) = &summary.skill_gates {
        with_skill_gates(&first.payload, gates)?
    } else {
        first.payload.clone()
    };
    let artifact = learning_artifact_value(
        &create_id("global_proposal_artifact"),
        artifact_type,
        "pending_review",
        "global_proposal",
        Some(promotion_key_token),
        payload,
        json!({
            "sessionCount": summary.session_count,
            "successfulOutcomeCount": summary.successes.len(),
            "explicitNegativeFeedbackCount": 0,
            "evidenceTokenCount": summary.evidence.len()
        }),
        false,
        false,
        "pending",
        0,
        timestamp,
    );
    validate_contract("learning_artifact", &artifact)?;
    let proposal = GlobalProposal {
        proposal_id: create_id("global_proposal"),
        promotion_key_token: promotion_key_token.to_string(),
        artifact_type: artifact_type.to_string(),
        artifact,
        evidence_ids: summary
            .evidence
            .iter()
            .map(|item| item.evidence_id.clone())
            .collect(),
        project_scope_tokens: summary.project_scope_tokens,
        successful_outcome_count: summary.successes.len() as u64,
        explicit_negative_feedback_count: 0,
        skill_gates: summary.skill_gates,
        status: "pending_final_confirmation".to_string(),
        system_created: true,
        final_confirmation_required: true,
        effective: false,
        created_at: timestamp.to_string(),
        updated_at: timestamp.to_string(),
        confirmed_at: None,
        invalidated_at: None,
    };
    let output = serde_json::to_value(&proposal).expect("proposal serializes");
    state.proposals.push(proposal);
    Ok(Some(output))
}

fn archive_proposal(proposal: &mut GlobalProposal, timestamp: &str) -> LearningPolicyResult<()> {
    proposal.status = "invalidated".to_string();
    proposal.effective = false;
    proposal.invalidated_at = Some(timestamp.to_string());
    proposal.updated_at = timestamp.to_string();
    proposal.artifact["status"] = Value::String("archived".to_string());
    proposal.artifact["autoCreated"] = Value::Bool(false);
    proposal.artifact["effective"] = Value::Bool(false);
    proposal.artifact["updatedAt"] = Value::String(timestamp.to_string());
    validate_contract("learning_artifact", &proposal.artifact)
}

fn archived_observation(entry: &ObservationRecord, timestamp: &str) -> LearningPolicyResult<Value> {
    let mut observation = entry.observation.clone();
    observation["taskOutcomeToken"] = Value::String("invalidated".to_string());
    observation["failureReasonTokens"] = json!([]);
    validate_contract("learning_observation", &observation)?;
    Ok(json!({
        "observation": observation,
        "projectScopeToken": entry.project_scope_token,
        "sessionId": entry.session_id,
        "outcomeId": entry.outcome_id,
        "valid": false,
        "invalidated": true,
        "invalidatedAt": timestamp
    }))
}

fn archived_artifact(record: &ArtifactRecord, timestamp: &str) -> LearningPolicyResult<Value> {
    let mut artifact = record.artifact.clone();
    artifact["status"] = Value::String("archived".to_string());
    artifact["autoCreated"] = Value::Bool(false);
    artifact["effective"] = Value::Bool(false);
    artifact["updatedAt"] = Value::String(timestamp.to_string());
    validate_contract("learning_artifact", &artifact)?;
    Ok(json!({
        "artifact": artifact,
        "originProjectScopeToken": record.origin_project_scope_token,
        "fingerprintValueToken": record.fingerprint_value_token,
        "sourceArtifactType": record.source_artifact_type,
        "narrowScopeTokens": record.narrow_scope_tokens,
        "skillGates": record.skill_gates,
        "invalidated": true,
        "invalidatedAt": timestamp
    }))
}

fn invalidated_value<T: Serialize>(value: &T, timestamp: &str) -> Value {
    let mut value = serde_json::to_value(value).expect("archived values serialize");
    if let Value::Object(object) = &mut value {
        object.insert("valid".to_string(), Value::Bool(false));
        object.insert("invalidated".to_string(), Value::Bool(true));
        object.insert(
            "invalidatedAt".to_string(),
            Value::String(timestamp.to_string()),
        );
    }
    value
}

fn clamp_number(value: f64, minimum: f64, maximum: f64) -> f64 {
    value.max(minimum).min(maximum)
}

fn finite_number(value: Option<&Value>, fallback: f64) -> f64 {
    value
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .unwrap_or(fallback)
}

fn clamp_integer(value: Option<&Value>, minimum: u64, maximum: u64, fallback: u64) -> u64 {
    value
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .map(|value| value.trunc().max(minimum as f64).min(maximum as f64) as u64)
        .unwrap_or(fallback.max(minimum).min(maximum))
}

fn object_choice<'a>(values: &[Option<&'a Value>]) -> Option<&'a Map<String, Value>> {
    values
        .iter()
        .find_map(|value| value.and_then(Value::as_object))
}

fn array_choice<'a>(values: &[Option<&'a Value>]) -> &'a [Value] {
    values
        .iter()
        .find_map(|value| value.and_then(Value::as_array).map(Vec::as_slice))
        .unwrap_or(&[])
}

fn map_string<'a>(object: Option<&'a Map<String, Value>>, keys: &[&str]) -> Option<&'a str> {
    object.and_then(|object| {
        keys.iter()
            .find_map(|key| object.get(*key).and_then(Value::as_str))
    })
}

fn map_value<'a>(object: Option<&'a Map<String, Value>>, keys: &[&str]) -> Option<&'a Value> {
    object.and_then(|object| keys.iter().find_map(|key| object.get(*key)))
}

fn material_value(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::String(value)) => !value.is_empty(),
        Some(Value::Array(value)) => !value.is_empty(),
        Some(Value::Object(value)) => !value.is_empty(),
        Some(_) => true,
    }
}

fn normalize_policy_scope(value: Option<&Value>) -> LearningPolicyResult<Value> {
    let object = value.and_then(Value::as_object).ok_or_else(|| {
        LearningPolicyError::new(
            "invalid_policy_scope",
            "Generation Policy scope must be an object.",
        )
    })?;
    let kind = safe_token(object.get("kind").and_then(Value::as_str), "project");
    let target = safe_token(object.get("target").and_then(Value::as_str), "codex");
    if kind != "project" || target != "codex" {
        return Err(LearningPolicyError::new(
            "automatic_policy_scope_forbidden",
            "Generation Policy v1 is limited to project-scoped Codex policies.",
        ));
    }
    Ok(json!({
        "kind": kind,
        "target": target,
        "projectScopeToken": require_token(object.get("projectScopeToken").and_then(Value::as_str), "scope.projectScopeToken")?,
        "taskScenarioToken": require_token(
            object.get("taskScenarioToken").or_else(|| object.get("taskScenario")).and_then(Value::as_str),
            "scope.taskScenarioToken"
        )?,
        "modelFamilyToken": require_token(
            object.get("modelFamilyToken").or_else(|| object.get("modelFamily")).and_then(Value::as_str),
            "scope.modelFamilyToken"
        )?
    }))
}

fn scope_key(scope: &Value) -> String {
    [
        scope["kind"].as_str().unwrap_or_default(),
        scope["target"].as_str().unwrap_or_default(),
        scope["projectScopeToken"].as_str().unwrap_or_default(),
        scope["taskScenarioToken"].as_str().unwrap_or_default(),
        scope["modelFamilyToken"].as_str().unwrap_or_default(),
    ]
    .join("|")
}

fn same_scope(left: &Value, right: &Value) -> bool {
    let left = scope_key(left);
    left == scope_key(right) && !left.contains("||")
}

fn policy_identity(policy: &Value) -> String {
    format!(
        "{}@{}",
        policy["policyId"].as_str().unwrap_or_default(),
        policy["version"].as_u64().unwrap_or_default()
    )
}

fn hash_token(prefix: &str, value: &str) -> String {
    format!("{prefix}_{}", &sha256_hex(value)[..20])
}

fn assert_automatic_policy_boundary(
    source: &Map<String, Value>,
    signals: &Map<String, Value>,
) -> LearningPolicyResult<()> {
    let artifact_type = source
        .get("artifactType")
        .or_else(|| source.get("learningObjectType"))
        .or_else(|| signals.get("artifactType"))
        .or_else(|| signals.get("learningObjectType"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(artifact_type.as_str(), "memory" | "rule" | "skill") {
        return Err(LearningPolicyError::new(
            "automatic_policy_artifact_forbidden",
            "Memory, Rule, and Skill artifacts cannot be compiled into an automatic Generation Policy.",
        ));
    }
    for key in [
        "memory",
        "memories",
        "rule",
        "rules",
        "skill",
        "skills",
        "permissions",
        "permissionChange",
        "scopeExpansion",
        "crossProject",
    ] {
        if material_value(signals.get(key)) {
            return Err(LearningPolicyError::new(
                "automatic_policy_boundary_forbidden",
                "Knowledge, permission, and cross-project changes require an explicit review path.",
            ));
        }
    }
    Ok(())
}

struct SignalGroups<'a> {
    signals: &'a Map<String, Value>,
    strategy: Option<&'a Map<String, Value>>,
    quality: Option<&'a Map<String, Value>>,
    failure: Option<&'a Map<String, Value>>,
    self_improvement: Option<&'a Map<String, Value>>,
    evolution: Option<&'a Map<String, Value>>,
}

fn signal_groups(source: &Map<String, Value>) -> SignalGroups<'_> {
    let signals = source
        .get("signals")
        .and_then(Value::as_object)
        .unwrap_or(source);
    SignalGroups {
        signals,
        strategy: object_choice(&[
            signals.get("strategy"),
            signals.get("strategyPlan"),
            signals.get("promptStrategy"),
            signals.get("promptStrategyPlan"),
            signals.get("strategyInsights"),
        ]),
        quality: object_choice(&[
            signals.get("quality"),
            signals.get("qualityLift"),
            signals.get("promptQualityLiftReport"),
            signals.get("qualityReport"),
        ]),
        failure: object_choice(&[
            signals.get("failure"),
            signals.get("failureReason"),
            signals.get("failureReasonPolicy"),
            signals.get("failureReasonReport"),
        ]),
        self_improvement: object_choice(&[
            signals.get("selfImprovement"),
            signals.get("selfImprovementReport"),
        ]),
        evolution: object_choice(&[
            signals.get("evolution"),
            signals.get("evolutionCandidates"),
            signals.get("evolutionCandidateReport"),
        ]),
    }
}

fn selected_strategy(groups: &SignalGroups<'_>) -> Value {
    let selected = object_choice(&[
        groups
            .strategy
            .and_then(|value| value.get("selectedStrategy")),
        groups.signals.get("selectedStrategy"),
    ]);
    let weight_policy = object_choice(&[
        groups
            .strategy
            .and_then(|value| value.get("strategyWeightPolicy")),
        groups.signals.get("strategyWeightPolicy"),
    ]);
    let promotion =
        weight_policy.and_then(|value| value.get("selectedPromotion").and_then(Value::as_object));
    let top_strategy = groups
        .strategy
        .and_then(|strategy| strategy.get("topStrategies"))
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|item| item.get("reliable").and_then(Value::as_bool) == Some(true))
                .or_else(|| items.first())
        })
        .and_then(Value::as_object);
    let learning_signals = groups
        .self_improvement
        .and_then(|value| value.get("learningSignals"))
        .and_then(Value::as_object);
    let promoted = array_choice(&[
        learning_signals.and_then(|value| value.get("promotedStrategies")),
        weight_policy.and_then(|value| value.get("promotedStrategies")),
    ]);
    let promoted_first = promoted.first().and_then(Value::as_object);
    let strategy_id = [
        map_string(selected, &["sourceStrategyId", "strategyId", "id"]),
        map_string(promotion, &["strategyId"]),
        map_string(top_strategy, &["strategyId"]),
        map_string(promoted_first, &["strategyId"]),
    ]
    .into_iter()
    .flatten()
    .map(|value| safe_token(Some(value), ""))
    .find(|value| !value.is_empty())
    .unwrap_or_else(|| "cold_start_structure".to_string());
    let strategy_version = [
        map_string(selected, &["strategyVersion", "version"]),
        map_string(groups.strategy, &["insightVersion"]),
        map_string(weight_policy, &["weightPolicyVersion"]),
    ]
    .into_iter()
    .flatten()
    .map(|value| safe_token(Some(value), ""))
    .find(|value| !value.is_empty())
    .unwrap_or_else(|| "v1".to_string());
    json!({ "strategyId": strategy_id, "strategyVersion": strategy_version })
}

fn push_failure_token(tokens: &mut Vec<String>, value: Option<&str>) {
    const ALLOWED: &[&str] = &[
        "missing_context",
        "wrong_format",
        "not_actionable",
        "too_long",
        "token_waste",
        "tool_mismatch",
        "low_quality",
        "insert_failed",
        "too_vague",
        "unsafe_or_privacy",
        "other",
    ];
    let token = safe_token(value, "").to_ascii_lowercase();
    if ALLOWED.contains(&token.as_str()) && !tokens.contains(&token) {
        tokens.push(token);
    }
}

fn collect_failure_tokens(groups: &SignalGroups<'_>) -> Vec<String> {
    let mut output = Vec::new();
    for item in array_choice(&[
        groups.failure.and_then(|value| value.get("topReasons")),
        groups.signals.get("failureReasons"),
    ]) {
        push_failure_token(
            &mut output,
            item.as_str().or_else(|| {
                item.as_object()
                    .and_then(|value| map_string(Some(value), &["reasonToken", "key"]))
            }),
        );
    }
    if let Some(failure) = groups.failure {
        for item in failure
            .get("directives")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[])
        {
            push_failure_token(&mut output, item.get("reasonToken").and_then(Value::as_str));
        }
    }
    let learning_signals = groups
        .self_improvement
        .and_then(|value| value.get("learningSignals"))
        .and_then(Value::as_object);
    for item in learning_signals
        .and_then(|value| value.get("topFailureReasons"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        push_failure_token(&mut output, item.get("reasonToken").and_then(Value::as_str));
    }
    for item in groups
        .self_improvement
        .and_then(|value| value.get("reflections"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        push_failure_token(&mut output, item.get("reasonToken").and_then(Value::as_str));
    }
    for item in groups
        .evolution
        .and_then(|value| value.get("candidates"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        push_failure_token(&mut output, item.get("reasonToken").and_then(Value::as_str));
    }
    for item in groups
        .signals
        .get("failureReasonTokens")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        push_failure_token(&mut output, item.as_str());
    }
    output.truncate(8);
    output
}

fn quality_decisions(groups: &SignalGroups<'_>) -> BTreeSet<String> {
    let quality_report = object_choice(&[
        groups
            .quality
            .and_then(|value| value.get("promptQualityLiftReport")),
        groups.signals.get("promptQualityLiftReport"),
    ])
    .or(groups.quality);
    let segment_policy = object_choice(&[
        groups
            .quality
            .and_then(|value| value.get("qualityLiftSegmentPolicy")),
        groups
            .strategy
            .and_then(|value| value.get("qualityLiftSegmentPolicy")),
        groups.signals.get("qualityLiftSegmentPolicy"),
    ]);
    let quality_readiness = quality_report
        .and_then(|value| value.get("readiness"))
        .and_then(Value::as_object);
    let learning_signals = groups
        .self_improvement
        .and_then(|value| value.get("learningSignals"))
        .and_then(Value::as_object);
    [
        map_string(quality_readiness, &["primaryDecision"]),
        map_string(quality_report, &["primaryDecision", "decision"]),
        map_string(segment_policy, &["decision"]),
        map_string(
            learning_signals,
            &["qualityLiftDecision", "qualityLiftSegmentDecision"],
        ),
    ]
    .into_iter()
    .flatten()
    .map(|value| safe_token(Some(value), ""))
    .filter(|value| !value.is_empty())
    .collect()
}

fn guarded_strategy(groups: &SignalGroups<'_>, failures: &[String], selected: &Value) -> Value {
    let decisions = quality_decisions(groups);
    let version = selected["strategyVersion"].as_str().unwrap_or("v1");
    if decisions.contains("quality_lift_regression")
        || decisions.contains("segment_regression_guardrail")
        || failures.iter().any(|value| value == "tool_mismatch")
    {
        json!({ "strategyId": "baseline_structure", "strategyVersion": version })
    } else if failures.iter().any(|value| value == "insert_failed") {
        json!({ "strategyId": "insert_safe_compact", "strategyVersion": version })
    } else {
        selected.clone()
    }
}

fn context_budget(source: &Map<String, Value>, failures: &[String]) -> Value {
    let requested = object_choice(&[
        source.get("contextBudget"),
        source
            .get("signals")
            .and_then(Value::as_object)
            .and_then(|signals| signals.get("contextBudget")),
    ]);
    let mut max_input = clamp_integer(
        requested.and_then(|value| value.get("maxInputTokens")),
        MIN_POLICY_INPUT_TOKENS,
        MAX_POLICY_INPUT_TOKENS,
        1600,
    );
    if failures
        .iter()
        .any(|value| matches!(value.as_str(), "too_long" | "token_waste"))
    {
        max_input = max_input.min(1200).max(MIN_POLICY_INPUT_TOKENS);
    }
    let max_context = clamp_integer(
        requested.and_then(|value| value.get("maxContextSourceTokens")),
        0,
        MAX_POLICY_CONTEXT_SOURCE_TOKENS,
        0,
    )
    .min(max_input);
    json!({
        "maxInputTokens": max_input,
        "maxContextSourceTokens": max_context
    })
}

fn evidence_summary(source: &Map<String, Value>, groups: &SignalGroups<'_>) -> Value {
    let explicit = object_choice(&[
        source.get("evidenceSummary"),
        groups.signals.get("evidenceSummary"),
    ]);
    let candidates = groups
        .strategy
        .and_then(|value| value.get("candidateStrategies"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let selected_id = selected_strategy(groups)["strategyId"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let candidate = candidates
        .iter()
        .find(|item| item["strategyId"].as_str() == Some(&selected_id))
        .or_else(|| candidates.first())
        .and_then(Value::as_object);
    let explicit_u64 = |key: &str| {
        explicit
            .and_then(|value| value.get(key))
            .and_then(Value::as_u64)
            .unwrap_or_default()
    };
    let mut attributable = explicit_u64("attributableOutcomeCount").max(
        candidate
            .and_then(|value| value.get("outcomes"))
            .and_then(Value::as_u64)
            .unwrap_or_default(),
    );
    let successful = explicit_u64("successfulOutcomeCount").max(
        candidate
            .and_then(|value| value.get("successfulOutcomes"))
            .and_then(Value::as_u64)
            .unwrap_or_default(),
    );
    let negative =
        explicit_u64("negativeOutcomeCount").max(attributable.saturating_sub(successful));
    attributable = attributable.max(successful.saturating_add(negative));
    let populated = [
        groups.strategy,
        groups.quality,
        groups.failure,
        groups.self_improvement,
        groups.evolution,
    ]
    .iter()
    .filter(|group| group.map(|value| !value.is_empty()).unwrap_or(false))
    .count() as u64;
    let retry_rate = clamp_number(
        finite_number(
            explicit
                .and_then(|value| value.get("retryRate"))
                .or_else(|| {
                    candidate.and_then(|value| {
                        value
                            .get("retryUsageRate")
                            .or_else(|| value.get("retryRate"))
                    })
                }),
            0.0,
        ),
        0.0,
        1.0,
    );
    let undo_rate = clamp_number(
        finite_number(
            explicit
                .and_then(|value| value.get("undoRate"))
                .or_else(|| candidate.and_then(|value| value.get("undoUsageRate"))),
            0.0,
        ),
        0.0,
        1.0,
    );
    json!({
        "attributableOutcomeCount": attributable,
        "successfulOutcomeCount": successful.min(attributable),
        "negativeOutcomeCount": negative.min(attributable.saturating_sub(successful.min(attributable))),
        "retryRate": retry_rate,
        "undoRate": undo_rate,
        "tokenDeltaRatio": clamp_number(finite_number(explicit.and_then(|value| value.get("tokenDeltaRatio")), 0.0), -1.0, 10.0),
        "evidenceTokenCount": explicit_u64("evidenceTokenCount").max(populated)
    })
}

#[derive(Clone)]
struct DirectiveProposal {
    kind: &'static str,
    value_token: &'static str,
    score: f64,
}

fn add_directive(
    proposals: &mut BTreeMap<&'static str, DirectiveProposal>,
    kind: &'static str,
    value_token: &'static str,
    score: f64,
) {
    let candidate = DirectiveProposal {
        kind,
        value_token,
        score: clamp_number(score, 0.0, 1.0),
    };
    let replace = proposals
        .get(kind)
        .map(|current| {
            candidate.score > current.score
                || (candidate.score == current.score && candidate.value_token < current.value_token)
        })
        .unwrap_or(true);
    if replace {
        proposals.insert(kind, candidate);
    }
}

fn compile_directives(
    groups: &SignalGroups<'_>,
    failures: &[String],
    selected: &Value,
    budget: &Value,
) -> Vec<Value> {
    let mut proposals = BTreeMap::new();
    add_directive(
        &mut proposals,
        "structure_order",
        "goal_context_constraints_acceptance",
        0.5,
    );
    add_directive(
        &mut proposals,
        "strategy_selection",
        if selected["strategyId"] == "cold_start_structure" {
            "use_stable_baseline"
        } else {
            "prefer_selected_strategy"
        },
        0.6,
    );
    add_directive(&mut proposals, "context_budget", "bounded_context", 0.6);

    let mut actions = Vec::new();
    for item in groups
        .strategy
        .and_then(|value| value.get("directives"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        if let Some(action) = item
            .get("key")
            .or_else(|| item.get("directiveId"))
            .and_then(Value::as_str)
        {
            actions.push(action.to_string());
        }
    }
    for item in groups
        .strategy
        .and_then(|value| value.get("recommendations"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        if let Some(action) = item
            .get("key")
            .or_else(|| item.get("recommendationKey"))
            .and_then(Value::as_str)
        {
            actions.push(action.to_string());
        }
    }
    for item in groups
        .evolution
        .and_then(|value| value.get("candidates"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        if item.get("mutationAllowed").and_then(Value::as_bool) != Some(true)
            && item.get("automaticPromotion").and_then(Value::as_bool) != Some(true)
        {
            if let Some(action) = item.get("action").and_then(Value::as_str) {
                actions.push(action.to_string());
            }
        }
    }
    for action in actions {
        match action.as_str() {
            "acceptance_heavy" | "make_prompt_actionable" | "strengthen_acceptance" => {
                add_directive(
                    &mut proposals,
                    "structure_order",
                    "action_steps_and_acceptance",
                    0.82,
                );
                add_directive(&mut proposals, "detail_level", "balanced", 0.7);
            }
            "strengthen_output_format" | "wrong_format_repair" => add_directive(
                &mut proposals,
                "structure_order",
                "output_format_before_acceptance",
                0.84,
            ),
            "insert_safe_compact" | "reduce_insert_fragility" => {
                add_directive(
                    &mut proposals,
                    "structure_order",
                    "insert_safe_plain_text",
                    0.9,
                );
                add_directive(&mut proposals, "detail_level", "concise", 0.82);
            }
            "shorten_prompt" | "reduce_prompt_length" => {
                add_directive(&mut proposals, "detail_level", "concise", 0.9);
                add_directive(&mut proposals, "deduplicate", "compress_repetition", 0.86);
            }
            "prefer_baseline_until_reviewed"
            | "avoid_regressing_segment"
            | "suppress_or_repair_strategy" => add_directive(
                &mut proposals,
                "strategy_selection",
                "use_stable_baseline",
                0.93,
            ),
            "preserve_winning_strategy"
            | "preserve_improving_segment"
            | "prefer_task_outcome_winner" => add_directive(
                &mut proposals,
                "strategy_selection",
                "prefer_selected_strategy",
                0.78,
            ),
            "reuse_friendly" => add_directive(
                &mut proposals,
                "structure_order",
                "stable_reusable_sections",
                0.7,
            ),
            _ => {}
        }
    }
    for reason in failures {
        match reason.as_str() {
            "too_long" | "token_waste" => {
                add_directive(&mut proposals, "detail_level", "concise", 0.98);
                add_directive(&mut proposals, "deduplicate", "compress_repetition", 0.96);
            }
            "wrong_format" => add_directive(
                &mut proposals,
                "structure_order",
                "output_format_before_acceptance",
                0.95,
            ),
            "not_actionable" | "low_quality" => {
                add_directive(
                    &mut proposals,
                    "structure_order",
                    "action_steps_and_acceptance",
                    0.92,
                );
                add_directive(&mut proposals, "detail_level", "balanced", 0.76);
            }
            "missing_context" | "too_vague" => add_directive(
                &mut proposals,
                "structure_order",
                "assumptions_before_execution",
                0.9,
            ),
            "insert_failed" => {
                add_directive(
                    &mut proposals,
                    "structure_order",
                    "insert_safe_plain_text",
                    0.97,
                );
                add_directive(&mut proposals, "detail_level", "concise", 0.84);
            }
            "tool_mismatch" => add_directive(
                &mut proposals,
                "strategy_selection",
                "use_stable_baseline",
                0.94,
            ),
            _ => {}
        }
    }
    for decision in quality_decisions(groups) {
        match decision.as_str() {
            "quality_lift_regression" | "segment_regression_guardrail" => add_directive(
                &mut proposals,
                "strategy_selection",
                "use_stable_baseline",
                0.99,
            ),
            "quality_lift_positive" | "preserve_segment_winner" => add_directive(
                &mut proposals,
                "strategy_selection",
                "prefer_selected_strategy",
                0.88,
            ),
            _ => {}
        }
    }
    if budget["maxInputTokens"].as_u64().unwrap_or_default() <= 1024 {
        add_directive(&mut proposals, "context_budget", "reduced_context", 0.8);
    }
    let mut values = proposals.into_values().collect::<Vec<_>>();
    values.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.kind.cmp(right.kind))
            .then_with(|| left.value_token.cmp(right.value_token))
    });
    values
        .into_iter()
        .take(5)
        .enumerate()
        .map(|(index, item)| {
            json!({
                "directiveId": format!("directive_{}", item.kind),
                "kind": item.kind,
                "valueToken": item.value_token,
                "priority": index + 1
            })
        })
        .collect()
}

pub fn compile_generation_policy(input: &Value) -> LearningPolicyResult<Value> {
    compile_generation_policy_at(input, None)
}

pub fn compile_policy(input: &Value) -> LearningPolicyResult<Value> {
    compile_generation_policy(input)
}

pub fn compile_generation_policy_at(
    input: &Value,
    now: Option<&str>,
) -> LearningPolicyResult<Value> {
    let source = input.as_object().ok_or_else(|| {
        LearningPolicyError::new(
            "invalid_generation_policy_input",
            "Generation Policy compiler input must be an object.",
        )
    })?;
    let groups = signal_groups(source);
    assert_automatic_policy_boundary(source, groups.signals)?;
    let scope =
        normalize_policy_scope(source.get("scope").or_else(|| groups.signals.get("scope")))?;
    let baseline_version = clamp_integer(source.get("baselineVersion"), 1, u64::MAX, 1);
    let version = clamp_integer(source.get("version"), 1, u64::MAX, baseline_version);
    let failures = collect_failure_tokens(&groups);
    let strategy = guarded_strategy(&groups, &failures, &selected_strategy(&groups));
    let budget = context_budget(source, &failures);
    let directives = compile_directives(&groups, &failures, &strategy, &budget);
    let high_risk = source.get("riskLevel").and_then(Value::as_str) == Some("high")
        || failures.iter().any(|value| value == "unsafe_or_privacy")
        || groups
            .evolution
            .and_then(|value| value.get("mutationAllowed"))
            .and_then(Value::as_bool)
            == Some(true)
        || groups
            .evolution
            .and_then(|value| value.get("automaticPromotion"))
            .and_then(Value::as_bool)
            == Some(true)
        || source.get("permissionChange").and_then(Value::as_bool) == Some(true)
        || source.get("crossProject").and_then(Value::as_bool) == Some(true);
    let timestamp = if let Some(value) = source.get("createdAt").and_then(Value::as_str) {
        canonical_timestamp(value)?
    } else if let Some(value) = now {
        canonical_timestamp(value)?
    } else {
        default_clock()
    };
    let policy_id = safe_token(source.get("policyId").and_then(Value::as_str), "");
    let policy_id = if policy_id.is_empty() {
        hash_token("policy", &scope_key(&scope))
    } else {
        policy_id
    };
    let policy = json!({
        "contractVersion": GENERATION_POLICY_VERSION,
        "policyId": policy_id,
        "version": version,
        "scope": scope,
        "selectedStrategy": strategy,
        "directives": directives,
        "contextBudget": budget,
        "evidenceSummary": evidence_summary(source, &groups),
        "baselineVersion": baseline_version,
        "status": "draft",
        "riskLevel": if high_risk { "high" } else { "low" },
        "automaticRolloutEligible": !high_risk
            && source.get("learningPaused").and_then(Value::as_bool) != Some(true)
            && source.get("automaticRolloutEligible").and_then(Value::as_bool) != Some(false),
        "createdAt": timestamp,
        "privacyFlags": privacy_flags()
    });
    validate_contract("generation_policy", &policy)?;
    Ok(policy)
}

fn validate_generation_policy(value: &Value) -> LearningPolicyResult<()> {
    validate_contract("generation_policy", value)?;
    for token in [
        value["policyId"].as_str(),
        value["scope"]["kind"].as_str(),
        value["scope"]["target"].as_str(),
        value["scope"]["projectScopeToken"].as_str(),
        value["scope"]["taskScenarioToken"].as_str(),
        value["scope"]["modelFamilyToken"].as_str(),
        value["selectedStrategy"]["strategyId"].as_str(),
        value["selectedStrategy"]["strategyVersion"].as_str(),
    ] {
        if token.map(valid_policy_token) != Some(true) {
            return Err(LearningPolicyError::new(
                "unsafe_generation_policy_token",
                "Generation Policy tokens must not contain credential-shaped values.",
            ));
        }
    }
    for directive in value["directives"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        for token in [
            directive["directiveId"].as_str(),
            directive["kind"].as_str(),
            directive["valueToken"].as_str(),
        ] {
            if token.map(valid_policy_token) != Some(true) {
                return Err(LearningPolicyError::new(
                    "unsafe_generation_policy_token",
                    "Generation Policy tokens must not contain credential-shaped values.",
                ));
            }
        }
    }
    Ok(())
}

fn validate_policy_rollout(value: &Value) -> LearningPolicyResult<()> {
    validate_contract("policy_rollout", value)?;
    for token in [
        value["rolloutId"].as_str(),
        value["policyId"].as_str(),
        value["projectScopeToken"].as_str(),
        value["status"].as_str(),
        value["rollbackReasonToken"].as_str(),
    ] {
        if token.map(valid_policy_token) != Some(true) {
            return Err(LearningPolicyError::new(
                "unsafe_policy_rollout_token",
                "Policy rollout tokens must not contain credential-shaped values.",
            ));
        }
    }
    Ok(())
}

fn validate_benchmark(value: &Value) -> LearningPolicyResult<()> {
    validate_contract("benchmark_result", value).map_err(|mut error| {
        if error.code == "contract_validation_failed" {
            error.code = "invalid_policy_benchmark".to_string();
        }
        error
    })?;
    for token in [
        value["benchmarkId"].as_str(),
        value["modelFamilyToken"].as_str(),
        value["fixtureSetToken"].as_str(),
        value["status"].as_str(),
        value["executor"].as_str(),
        value["initiatedBy"].as_str(),
        value["publicReason"].as_str(),
    ] {
        if token.map(valid_policy_token) != Some(true) {
            return Err(LearningPolicyError::new(
                "unsafe_policy_benchmark_token",
                "Benchmark tokens must not contain credential-shaped values.",
            ));
        }
    }
    Ok(())
}

fn benchmark_passes(benchmark: &Value, policy: &Value) -> LearningPolicyResult<bool> {
    validate_benchmark(benchmark)?;
    Ok(benchmark["status"] == "passed"
        && benchmark["modelFamilyToken"] == policy["scope"]["modelFamilyToken"]
        && benchmark["safety"]["qualityGatePassed"] == Value::Bool(true)
        && benchmark["safety"]["noAutoSubmitPassed"] == Value::Bool(true)
        && benchmark["safety"]["privacyPassed"] == Value::Bool(true)
        && benchmark["safety"]["permissionPassed"] == Value::Bool(true))
}

fn benchmark_has_production_evidence(benchmark: &Value) -> bool {
    benchmark["executor"] == "codex"
        && benchmark["initiatedBy"] == "user"
        && benchmark["authorization"]["required"] == Value::Bool(true)
        && benchmark["authorization"]["granted"] == Value::Bool(true)
        && benchmark["budget"]["exhausted"] == Value::Bool(false)
        && benchmark["comparability"]
            .as_object()
            .map(|comparability| {
                comparability
                    .values()
                    .all(|value| value == &Value::Bool(true))
            })
            .unwrap_or(false)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PolicyTransition {
    policy_id: String,
    policy_version: u64,
    from_status: String,
    to_status: String,
    reason_token: String,
    changed_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PolicyRegistryState {
    schema_version: String,
    learning_paused: bool,
    pause_reason_token: String,
    policies: Vec<Value>,
    rollouts: Vec<Value>,
    transitions: Vec<PolicyTransition>,
    updated_at: String,
}

impl PolicyRegistryState {
    fn new(timestamp: String) -> Self {
        Self {
            schema_version: GENERATION_POLICY_REGISTRY_VERSION.to_string(),
            learning_paused: false,
            pause_reason_token: "none".to_string(),
            policies: Vec::new(),
            rollouts: Vec::new(),
            transitions: Vec::new(),
            updated_at: timestamp,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct GenerationPolicyRegistryOptions {
    pub allow_harness_only_benchmarks: bool,
}

pub struct GenerationPolicyRegistry {
    file: PathBuf,
    clock: Clock,
    allow_harness_only_benchmarks: bool,
    lock: Mutex<()>,
}

impl GenerationPolicyRegistry {
    pub fn open(root: impl AsRef<Path>) -> LearningPolicyResult<Self> {
        Self::open_with_options(root, GenerationPolicyRegistryOptions::default())
    }

    pub fn open_with_options(
        root: impl AsRef<Path>,
        options: GenerationPolicyRegistryOptions,
    ) -> LearningPolicyResult<Self> {
        Self::open_with_clock_and_options(root, default_clock, options)
    }

    pub fn open_with_clock<F>(root: impl AsRef<Path>, clock: F) -> LearningPolicyResult<Self>
    where
        F: Fn() -> String + Send + Sync + 'static,
    {
        Self::open_with_clock_and_options(root, clock, GenerationPolicyRegistryOptions::default())
    }

    pub fn open_with_clock_and_options<F>(
        root: impl AsRef<Path>,
        clock: F,
        options: GenerationPolicyRegistryOptions,
    ) -> LearningPolicyResult<Self>
    where
        F: Fn() -> String + Send + Sync + 'static,
    {
        let root = root.as_ref().to_path_buf();
        ensure_safe_root(&root)?;
        fs::create_dir_all(&root).map_err(|error| {
            io_error(
                "policy_registry_storage_error",
                "create policy registry directory",
                error,
            )
        })?;
        let registry = Self {
            file: root.join(POLICY_REGISTRY_FILE_NAME),
            clock: Arc::new(clock),
            allow_harness_only_benchmarks: options.allow_harness_only_benchmarks,
            lock: Mutex::new(()),
        };
        if registry.file.exists() {
            registry.read_state()?;
        } else {
            let timestamp = clock_now(&registry.clock)?;
            write_json(&registry.file, &PolicyRegistryState::new(timestamp))?;
        }
        Ok(registry)
    }

    pub fn file(&self) -> &Path {
        &self.file
    }

    fn now(&self) -> LearningPolicyResult<String> {
        clock_now(&self.clock)
    }

    fn read_state(&self) -> LearningPolicyResult<PolicyRegistryState> {
        read_policy_registry_state(&self.file)
    }

    fn persist_state(&self, state: &mut PolicyRegistryState) -> LearningPolicyResult<()> {
        state.updated_at = self.now()?;
        validate_policy_registry_state(state)?;
        write_json(&self.file, state)
    }

    pub fn register(&self, policy: &Value) -> LearningPolicyResult<Value> {
        self.register_policy(policy)
    }

    pub fn register_policy(&self, policy: &Value) -> LearningPolicyResult<Value> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new(
                "policy_registry_storage_error",
                "Policy registry lock is poisoned.",
            )
        })?;
        validate_generation_policy(policy)?;
        let mut state = self.read_state()?;
        let policy_id = policy["policyId"].as_str().unwrap_or_default();
        let version = policy["version"].as_u64().unwrap_or_default();
        if let Some(existing) = state.policies.iter().find(|item| {
            item["policyId"].as_str() == Some(policy_id)
                && item["version"].as_u64() == Some(version)
        }) {
            if existing != policy {
                return Err(LearningPolicyError::new(
                    "generation_policy_version_conflict",
                    "The policy id and version already contain different data.",
                ));
            }
            return Ok(existing.clone());
        }
        let status = policy["status"].as_str().unwrap_or_default();
        if matches!(status, "stable" | "canary")
            && state.policies.iter().any(|item| {
                item["status"].as_str() == Some(status)
                    && same_scope(&item["scope"], &policy["scope"])
            })
        {
            return Err(LearningPolicyError::new(
                if status == "stable" {
                    "active_policy_stable_conflict"
                } else {
                    "active_policy_canary_conflict"
                },
                "Only one active policy of each rollout role may exist for an exact scope.",
            ));
        }
        state.policies.push(policy.clone());
        let changed_at = self.now()?;
        record_transition(
            &mut state,
            policy,
            "unregistered",
            status,
            "registered",
            &changed_at,
        );
        self.persist_state(&mut state)?;
        Ok(policy.clone())
    }

    pub fn get_policy(&self, policy_id: &str, version: u64) -> LearningPolicyResult<Option<Value>> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new(
                "policy_registry_storage_error",
                "Policy registry lock is poisoned.",
            )
        })?;
        require_token(Some(policy_id), "policyId")?;
        Ok(self.read_state()?.policies.into_iter().find(|policy| {
            policy["policyId"].as_str() == Some(policy_id)
                && policy["version"].as_u64() == Some(version)
        }))
    }

    pub fn mark_benchmarked(
        &self,
        policy_id: &str,
        version: u64,
        benchmark: &Value,
    ) -> LearningPolicyResult<Value> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new(
                "policy_registry_storage_error",
                "Policy registry lock is poisoned.",
            )
        })?;
        validate_benchmark(benchmark)?;
        if benchmark["status"] != "passed" {
            return Err(LearningPolicyError::new(
                "policy_benchmark_not_passed",
                "A passing isolated benchmark is required.",
            ));
        }
        if !benchmark_has_production_evidence(benchmark) && !self.allow_harness_only_benchmarks {
            return Err(LearningPolicyError::new(
                "policy_benchmark_production_evidence_required",
                "Harness-only or unauthorized benchmark evidence cannot promote a production policy.",
            ));
        }
        let mut state = self.read_state()?;
        let index = find_policy_index(&state, policy_id, version)?;
        if benchmark["modelFamilyToken"] != state.policies[index]["scope"]["modelFamilyToken"] {
            return Err(LearningPolicyError::new(
                "policy_benchmark_model_mismatch",
                "Benchmark and policy model families must match.",
            ));
        }
        if !benchmark_passes(benchmark, &state.policies[index])? {
            return Err(LearningPolicyError::new(
                "policy_benchmark_safety_failed",
                "Benchmark quality, no-auto-submit, privacy, and permission gates must all pass.",
            ));
        }
        let changed_at = self.now()?;
        let output = transition_policy(
            &mut state,
            policy_id,
            version,
            "benchmarked",
            "benchmark_passed",
            &changed_at,
        )?;
        let has_plan = state.rollouts.iter().any(|rollout| {
            rollout["policyId"] == output["policyId"]
                && rollout["policyVersion"] == output["version"]
                && matches!(
                    rollout["status"].as_str(),
                    Some("planned" | "canary" | "collecting" | "paused")
                )
        });
        let baseline = state
            .policies
            .iter()
            .find(|candidate| {
                candidate["policyId"] == output["policyId"]
                    && candidate["version"] == output["baselineVersion"]
                    && candidate["status"] == "stable"
                    && same_scope(&candidate["scope"], &output["scope"])
            })
            .cloned();
        if !has_plan
            && output["riskLevel"] == "low"
            && output["automaticRolloutEligible"] == Value::Bool(true)
            && output["scope"]["kind"] == "project"
        {
            if let Some(baseline) = baseline {
                let plan_started_at = self.now()?;
                let mut verified_plan = create_policy_rollout_at(
                    &json!({
                        "candidatePolicy": output,
                        "baselinePolicy": baseline,
                        "benchmarkResult": benchmark,
                        "canaryShareBps": DEFAULT_CANARY_SHARE_BPS
                    }),
                    Some(&plan_started_at),
                )?;
                verified_plan["status"] = Value::String("planned".to_string());
                validate_policy_rollout(&verified_plan)?;
                upsert_rollout(&mut state, &verified_plan);
            }
        }
        self.persist_state(&mut state)?;
        Ok(output)
    }

    pub fn record_rollout(&self, rollout: &Value) -> LearningPolicyResult<Value> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new(
                "policy_registry_storage_error",
                "Policy registry lock is poisoned.",
            )
        })?;
        validate_policy_rollout(rollout)?;
        let mut state = self.read_state()?;
        upsert_rollout(&mut state, rollout);
        self.persist_state(&mut state)?;
        Ok(rollout.clone())
    }

    pub fn start_canary(
        &self,
        policy_id: &str,
        version: u64,
        rollout: &Value,
    ) -> LearningPolicyResult<Value> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new(
                "policy_registry_storage_error",
                "Policy registry lock is poisoned.",
            )
        })?;
        validate_policy_rollout(rollout)?;
        let mut state = self.read_state()?;
        let index = find_policy_index(&state, policy_id, version)?;
        let policy = state.policies[index].clone();
        if policy["status"] != "benchmarked" {
            return Err(LearningPolicyError::new(
                "policy_not_benchmarked",
                "Only a benchmarked policy can enter canary rollout.",
            ));
        }
        let matches = rollout["policyId"] == policy["policyId"]
            && rollout["policyVersion"] == policy["version"]
            && rollout["baselineVersion"] == policy["baselineVersion"]
            && rollout["projectScopeToken"] == policy["scope"]["projectScopeToken"]
            && rollout["gates"]["benchmarkPassed"] == Value::Bool(true)
            && matches!(rollout["status"].as_str(), Some("canary" | "collecting"));
        if !matches {
            return Err(LearningPolicyError::new(
                "policy_rollout_mismatch",
                "The rollout does not match the benchmarked candidate.",
            ));
        }
        if policy["riskLevel"] != "low"
            || policy["automaticRolloutEligible"] != Value::Bool(true)
            || policy["scope"]["kind"] != "project"
        {
            return Err(LearningPolicyError::new(
                "policy_rollout_not_eligible",
                "Only low-risk project policies can enter automatic rollout.",
            ));
        }
        let baseline_version = rollout["baselineVersion"].as_u64().unwrap_or_default();
        let baseline_exists = state.policies.iter().any(|item| {
            item["policyId"] == policy["policyId"]
                && item["version"].as_u64() == Some(baseline_version)
                && item["status"] == "stable"
                && same_scope(&item["scope"], &policy["scope"])
        });
        if !baseline_exists {
            return Err(LearningPolicyError::new(
                "stable_policy_baseline_missing",
                "A matching stable baseline is required.",
            ));
        }
        if state.policies.iter().any(|item| {
            item["status"] == "canary"
                && same_scope(&item["scope"], &policy["scope"])
                && policy_identity(item) != policy_identity(&policy)
        }) {
            return Err(LearningPolicyError::new(
                "active_policy_canary_conflict",
                "Only one canary policy may be active for an exact scope.",
            ));
        }
        upsert_rollout(&mut state, rollout);
        let changed_at = self.now()?;
        let output = transition_policy(
            &mut state,
            policy_id,
            version,
            "canary",
            "canary_started",
            &changed_at,
        )?;
        self.persist_state(&mut state)?;
        Ok(output)
    }

    pub fn start_canary_from_benchmark(
        &self,
        policy_id: &str,
        version: u64,
        canary_share_bps: u64,
    ) -> LearningPolicyResult<Value> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new(
                "policy_registry_storage_error",
                "Policy registry lock is poisoned.",
            )
        })?;
        let mut state = self.read_state()?;
        let index = find_policy_index(&state, policy_id, version)?;
        let policy = state.policies[index].clone();
        if policy["status"] != "benchmarked" {
            return Err(LearningPolicyError::new(
                "policy_not_benchmarked",
                "Only a benchmarked policy can enter canary rollout.",
            ));
        }
        let plan_index = state
            .rollouts
            .iter()
            .enumerate()
            .filter(|(_, rollout)| {
                rollout["policyId"] == policy["policyId"]
                    && rollout["policyVersion"] == policy["version"]
                    && rollout["baselineVersion"] == policy["baselineVersion"]
                    && rollout["projectScopeToken"] == policy["scope"]["projectScopeToken"]
                    && rollout["status"] == "planned"
                    && rollout["gates"]["benchmarkPassed"] == Value::Bool(true)
            })
            .max_by(|(_, left), (_, right)| {
                left["startedAt"]
                    .as_str()
                    .unwrap_or_default()
                    .cmp(right["startedAt"].as_str().unwrap_or_default())
            })
            .map(|(plan_index, _)| plan_index)
            .ok_or_else(|| {
                LearningPolicyError::new(
                    "verified_policy_rollout_plan_missing",
                    "A server-recorded benchmark rollout plan is required before canary starts.",
                )
            })?;
        let baseline_version = state.rollouts[plan_index]["baselineVersion"]
            .as_u64()
            .unwrap_or_default();
        let baseline_exists = state.policies.iter().any(|candidate| {
            candidate["policyId"] == policy["policyId"]
                && candidate["version"].as_u64() == Some(baseline_version)
                && candidate["status"] == "stable"
                && same_scope(&candidate["scope"], &policy["scope"])
        });
        if !baseline_exists {
            return Err(LearningPolicyError::new(
                "stable_policy_baseline_missing",
                "A matching stable baseline is required.",
            ));
        }
        if state.policies.iter().any(|candidate| {
            candidate["status"] == "canary"
                && same_scope(&candidate["scope"], &policy["scope"])
                && policy_identity(candidate) != policy_identity(&policy)
        }) {
            return Err(LearningPolicyError::new(
                "active_policy_canary_conflict",
                "Only one canary policy may be active for an exact scope.",
            ));
        }
        state.rollouts[plan_index]["status"] = Value::String("canary".to_string());
        state.rollouts[plan_index]["canaryShareBps"] =
            Value::from(canary_share_bps.clamp(1, 10_000));
        validate_policy_rollout(&state.rollouts[plan_index])?;
        let changed_at = self.now()?;
        let output = transition_policy(
            &mut state,
            policy_id,
            version,
            "canary",
            "canary_started",
            &changed_at,
        )?;
        self.persist_state(&mut state)?;
        Ok(output)
    }

    pub fn apply_rollout_evaluation(
        &self,
        evaluation: &RolloutEvaluation,
    ) -> LearningPolicyResult<Value> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new(
                "policy_registry_storage_error",
                "Policy registry lock is poisoned.",
            )
        })?;
        validate_policy_rollout(&evaluation.rollout)?;
        let mut state = self.read_state()?;
        let policy_id = evaluation.rollout["policyId"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        let version = evaluation.rollout["policyVersion"]
            .as_u64()
            .unwrap_or_default();
        let index = find_policy_index(&state, &policy_id, version)?;
        let scope = state.policies[index]["scope"].clone();
        upsert_rollout(&mut state, &evaluation.rollout);
        let changed_at = self.now()?;
        let output = match evaluation.action.as_str() {
            "promote" if evaluation.rollout["status"] == "promoted" => {
                let old_stable_indices = state
                    .policies
                    .iter()
                    .enumerate()
                    .filter(|(candidate_index, item)| {
                        *candidate_index != index
                            && item["status"] == "stable"
                            && same_scope(&item["scope"], &scope)
                    })
                    .map(|(candidate_index, _)| candidate_index)
                    .collect::<Vec<_>>();
                for old_index in old_stable_indices {
                    let from_status = state.policies[old_index]["status"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string();
                    state.policies[old_index]["status"] = Value::String("rolled_back".to_string());
                    validate_generation_policy(&state.policies[old_index])?;
                    let old_policy = state.policies[old_index].clone();
                    record_transition(
                        &mut state,
                        &old_policy,
                        &from_status,
                        "rolled_back",
                        "superseded",
                        &changed_at,
                    );
                }
                transition_policy(
                    &mut state,
                    &policy_id,
                    version,
                    "stable",
                    "rollout_promoted",
                    &changed_at,
                )?
            }
            "rollback" if evaluation.rollout["status"] == "rolled_back" => transition_policy(
                &mut state,
                &policy_id,
                version,
                "rolled_back",
                evaluation.rollout["rollbackReasonToken"]
                    .as_str()
                    .unwrap_or("manual"),
                &changed_at,
            )?,
            "pause" if evaluation.rollout["status"] == "paused" => state.policies[index].clone(),
            "continue_canary" => state.policies[index].clone(),
            _ => {
                return Err(LearningPolicyError::new(
                    "invalid_rollout_evaluation",
                    "The rollout action and status do not agree.",
                ));
            }
        };
        self.persist_state(&mut state)?;
        Ok(output)
    }

    pub fn rollback(
        &self,
        policy_id: &str,
        version: u64,
        reason: &str,
    ) -> LearningPolicyResult<Value> {
        self.rollback_policy(policy_id, version, reason)
    }

    pub fn rollback_policy(
        &self,
        policy_id: &str,
        version: u64,
        reason: &str,
    ) -> LearningPolicyResult<Value> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new(
                "policy_registry_storage_error",
                "Policy registry lock is poisoned.",
            )
        })?;
        let reason = rollback_reason(reason)?;
        let mut state = self.read_state()?;
        let index = find_policy_index(&state, policy_id, version)?;
        if state.policies[index]["status"] == "rolled_back" {
            return Ok(state.policies[index].clone());
        }
        let was_stable = state.policies[index]["status"] == "stable";
        let scope = state.policies[index]["scope"].clone();
        let ended_at = self.now()?;
        let mut baseline_version = None;
        for rollout in &mut state.rollouts {
            if rollout["policyId"].as_str() == Some(policy_id)
                && rollout["policyVersion"].as_u64() == Some(version)
            {
                baseline_version = rollout["baselineVersion"].as_u64();
                if rollout["status"] != "rolled_back" {
                    rollout["status"] = Value::String("rolled_back".to_string());
                    rollout["rollbackReasonToken"] = Value::String(reason.clone());
                    rollout["endedAt"] = Value::String(ended_at.clone());
                    validate_policy_rollout(rollout)?;
                }
            }
        }
        let output = transition_policy(
            &mut state,
            policy_id,
            version,
            "rolled_back",
            &reason,
            &ended_at,
        )?;
        if was_stable {
            if let Some(baseline_version) = baseline_version {
                restore_superseded_baseline(
                    &mut state,
                    policy_id,
                    baseline_version,
                    &scope,
                    &ended_at,
                )?;
            }
        }
        self.persist_state(&mut state)?;
        Ok(output)
    }

    pub fn set_learning_paused(&self, paused: bool, reason: &str) -> LearningPolicyResult<Value> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new(
                "policy_registry_storage_error",
                "Policy registry lock is poisoned.",
            )
        })?;
        let mut state = self.read_state()?;
        let reason_token = if paused {
            safe_token(Some(reason), "manual")
        } else {
            "none".to_string()
        };
        state.learning_paused = paused;
        state.pause_reason_token = reason_token.clone();
        for rollout in &mut state.rollouts {
            if paused && matches!(rollout["status"].as_str(), Some("canary" | "collecting")) {
                rollout["status"] = Value::String("paused".to_string());
                validate_policy_rollout(rollout)?;
            } else if !paused && rollout["status"] == "paused" {
                rollout["status"] = Value::String("collecting".to_string());
                validate_policy_rollout(rollout)?;
            }
        }
        self.persist_state(&mut state)?;
        Ok(json!({ "learningPaused": paused, "reasonToken": reason_token }))
    }

    pub fn pause_learning(&self, reason: &str) -> LearningPolicyResult<Value> {
        self.set_learning_paused(true, reason)
    }

    pub fn resume_learning(&self) -> LearningPolicyResult<Value> {
        self.set_learning_paused(false, "none")
    }

    pub fn is_learning_paused(&self) -> LearningPolicyResult<bool> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new(
                "policy_registry_storage_error",
                "Policy registry lock is poisoned.",
            )
        })?;
        Ok(self.read_state()?.learning_paused)
    }

    pub fn list_policies(&self) -> LearningPolicyResult<Vec<Value>> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new(
                "policy_registry_storage_error",
                "Policy registry lock is poisoned.",
            )
        })?;
        Ok(self.read_state()?.policies)
    }

    pub fn list_rollouts(&self) -> LearningPolicyResult<Vec<Value>> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new(
                "policy_registry_storage_error",
                "Policy registry lock is poisoned.",
            )
        })?;
        Ok(self.read_state()?.rollouts)
    }

    pub fn get_snapshot(&self) -> LearningPolicyResult<Value> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new(
                "policy_registry_storage_error",
                "Policy registry lock is poisoned.",
            )
        })?;
        serde_json::to_value(self.read_state()?).map_err(|error| {
            serde_error(
                "policy_registry_storage_error",
                "serialize policy registry snapshot",
                error,
            )
        })
    }

    pub fn select_generation_policy_assignment(
        &self,
        context: &Value,
    ) -> LearningPolicyResult<Option<PolicySelection>> {
        self.select_generation_policy_assignment_with_bucket(context, None)
    }

    pub fn select_generation_policy_assignment_with_bucket(
        &self,
        context: &Value,
        bucket_override: Option<u16>,
    ) -> LearningPolicyResult<Option<PolicySelection>> {
        let _guard = self.lock.lock().map_err(|_| {
            LearningPolicyError::new(
                "policy_registry_storage_error",
                "Policy registry lock is poisoned.",
            )
        })?;
        let state = self.read_state()?;
        select_from_registry_state(&state, context, bucket_override)
    }

    pub fn select_generation_policy(&self, context: &Value) -> LearningPolicyResult<Option<Value>> {
        Ok(self
            .select_generation_policy_assignment(context)?
            .map(|assignment| assignment.policy))
    }
}

pub fn create_generation_policy_registry(
    root: impl AsRef<Path>,
) -> LearningPolicyResult<GenerationPolicyRegistry> {
    GenerationPolicyRegistry::open(root)
}

pub fn create_generation_policy_registry_with_options(
    root: impl AsRef<Path>,
    options: GenerationPolicyRegistryOptions,
) -> LearningPolicyResult<GenerationPolicyRegistry> {
    GenerationPolicyRegistry::open_with_options(root, options)
}

pub fn create_policy_registry(
    root: impl AsRef<Path>,
) -> LearningPolicyResult<GenerationPolicyRegistry> {
    create_generation_policy_registry(root)
}

pub fn create_policy_registry_with_options(
    root: impl AsRef<Path>,
    options: GenerationPolicyRegistryOptions,
) -> LearningPolicyResult<GenerationPolicyRegistry> {
    create_generation_policy_registry_with_options(root, options)
}

pub fn select_generation_policy_assignment(
    registry: &GenerationPolicyRegistry,
    context: &Value,
) -> LearningPolicyResult<Option<PolicySelection>> {
    registry.select_generation_policy_assignment(context)
}

pub fn select_generation_policy(
    registry: &GenerationPolicyRegistry,
    context: &Value,
) -> LearningPolicyResult<Option<Value>> {
    registry.select_generation_policy(context)
}

fn read_policy_registry_state(file: &Path) -> LearningPolicyResult<PolicyRegistryState> {
    let text = fs::read_to_string(file)
        .map_err(|error| io_error("policy_registry_corrupt", "read policy registry", error))?;
    let state: PolicyRegistryState = serde_json::from_str(&text)
        .map_err(|error| serde_error("policy_registry_corrupt", "parse policy registry", error))?;
    validate_policy_registry_state(&state)?;
    Ok(state)
}

fn validate_policy_registry_state(state: &PolicyRegistryState) -> LearningPolicyResult<()> {
    if state.schema_version != GENERATION_POLICY_REGISTRY_VERSION
        || !valid_token(&state.pause_reason_token)
        || canonical_timestamp(&state.updated_at).is_err()
    {
        return Err(LearningPolicyError::new(
            "policy_registry_corrupt",
            "The Generation Policy registry is malformed.",
        ));
    }
    let mut identities = HashSet::new();
    for policy in &state.policies {
        validate_generation_policy(policy).map_err(|error| {
            LearningPolicyError::new(
                "policy_registry_corrupt",
                format!("Stored Generation Policy is invalid: {error}"),
            )
        })?;
        if !identities.insert(policy_identity(policy)) {
            return Err(LearningPolicyError::new(
                "policy_registry_corrupt",
                "The Generation Policy registry contains duplicate versions.",
            ));
        }
    }
    let mut rollout_ids = HashSet::new();
    for rollout in &state.rollouts {
        validate_policy_rollout(rollout).map_err(|error| {
            LearningPolicyError::new(
                "policy_registry_corrupt",
                format!("Stored policy rollout is invalid: {error}"),
            )
        })?;
        if !rollout_ids.insert(rollout["rolloutId"].as_str().unwrap_or_default()) {
            return Err(LearningPolicyError::new(
                "policy_registry_corrupt",
                "The Generation Policy registry contains duplicate rollouts.",
            ));
        }
    }
    for transition in &state.transitions {
        if !valid_token(&transition.policy_id)
            || transition.policy_version == 0
            || !valid_token(&transition.from_status)
            || !valid_token(&transition.to_status)
            || !valid_token(&transition.reason_token)
            || canonical_timestamp(&transition.changed_at).is_err()
        {
            return Err(LearningPolicyError::new(
                "policy_registry_corrupt",
                "The Generation Policy registry history is malformed.",
            ));
        }
    }
    for policy in &state.policies {
        for status in ["stable", "canary"] {
            if policy["status"] == status {
                let count = state
                    .policies
                    .iter()
                    .filter(|item| {
                        item["status"] == status && same_scope(&item["scope"], &policy["scope"])
                    })
                    .count();
                if count > 1 {
                    return Err(LearningPolicyError::new(
                        "policy_registry_corrupt",
                        "An exact scope contains multiple active stable or canary policies.",
                    ));
                }
            }
        }
    }
    Ok(())
}

fn find_policy_index(
    state: &PolicyRegistryState,
    policy_id: &str,
    version: u64,
) -> LearningPolicyResult<usize> {
    state
        .policies
        .iter()
        .position(|policy| {
            policy["policyId"].as_str() == Some(policy_id)
                && policy["version"].as_u64() == Some(version)
        })
        .ok_or_else(|| {
            LearningPolicyError::new(
                "generation_policy_not_found",
                "The requested policy version is not registered.",
            )
        })
}

fn status_transition_allowed(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("draft", "benchmarked")
            | ("draft", "rolled_back")
            | ("benchmarked", "canary")
            | ("benchmarked", "rolled_back")
            | ("canary", "stable")
            | ("canary", "rolled_back")
            | ("stable", "rolled_back")
    )
}

fn transition_policy(
    state: &mut PolicyRegistryState,
    policy_id: &str,
    version: u64,
    to_status: &str,
    reason: &str,
    changed_at: &str,
) -> LearningPolicyResult<Value> {
    let index = find_policy_index(state, policy_id, version)?;
    let from_status = state.policies[index]["status"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    if from_status == to_status {
        return Ok(state.policies[index].clone());
    }
    if !status_transition_allowed(&from_status, to_status) {
        return Err(LearningPolicyError::new(
            "invalid_policy_status_transition",
            format!("Generation Policy cannot transition from {from_status} to {to_status}."),
        ));
    }
    state.policies[index]["status"] = Value::String(to_status.to_string());
    validate_generation_policy(&state.policies[index])?;
    let output = state.policies[index].clone();
    record_transition(state, &output, &from_status, to_status, reason, changed_at);
    Ok(output)
}

fn record_transition(
    state: &mut PolicyRegistryState,
    policy: &Value,
    from_status: &str,
    to_status: &str,
    reason: &str,
    changed_at: &str,
) {
    state.transitions.push(PolicyTransition {
        policy_id: policy["policyId"].as_str().unwrap_or_default().to_string(),
        policy_version: policy["version"].as_u64().unwrap_or_default(),
        from_status: safe_token(Some(from_status), "unknown"),
        to_status: safe_token(Some(to_status), "unknown"),
        reason_token: safe_token(Some(reason), "manual"),
        changed_at: changed_at.to_string(),
    });
}

fn upsert_rollout(state: &mut PolicyRegistryState, rollout: &Value) {
    if let Some(index) = state
        .rollouts
        .iter()
        .position(|item| item["rolloutId"] == rollout["rolloutId"])
    {
        state.rollouts[index] = rollout.clone();
    } else {
        state.rollouts.push(rollout.clone());
    }
}

fn rollback_reason(value: &str) -> LearningPolicyResult<String> {
    let value = match value {
        "safety_incident"
        | "auto_submit_incident"
        | "miswrite_incident"
        | "privacy_incident"
        | "permission_incident"
        | "quality_regression"
        | "manual" => value,
        _ => "manual",
    };
    if value == "none" {
        return Err(LearningPolicyError::new(
            "policy_rollback_reason_required",
            "A finite rollback reason is required.",
        ));
    }
    Ok(value.to_string())
}

fn restore_superseded_baseline(
    state: &mut PolicyRegistryState,
    policy_id: &str,
    baseline_version: u64,
    scope: &Value,
    changed_at: &str,
) -> LearningPolicyResult<()> {
    if state
        .policies
        .iter()
        .any(|policy| policy["status"] == "stable" && same_scope(&policy["scope"], scope))
    {
        return Ok(());
    }
    let Some(index) = state.policies.iter().position(|policy| {
        policy["policyId"].as_str() == Some(policy_id)
            && policy["version"].as_u64() == Some(baseline_version)
            && policy["status"] == "rolled_back"
            && same_scope(&policy["scope"], scope)
    }) else {
        return Ok(());
    };
    let was_superseded = state.transitions.iter().rev().any(|transition| {
        transition.policy_id == policy_id
            && transition.policy_version == baseline_version
            && transition.to_status == "rolled_back"
            && transition.reason_token == "superseded"
    });
    if !was_superseded {
        return Ok(());
    }
    state.policies[index]["status"] = Value::String("stable".to_string());
    validate_generation_policy(&state.policies[index])?;
    let restored = state.policies[index].clone();
    record_transition(
        state,
        &restored,
        "rolled_back",
        "stable",
        "rollback_restored_baseline",
        changed_at,
    );
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicySelection {
    pub policy: Value,
    pub arm: String,
    pub bucket: Option<u16>,
    pub rollout_id: Option<String>,
}

pub fn deterministic_bucket(value: &str, bucket_count: u32) -> u32 {
    let count = bucket_count.max(1);
    let mut digest = Sha256::new();
    digest.update(if value.is_empty() {
        b"anonymous".as_slice()
    } else {
        value.as_bytes()
    });
    let bytes = digest.finalize();
    u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) % count
}

fn selection_scope(context: &Map<String, Value>) -> Option<Value> {
    let nested = context.get("scope").and_then(Value::as_object);
    let target = safe_token(
        context.get("target").and_then(Value::as_str).or_else(|| {
            nested
                .and_then(|value| value.get("target"))
                .and_then(Value::as_str)
        }),
        "codex",
    );
    let project = safe_token(
        context
            .get("projectScopeToken")
            .and_then(Value::as_str)
            .or_else(|| {
                nested
                    .and_then(|value| value.get("projectScopeToken"))
                    .and_then(Value::as_str)
            }),
        "",
    );
    let scenario = safe_token(
        context
            .get("taskScenarioToken")
            .or_else(|| context.get("taskScenario"))
            .and_then(Value::as_str)
            .or_else(|| {
                nested
                    .and_then(|value| value.get("taskScenarioToken"))
                    .and_then(Value::as_str)
            }),
        "",
    );
    let model = safe_token(
        context
            .get("modelFamilyToken")
            .or_else(|| context.get("modelFamily"))
            .and_then(Value::as_str)
            .or_else(|| {
                nested
                    .and_then(|value| value.get("modelFamilyToken"))
                    .and_then(Value::as_str)
            }),
        "",
    );
    if target != "codex" || project.is_empty() || scenario.is_empty() || model.is_empty() {
        return None;
    }
    Some(json!({
        "kind": "project",
        "target": target,
        "projectScopeToken": project,
        "taskScenarioToken": scenario,
        "modelFamilyToken": model
    }))
}

fn newest_policy<'a>(policies: impl Iterator<Item = &'a Value>) -> Option<&'a Value> {
    policies.max_by(|left, right| {
        left["version"]
            .as_u64()
            .unwrap_or_default()
            .cmp(&right["version"].as_u64().unwrap_or_default())
            .then_with(|| {
                right["policyId"]
                    .as_str()
                    .unwrap_or_default()
                    .cmp(left["policyId"].as_str().unwrap_or_default())
            })
    })
}

fn select_from_registry_state(
    state: &PolicyRegistryState,
    context: &Value,
    bucket_override: Option<u16>,
) -> LearningPolicyResult<Option<PolicySelection>> {
    let context = context.as_object().ok_or_else(|| {
        LearningPolicyError::new(
            "invalid_policy_selection",
            "Policy selection context must be an object.",
        )
    })?;
    let Some(expected_scope) = selection_scope(context) else {
        return Ok(None);
    };
    let stable = newest_policy(state.policies.iter().filter(|policy| {
        policy["status"] == "stable" && same_scope(&policy["scope"], &expected_scope)
    }));
    let canary = newest_policy(state.policies.iter().filter(|policy| {
        policy["status"] == "canary" && same_scope(&policy["scope"], &expected_scope)
    }));
    let stable_selection = |rollout_id: Option<String>, bucket: Option<u16>| {
        stable.map(|policy| PolicySelection {
            policy: policy.clone(),
            arm: "stable".to_string(),
            bucket,
            rollout_id,
        })
    };
    let Some(canary) = canary else {
        return Ok(stable_selection(None, None));
    };
    if state.learning_paused || context.get("learningPaused").and_then(Value::as_bool) == Some(true)
    {
        return Ok(stable_selection(None, None));
    }
    let rollout = state
        .rollouts
        .iter()
        .filter(|rollout| {
            rollout["policyId"] == canary["policyId"]
                && rollout["policyVersion"] == canary["version"]
        })
        .max_by(|left, right| {
            left["startedAt"]
                .as_str()
                .unwrap_or_default()
                .cmp(right["startedAt"].as_str().unwrap_or_default())
        });
    let rollout_stable = rollout.and_then(|active_rollout| {
        state.policies.iter().find(|policy| {
            policy["status"] == "stable"
                && policy["policyId"] == active_rollout["policyId"]
                && policy["version"] == active_rollout["baselineVersion"]
                && same_scope(&policy["scope"], &expected_scope)
        })
    });
    let rollout_tracked = rollout
        .map(|active_rollout| {
            matches!(
                active_rollout["status"].as_str(),
                Some("canary" | "collecting")
            ) && active_rollout["baselineVersion"] == canary["baselineVersion"]
        })
        .unwrap_or(false)
        && rollout_stable.is_some();
    if !rollout_tracked {
        return Ok(stable_selection(
            rollout
                .and_then(|value| value["rolloutId"].as_str())
                .map(str::to_string),
            None,
        ));
    }
    let share = clamp_integer(
        context
            .get("canaryShareBps")
            .or_else(|| rollout.and_then(|value| value.get("canaryShareBps"))),
        0,
        10_000,
        DEFAULT_CANARY_SHARE_BPS as u64,
    ) as u16;
    let assignment_token = safe_token(
        context
            .get("assignmentToken")
            .or_else(|| context.get("generationId"))
            .or_else(|| context.get("sessionId"))
            .or_else(|| context.get("requestId"))
            .and_then(Value::as_str),
        "anonymous",
    );
    let bucket_key = format!(
        "{}|{}|{}|{}",
        scope_key(&expected_scope),
        canary["policyId"].as_str().unwrap_or_default(),
        canary["version"].as_u64().unwrap_or_default(),
        assignment_token
    );
    let bucket = bucket_override
        .map(|value| value % 10_000)
        .unwrap_or_else(|| deterministic_bucket(&bucket_key, 10_000) as u16);
    let rollout_id = rollout
        .and_then(|value| value["rolloutId"].as_str())
        .map(str::to_string);
    if bucket < share {
        Ok(Some(PolicySelection {
            policy: canary.clone(),
            arm: "canary".to_string(),
            bucket: Some(bucket),
            rollout_id,
        }))
    } else {
        Ok(rollout_stable.map(|policy| PolicySelection {
            policy: policy.clone(),
            arm: "stable".to_string(),
            bucket: Some(bucket),
            rollout_id,
        }))
    }
}

#[cfg(test)]
pub(crate) fn select_generation_policy_assignment_from_snapshot_for_test(
    policies: &[Value],
    rollouts: &[Value],
    learning_paused: bool,
    context: &Value,
    bucket_override: Option<u16>,
) -> LearningPolicyResult<Option<PolicySelection>> {
    for policy in policies {
        validate_generation_policy(policy)?;
    }
    for rollout in rollouts {
        validate_policy_rollout(rollout)?;
    }
    select_from_registry_state(
        &PolicyRegistryState {
            schema_version: GENERATION_POLICY_REGISTRY_VERSION.to_string(),
            learning_paused,
            pause_reason_token: if learning_paused { "test" } else { "none" }.to_string(),
            policies: policies.to_vec(),
            rollouts: rollouts.to_vec(),
            transitions: Vec::new(),
            updated_at: "1970-01-01T00:00:00.000Z".to_string(),
        },
        context,
        bucket_override,
    )
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RolloutEvaluation {
    pub action: String,
    pub reason_token: String,
    pub policy_status: String,
    pub rollout: Value,
    pub evidence: Value,
}

fn empty_rollout_arm() -> Value {
    json!({
        "attributableOutcomes": 0,
        "successRate": 0.0,
        "retryRate": 0.0,
        "undoRate": 0.0,
        "averageTokens": 0.0,
        "averageLatencyMs": 0.0,
        "averageReworkCount": 0.0
    })
}

fn non_negative(value: Option<&Value>) -> f64 {
    finite_number(value, 0.0).max(0.0)
}

fn result_outcome_token(result: &Value) -> String {
    safe_token(
        result
            .get("taskOutcomeToken")
            .or_else(|| result.get("outcomeStatus"))
            .or_else(|| result.get("status"))
            .or_else(|| result.get("outcome"))
            .and_then(Value::as_str),
        "",
    )
    .to_ascii_lowercase()
}

fn result_attributable(result: &Value) -> bool {
    if result.get("attributable").and_then(Value::as_bool) == Some(false)
        || result.get("attributed").and_then(Value::as_bool) == Some(false)
    {
        return false;
    }
    if result.get("attributable").and_then(Value::as_bool) == Some(true)
        || result.get("attributed").and_then(Value::as_bool) == Some(true)
    {
        return true;
    }
    matches!(
        result_outcome_token(result).as_str(),
        "completed" | "succeeded" | "success" | "not_completed" | "failed" | "failure"
    )
}

fn result_successful(result: &Value) -> bool {
    matches!(
        result_outcome_token(result).as_str(),
        "completed" | "succeeded" | "success"
    )
}

fn result_tokens(result: &Value) -> Option<f64> {
    let accounting = result.get("tokenAccounting").and_then(Value::as_object);
    if result
        .get("tokenAccountingSource")
        .or_else(|| accounting.and_then(|value| value.get("source")))
        .and_then(Value::as_str)
        == Some("unavailable")
    {
        return None;
    }
    if let Some(value) = result
        .get("totalTokens")
        .or_else(|| result.get("tokens"))
        .and_then(Value::as_f64)
        .filter(|value| *value >= 0.0)
    {
        return Some(value);
    }
    let values = [
        "inputTokens",
        "outputTokens",
        "insertedPromptTokenEstimate",
        "retryTokens",
        "reworkTokens",
    ]
    .iter()
    .filter_map(|field| {
        result
            .get(*field)
            .or_else(|| accounting.and_then(|value| value.get(*field)))
            .and_then(Value::as_f64)
            .filter(|value| *value >= 0.0)
    })
    .collect::<Vec<_>>();
    if values.is_empty() {
        None
    } else {
        Some(values.into_iter().sum())
    }
}

pub fn summarize_rollout_arm(results: &[Value]) -> Value {
    let attributable = results
        .iter()
        .filter(|result| result.is_object() && result_attributable(result))
        .collect::<Vec<_>>();
    if attributable.is_empty() {
        return empty_rollout_arm();
    }
    let count = attributable.len() as f64;
    let retries = attributable
        .iter()
        .map(|result| non_negative(result.get("retryCount")))
        .collect::<Vec<_>>();
    let rework = attributable
        .iter()
        .map(|result| {
            non_negative(
                result
                    .get("reworkCount")
                    .or_else(|| result.get("retryCount")),
            )
        })
        .collect::<Vec<_>>();
    let average = |values: Vec<f64>| {
        if values.is_empty() {
            0.0
        } else {
            values.iter().sum::<f64>() / values.len() as f64
        }
    };
    json!({
        "attributableOutcomes": attributable.len(),
        "successRate": attributable.iter().filter(|result| result_successful(result)).count() as f64 / count,
        "retryRate": retries.iter().filter(|value| **value > 0.0).count() as f64 / count,
        "undoRate": attributable.iter().filter(|result| result.get("undoUsed").and_then(Value::as_bool) == Some(true)).count() as f64 / count,
        "averageTokens": average(attributable.iter().filter_map(|result| result_tokens(result)).collect()),
        "averageLatencyMs": average(attributable.iter().filter_map(|result| result.get("latencyMs").or_else(|| result.get("durationMs")).and_then(Value::as_f64).filter(|value| *value >= 0.0)).collect()),
        "averageReworkCount": average(rework)
    })
}

pub fn summarize_policy_rollout_arm(results: &[Value]) -> Value {
    summarize_rollout_arm(results)
}

fn normalize_rollout_arm(value: Option<&Value>) -> Value {
    let object = value.and_then(Value::as_object);
    json!({
        "attributableOutcomes": clamp_integer(object.and_then(|value| value.get("attributableOutcomes")), 0, u64::MAX, 0),
        "successRate": clamp_number(finite_number(object.and_then(|value| value.get("successRate")), 0.0), 0.0, 1.0),
        "retryRate": clamp_number(finite_number(object.and_then(|value| value.get("retryRate")), 0.0), 0.0, 1.0),
        "undoRate": clamp_number(finite_number(object.and_then(|value| value.get("undoRate")), 0.0), 0.0, 1.0),
        "averageTokens": non_negative(object.and_then(|value| value.get("averageTokens"))),
        "averageLatencyMs": non_negative(object.and_then(|value| value.get("averageLatencyMs"))),
        "averageReworkCount": non_negative(object.and_then(|value| value.get("averageReworkCount")))
    })
}

fn rollout_arms(input: &Map<String, Value>, fallback: Option<&Value>) -> Value {
    if let Some(arms) = input.get("arms").and_then(Value::as_object) {
        return json!({
            "baseline": normalize_rollout_arm(arms.get("baseline")),
            "candidate": normalize_rollout_arm(arms.get("candidate"))
        });
    }
    let observations = input
        .get("observations")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    if observations.is_empty() {
        if let Some(fallback) = fallback.and_then(Value::as_object) {
            return json!({
                "baseline": normalize_rollout_arm(fallback.get("baseline")),
                "candidate": normalize_rollout_arm(fallback.get("candidate"))
            });
        }
    }
    let baseline = observations
        .iter()
        .filter(|item| item["arm"] == "baseline")
        .cloned()
        .collect::<Vec<_>>();
    let candidate = observations
        .iter()
        .filter(|item| item["arm"] == "candidate")
        .cloned()
        .collect::<Vec<_>>();
    json!({
        "baseline": summarize_rollout_arm(&baseline),
        "candidate": summarize_rollout_arm(&candidate)
    })
}

fn normalize_minimums(value: Option<&Value>) -> Value {
    let object = value.and_then(Value::as_object);
    json!({
        "perArmAttributableOutcomes": clamp_integer(object.and_then(|value| value.get("perArmAttributableOutcomes")), 10, u64::MAX, DEFAULT_MIN_PER_ARM),
        "tokenImprovementRatio": clamp_number(finite_number(object.and_then(|value| value.get("tokenImprovementRatio")), DEFAULT_TOKEN_IMPROVEMENT), 0.05, 1.0),
        "minimumEffectRatio": clamp_number(finite_number(object.and_then(|value| value.get("minimumEffectRatio")), DEFAULT_MINIMUM_EFFECT), 0.0, 1.0),
        "confidenceThreshold": clamp_number(finite_number(object.and_then(|value| value.get("confidenceThreshold")), DEFAULT_CONFIDENCE), 0.0, 1.0)
    })
}

#[derive(Default)]
struct RolloutConfidenceSamples {
    count: usize,
    success: Vec<f64>,
    retry: Vec<f64>,
    undo: Vec<f64>,
    tokens: Vec<f64>,
    latency: Vec<f64>,
    rework: Vec<f64>,
}

fn finite_metric(value: Option<&Value>, positive: bool) -> Option<f64> {
    let value = value.and_then(Value::as_f64)?;
    if !value.is_finite() || value < 0.0 || (positive && value <= 0.0) {
        None
    } else {
        Some(value)
    }
}

fn confidence_arm_samples(observations: &[Value], arm: &str) -> RolloutConfidenceSamples {
    let items = observations
        .iter()
        .filter(|item| item.is_object() && item.get("arm").and_then(Value::as_str) == Some(arm))
        .collect::<Vec<_>>();
    RolloutConfidenceSamples {
        count: items.len(),
        success: items
            .iter()
            .map(|item| if result_successful(item) { 1.0 } else { 0.0 })
            .collect(),
        retry: items
            .iter()
            .map(|item| {
                if finite_metric(item.get("retryCount"), false).unwrap_or(0.0) > 0.0 {
                    1.0
                } else {
                    0.0
                }
            })
            .collect(),
        undo: items
            .iter()
            .map(|item| {
                if item.get("undoUsed").and_then(Value::as_bool) == Some(true) {
                    1.0
                } else {
                    0.0
                }
            })
            .collect(),
        tokens: items
            .iter()
            .filter_map(|item| result_tokens(item))
            .collect(),
        latency: items
            .iter()
            .filter_map(|item| {
                finite_metric(
                    item.get("latencyMs").or_else(|| item.get("durationMs")),
                    true,
                )
            })
            .collect(),
        rework: items
            .iter()
            .filter_map(|item| {
                finite_metric(
                    item.get("reworkCount").or_else(|| item.get("retryCount")),
                    false,
                )
            })
            .collect(),
    }
}

fn mean(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        None
    } else {
        Some(values.iter().sum::<f64>() / values.len() as f64)
    }
}

fn sample_variance(values: &[f64], average: f64) -> f64 {
    if values.len() < 2 {
        0.0
    } else {
        values
            .iter()
            .map(|value| (value - average).powi(2))
            .sum::<f64>()
            / (values.len() - 1) as f64
    }
}

fn normal_cdf(value: f64) -> f64 {
    if value == f64::INFINITY {
        return 1.0;
    }
    if value == f64::NEG_INFINITY || !value.is_finite() {
        return 0.0;
    }
    let sign = if value < 0.0 { -1.0 } else { 1.0 };
    let x = value.abs() / 2.0_f64.sqrt();
    let t = 1.0 / (1.0 + 0.3275911 * x);
    let erf = sign
        * (1.0
            - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t
                + 0.254829592)
                * t
                * (-x.powi(2)).exp()));
    clamp_number(0.5 * (1.0 + erf), 0.0, 1.0)
}

fn directional_confidence(
    baseline: &[f64],
    candidate: &[f64],
    margin: f64,
    higher_is_better: bool,
) -> f64 {
    let (Some(baseline_mean), Some(candidate_mean)) = (mean(baseline), mean(candidate)) else {
        return 0.0;
    };
    let standard_error = (sample_variance(baseline, baseline_mean) / baseline.len() as f64
        + sample_variance(candidate, candidate_mean) / candidate.len() as f64)
        .sqrt();
    let signed_margin = if higher_is_better {
        candidate_mean - baseline_mean + margin
    } else {
        baseline_mean - candidate_mean + margin
    };
    if standard_error == 0.0 {
        if signed_margin >= 0.0 {
            1.0
        } else {
            0.0
        }
    } else {
        normal_cdf(signed_margin / standard_error)
    }
}

fn proportional_improvement_confidence(
    baseline: &[f64],
    candidate: &[f64],
    effect_ratio: f64,
) -> f64 {
    let (Some(baseline_mean), Some(candidate_mean)) = (mean(baseline), mean(candidate)) else {
        return 0.0;
    };
    if baseline_mean <= 0.0 {
        return 0.0;
    }
    let retained_ratio = 1.0 - effect_ratio;
    let standard_error = ((retained_ratio.powi(2) * sample_variance(baseline, baseline_mean))
        / baseline.len() as f64
        + sample_variance(candidate, candidate_mean) / candidate.len() as f64)
        .sqrt();
    let margin = baseline_mean * retained_ratio - candidate_mean;
    if standard_error == 0.0 {
        if margin >= 0.0 {
            1.0
        } else {
            0.0
        }
    } else {
        normal_cdf(margin / standard_error)
    }
}

pub fn estimate_rollout_confidence(observations: &[Value], minimums: Option<&Value>) -> Value {
    let minimums = normalize_minimums(minimums);
    let baseline = confidence_arm_samples(observations, "baseline");
    let candidate = confidence_arm_samples(observations, "candidate");
    let minimum_count = minimums["perArmAttributableOutcomes"]
        .as_u64()
        .unwrap_or(DEFAULT_MIN_PER_ARM) as usize;
    if baseline.count < minimum_count || candidate.count < minimum_count {
        return json!({ "confidence": 0.0, "enoughSamples": false, "dimensions": {} });
    }
    let non_inferiority_margin = clamp_number(
        minimums["minimumEffectRatio"]
            .as_f64()
            .unwrap_or(DEFAULT_MINIMUM_EFFECT),
        0.0,
        1.0,
    );
    let token_effect = clamp_number(
        minimums["tokenImprovementRatio"]
            .as_f64()
            .unwrap_or(DEFAULT_TOKEN_IMPROVEMENT),
        0.0,
        1.0,
    )
    .max(non_inferiority_margin);
    let task_quality = directional_confidence(
        &baseline.success,
        &candidate.success,
        non_inferiority_margin,
        true,
    );
    let retry = directional_confidence(
        &baseline.retry,
        &candidate.retry,
        non_inferiority_margin,
        false,
    );
    let undo = directional_confidence(
        &baseline.undo,
        &candidate.undo,
        non_inferiority_margin,
        false,
    );
    let tokens =
        proportional_improvement_confidence(&baseline.tokens, &candidate.tokens, token_effect);
    let latency = proportional_improvement_confidence(
        &baseline.latency,
        &candidate.latency,
        non_inferiority_margin,
    );
    let rework = proportional_improvement_confidence(
        &baseline.rework,
        &candidate.rework,
        non_inferiority_margin,
    );
    let efficiency = tokens.max(latency).max(rework);
    let confidence = clamp_number(task_quality.min(retry).min(undo).min(efficiency), 0.0, 1.0);
    json!({
        "confidence": (confidence * 1_000_000.0).round() / 1_000_000.0,
        "enoughSamples": true,
        "dimensions": {
            "taskQuality": task_quality,
            "retry": retry,
            "undo": undo,
            "tokens": tokens,
            "latency": latency,
            "rework": rework,
            "efficiency": efficiency
        }
    })
}

pub fn create_policy_rollout(input: &Value) -> LearningPolicyResult<Value> {
    create_policy_rollout_at(input, None)
}

pub fn create_policy_rollout_at(input: &Value, now: Option<&str>) -> LearningPolicyResult<Value> {
    let object = input.as_object().ok_or_else(|| {
        LearningPolicyError::new(
            "invalid_policy_rollout_input",
            "Policy rollout input must be an object.",
        )
    })?;
    let candidate = object
        .get("candidatePolicy")
        .or_else(|| object.get("policy"))
        .ok_or_else(|| {
            LearningPolicyError::new(
                "invalid_policy_rollout_input",
                "candidatePolicy is required.",
            )
        })?;
    let baseline = object.get("baselinePolicy").ok_or_else(|| {
        LearningPolicyError::new(
            "invalid_policy_rollout_input",
            "baselinePolicy is required.",
        )
    })?;
    validate_generation_policy(candidate)?;
    validate_generation_policy(baseline)?;
    if !same_scope(&candidate["scope"], &baseline["scope"]) {
        return Err(LearningPolicyError::new(
            "policy_rollout_scope_mismatch",
            "Baseline and candidate policies must use the same exact scope.",
        ));
    }
    if candidate["baselineVersion"] != baseline["version"] {
        return Err(LearningPolicyError::new(
            "policy_rollout_baseline_mismatch",
            "The candidate baselineVersion must match the stable baseline.",
        ));
    }
    if baseline["status"] != "stable" {
        return Err(LearningPolicyError::new(
            "policy_rollout_baseline_not_stable",
            "A stable baseline is required before canary rollout.",
        ));
    }
    if candidate["riskLevel"] != "low"
        || candidate["automaticRolloutEligible"] != Value::Bool(true)
        || candidate["scope"]["kind"] != "project"
    {
        return Err(LearningPolicyError::new(
            "policy_rollout_not_eligible",
            "Only low-risk project policies can enter automatic rollout.",
        ));
    }
    let benchmark_passed = match object.get("benchmarkResult") {
        Some(value) => benchmark_passes(value, candidate)?,
        None => false,
    };
    let timestamp = if let Some(value) = object.get("startedAt").and_then(Value::as_str) {
        canonical_timestamp(value)?
    } else if let Some(value) = now {
        canonical_timestamp(value)?
    } else {
        default_clock()
    };
    let rollout_id = safe_token(object.get("rolloutId").and_then(Value::as_str), "");
    let rollout_id = if rollout_id.is_empty() {
        hash_token(
            "rollout",
            &format!(
                "{}|{}|{}|{}",
                scope_key(&candidate["scope"]),
                candidate["policyId"].as_str().unwrap_or_default(),
                candidate["version"].as_u64().unwrap_or_default(),
                timestamp
            ),
        )
    } else {
        rollout_id
    };
    let rollout = json!({
        "contractVersion": POLICY_ROLLOUT_VERSION,
        "rolloutId": rollout_id,
        "policyId": candidate["policyId"],
        "policyVersion": candidate["version"],
        "baselineVersion": baseline["version"],
        "projectScopeToken": candidate["scope"]["projectScopeToken"],
        "status": if benchmark_passed { "canary" } else { "planned" },
        "canaryShareBps": clamp_integer(object.get("canaryShareBps"), 1, 10_000, DEFAULT_CANARY_SHARE_BPS as u64),
        "minimums": normalize_minimums(object.get("minimums")),
        "arms": rollout_arms(object, None),
        "gates": {
            "benchmarkPassed": benchmark_passed,
            "taskQualityNotDegraded": false,
            "retryUndoNotDegraded": false,
            "efficiencyImproved": false,
            "statisticalRequirementMet": false,
            "safetyIncidentCount": 0,
            "privacyIncidentCount": 0,
            "permissionIncidentCount": 0,
            "autoSubmitIncidentCount": 0,
            "miswriteIncidentCount": 0
        },
        "rollbackReasonToken": "none",
        "startedAt": timestamp,
        "endedAt": null,
        "privacyFlags": privacy_flags()
    });
    validate_policy_rollout(&rollout)?;
    Ok(rollout)
}

fn incident_counts(input: &Map<String, Value>) -> BTreeMap<&'static str, u64> {
    const FIELDS: &[&str] = &[
        "safetyIncidentCount",
        "privacyIncidentCount",
        "permissionIncidentCount",
        "autoSubmitIncidentCount",
        "miswriteIncidentCount",
    ];
    let source = input
        .get("incidents")
        .and_then(Value::as_object)
        .unwrap_or(input);
    let mut counts = FIELDS
        .iter()
        .map(|field| (*field, clamp_integer(source.get(*field), 0, u64::MAX, 0)))
        .collect::<BTreeMap<_, _>>();
    *counts.entry("autoSubmitIncidentCount").or_default() +=
        clamp_integer(source.get("noAutoSubmitIncidentCount"), 0, u64::MAX, 0);
    for event in input
        .get("events")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        let token = safe_token(
            event
                .get("type")
                .or_else(|| event.get("eventType"))
                .or_else(|| event.get("reasonToken"))
                .and_then(Value::as_str),
            "",
        )
        .to_ascii_lowercase();
        if event.get("safetyIncident").and_then(Value::as_bool) == Some(true)
            || token == "safety_incident"
        {
            *counts.entry("safetyIncidentCount").or_default() += 1;
        }
        if event.get("privacyIncident").and_then(Value::as_bool) == Some(true)
            || token == "privacy_incident"
        {
            *counts.entry("privacyIncidentCount").or_default() += 1;
        }
        if event.get("permissionIncident").and_then(Value::as_bool) == Some(true)
            || token == "permission_incident"
        {
            *counts.entry("permissionIncidentCount").or_default() += 1;
        }
        if event.get("miswriteIncident").and_then(Value::as_bool) == Some(true)
            || token == "miswrite_incident"
        {
            *counts.entry("miswriteIncidentCount").or_default() += 1;
        }
        if event.get("noAutoSubmit").and_then(Value::as_bool) == Some(false)
            || event.get("autoSubmitTriggered").and_then(Value::as_bool) == Some(true)
            || matches!(
                token.as_str(),
                "auto_submit_incident" | "no_auto_submit_incident"
            )
        {
            *counts.entry("autoSubmitIncidentCount").or_default() += 1;
        }
    }
    counts
}

fn incident_reason(counts: &BTreeMap<&str, u64>) -> &'static str {
    if counts
        .get("autoSubmitIncidentCount")
        .copied()
        .unwrap_or_default()
        > 0
    {
        "auto_submit_incident"
    } else if counts
        .get("miswriteIncidentCount")
        .copied()
        .unwrap_or_default()
        > 0
    {
        "miswrite_incident"
    } else if counts
        .get("privacyIncidentCount")
        .copied()
        .unwrap_or_default()
        > 0
    {
        "privacy_incident"
    } else if counts
        .get("permissionIncidentCount")
        .copied()
        .unwrap_or_default()
        > 0
    {
        "permission_incident"
    } else if counts
        .get("safetyIncidentCount")
        .copied()
        .unwrap_or_default()
        > 0
    {
        "safety_incident"
    } else {
        "none"
    }
}

fn lower_is_better(baseline: f64, candidate: f64, zero_candidate_unavailable: bool) -> f64 {
    if baseline <= 0.0 || (zero_candidate_unavailable && candidate <= 0.0) {
        0.0
    } else {
        (baseline - candidate.max(0.0)) / baseline
    }
}

pub fn evaluate_policy_rollout(
    rollout: &Value,
    input: &Value,
) -> LearningPolicyResult<RolloutEvaluation> {
    evaluate_policy_rollout_at(rollout, input, None)
}

pub fn evaluate_policy_rollout_at(
    rollout: &Value,
    input: &Value,
    now: Option<&str>,
) -> LearningPolicyResult<RolloutEvaluation> {
    validate_policy_rollout(rollout)?;
    let input = input.as_object().ok_or_else(|| {
        LearningPolicyError::new(
            "invalid_rollout_evaluation",
            "Rollout evaluation input must be an object.",
        )
    })?;
    let timestamp = if let Some(value) = input.get("observedAt").and_then(Value::as_str) {
        canonical_timestamp(value)?
    } else if let Some(value) = now {
        canonical_timestamp(value)?
    } else {
        default_clock()
    };
    let arms = rollout_arms(input, Some(&rollout["arms"]));
    let minimums = normalize_minimums(input.get("minimums").or_else(|| rollout.get("minimums")));
    let new_incidents = incident_counts(input);
    let mut incidents = BTreeMap::new();
    for field in [
        "safetyIncidentCount",
        "privacyIncidentCount",
        "permissionIncidentCount",
        "autoSubmitIncidentCount",
        "miswriteIncidentCount",
    ] {
        incidents.insert(
            field,
            rollout["gates"][field].as_u64().unwrap_or_default()
                + new_incidents.get(field).copied().unwrap_or_default(),
        );
    }
    let immediate_reason = incident_reason(&incidents);
    let minimum_count = minimums["perArmAttributableOutcomes"]
        .as_u64()
        .unwrap_or(DEFAULT_MIN_PER_ARM);
    let enough_samples = arms["baseline"]["attributableOutcomes"]
        .as_u64()
        .unwrap_or_default()
        >= minimum_count
        && arms["candidate"]["attributableOutcomes"]
            .as_u64()
            .unwrap_or_default()
            >= minimum_count;
    let baseline_success = arms["baseline"]["successRate"].as_f64().unwrap_or_default();
    let candidate_success = arms["candidate"]["successRate"]
        .as_f64()
        .unwrap_or_default();
    let baseline_retry = arms["baseline"]["retryRate"].as_f64().unwrap_or_default();
    let candidate_retry = arms["candidate"]["retryRate"].as_f64().unwrap_or_default();
    let baseline_undo = arms["baseline"]["undoRate"].as_f64().unwrap_or_default();
    let candidate_undo = arms["candidate"]["undoRate"].as_f64().unwrap_or_default();
    let quality_ok = candidate_success >= baseline_success;
    let retry_undo_ok = candidate_retry <= baseline_retry && candidate_undo <= baseline_undo;
    let token_improvement = lower_is_better(
        arms["baseline"]["averageTokens"]
            .as_f64()
            .unwrap_or_default(),
        arms["candidate"]["averageTokens"]
            .as_f64()
            .unwrap_or_default(),
        true,
    );
    let latency_improvement = lower_is_better(
        arms["baseline"]["averageLatencyMs"]
            .as_f64()
            .unwrap_or_default(),
        arms["candidate"]["averageLatencyMs"]
            .as_f64()
            .unwrap_or_default(),
        true,
    );
    let rework_improvement = lower_is_better(
        arms["baseline"]["averageReworkCount"]
            .as_f64()
            .unwrap_or_default(),
        arms["candidate"]["averageReworkCount"]
            .as_f64()
            .unwrap_or_default(),
        false,
    );
    let minimum_effect = minimums["minimumEffectRatio"]
        .as_f64()
        .unwrap_or(DEFAULT_MINIMUM_EFFECT);
    let token_target = minimums["tokenImprovementRatio"]
        .as_f64()
        .unwrap_or(DEFAULT_TOKEN_IMPROVEMENT);
    let token_improved = token_improvement >= token_target.max(minimum_effect);
    let latency_improved = latency_improvement >= minimum_effect && latency_improvement > 0.0;
    let rework_improved = rework_improvement >= minimum_effect && rework_improvement > 0.0;
    let efficiency_improved = token_improved || latency_improved || rework_improved;
    let best_effect = [
        if token_improved {
            token_improvement
        } else {
            0.0
        },
        if latency_improved {
            latency_improvement
        } else {
            0.0
        },
        if rework_improved {
            rework_improvement
        } else {
            0.0
        },
    ]
    .into_iter()
    .fold(0.0_f64, f64::max);
    let declared_confidence = input
        .get("confidence")
        .or_else(|| input.get("declaredConfidence"))
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite());
    let confidence_met = declared_confidence
        .map(|value| {
            value
                >= minimums["confidenceThreshold"]
                    .as_f64()
                    .unwrap_or(DEFAULT_CONFIDENCE)
        })
        .unwrap_or_else(|| rollout["gates"]["statisticalRequirementMet"] == Value::Bool(true));
    let statistical_met = confidence_met && best_effect >= minimum_effect;
    let benchmark_passed = rollout["gates"]["benchmarkPassed"] == Value::Bool(true)
        && input.get("benchmarkPassed").and_then(Value::as_bool) != Some(false);
    let worst_regression = (baseline_success - candidate_success)
        .max(candidate_retry - baseline_retry)
        .max(candidate_undo - baseline_undo);
    let significant_quality_regression = enough_samples
        && confidence_met
        && worst_regression >= minimum_effect
        && worst_regression > 0.0;
    let mut action = "continue_canary";
    let mut reason = "insufficient_evidence";
    let mut status = if rollout["status"] == "planned" {
        "planned"
    } else {
        "collecting"
    };
    let mut rollback_reason = "none";
    let mut ended_at = Value::Null;
    if immediate_reason != "none" {
        action = "rollback";
        reason = immediate_reason;
        status = "rolled_back";
        rollback_reason = immediate_reason;
        ended_at = Value::String(timestamp.clone());
    } else if input.get("learningPaused").and_then(Value::as_bool) == Some(true) {
        action = "pause";
        reason = "manual_pause";
        status = "paused";
    } else if significant_quality_regression {
        action = "rollback";
        reason = "quality_regression";
        status = "rolled_back";
        rollback_reason = "quality_regression";
        ended_at = Value::String(timestamp.clone());
    } else if enough_samples
        && benchmark_passed
        && quality_ok
        && retry_undo_ok
        && efficiency_improved
        && statistical_met
    {
        action = "promote";
        reason = "promotion_gates_passed";
        status = "promoted";
        ended_at = Value::String(timestamp.clone());
    } else if rollout["status"] != "planned" || benchmark_passed {
        status = "collecting";
    }
    let mut evaluated = rollout.clone();
    evaluated["status"] = Value::String(status.to_string());
    evaluated["minimums"] = minimums;
    evaluated["arms"] = arms;
    evaluated["gates"] = json!({
        "benchmarkPassed": benchmark_passed,
        "taskQualityNotDegraded": quality_ok,
        "retryUndoNotDegraded": retry_undo_ok,
        "efficiencyImproved": efficiency_improved,
        "statisticalRequirementMet": statistical_met,
        "safetyIncidentCount": incidents["safetyIncidentCount"],
        "privacyIncidentCount": incidents["privacyIncidentCount"],
        "permissionIncidentCount": incidents["permissionIncidentCount"],
        "autoSubmitIncidentCount": incidents["autoSubmitIncidentCount"],
        "miswriteIncidentCount": incidents["miswriteIncidentCount"]
    });
    evaluated["rollbackReasonToken"] = Value::String(rollback_reason.to_string());
    evaluated["endedAt"] = ended_at;
    validate_policy_rollout(&evaluated)?;
    Ok(RolloutEvaluation {
        action: action.to_string(),
        reason_token: reason.to_string(),
        policy_status: if action == "promote" {
            "stable"
        } else if action == "rollback" {
            "rolled_back"
        } else {
            "canary"
        }
        .to_string(),
        rollout: evaluated,
        evidence: json!({
            "enoughSamples": enough_samples,
            "declaredConfidence": declared_confidence.map(|value| clamp_number(value, 0.0, 1.0)),
            "confidenceMet": confidence_met,
            "bestEffectRatio": best_effect,
            "tokenImprovementRatio": token_improvement,
            "latencyImprovementRatio": latency_improvement,
            "reworkImprovementRatio": rework_improvement,
            "tokenTargetRatio": token_target
        }),
    })
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct PolicyInvalidationArchive {
    policies: Vec<Value>,
    rollouts: Vec<Value>,
}

fn invalidate_project_policy_registry(
    root: &Path,
    project_scope_token: &str,
    timestamp: &str,
) -> LearningPolicyResult<PolicyInvalidationArchive> {
    let file = root.join(POLICY_REGISTRY_FILE_NAME);
    if !file.exists() {
        return Ok(PolicyInvalidationArchive::default());
    }
    let mut state = read_policy_registry_state(&file)?;
    let selected_policy_keys = state
        .policies
        .iter()
        .filter(|policy| policy["scope"]["projectScopeToken"].as_str() == Some(project_scope_token))
        .map(|policy| {
            (
                policy["policyId"].as_str().unwrap_or_default().to_string(),
                policy["version"].as_u64().unwrap_or_default(),
            )
        })
        .collect::<HashSet<_>>();
    let archived_policies = state
        .policies
        .iter()
        .filter(|policy| policy["scope"]["projectScopeToken"].as_str() == Some(project_scope_token))
        .map(|policy| {
            let mut value = policy.clone();
            if let Value::Object(object) = &mut value {
                object.insert("invalidated".to_string(), Value::Bool(true));
                object.insert(
                    "invalidatedAt".to_string(),
                    Value::String(timestamp.to_string()),
                );
            }
            value
        })
        .collect::<Vec<_>>();
    let archived_rollouts = state
        .rollouts
        .iter()
        .filter(|rollout| {
            rollout["projectScopeToken"].as_str() == Some(project_scope_token)
                || selected_policy_keys.contains(&(
                    rollout["policyId"].as_str().unwrap_or_default().to_string(),
                    rollout["policyVersion"].as_u64().unwrap_or_default(),
                ))
        })
        .map(|rollout| {
            let mut value = rollout.clone();
            if let Value::Object(object) = &mut value {
                object.insert("invalidated".to_string(), Value::Bool(true));
                object.insert(
                    "invalidatedAt".to_string(),
                    Value::String(timestamp.to_string()),
                );
            }
            value
        })
        .collect::<Vec<_>>();
    let policy_indices = state
        .policies
        .iter()
        .enumerate()
        .filter(|(_, policy)| {
            policy["scope"]["projectScopeToken"].as_str() == Some(project_scope_token)
                && policy["status"] != "rolled_back"
        })
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    for index in policy_indices {
        let from_status = state.policies[index]["status"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        state.policies[index]["status"] = Value::String("rolled_back".to_string());
        validate_generation_policy(&state.policies[index])?;
        let policy = state.policies[index].clone();
        record_transition(
            &mut state,
            &policy,
            &from_status,
            "rolled_back",
            "manual",
            timestamp,
        );
    }
    for rollout in &mut state.rollouts {
        let selected = rollout["projectScopeToken"].as_str() == Some(project_scope_token)
            || selected_policy_keys.contains(&(
                rollout["policyId"].as_str().unwrap_or_default().to_string(),
                rollout["policyVersion"].as_u64().unwrap_or_default(),
            ));
        if selected && rollout["status"] != "rolled_back" {
            rollout["status"] = Value::String("rolled_back".to_string());
            rollout["rollbackReasonToken"] = Value::String("manual".to_string());
            rollout["endedAt"] = Value::String(timestamp.to_string());
            validate_policy_rollout(rollout)?;
        }
    }
    state.updated_at = timestamp.to_string();
    validate_policy_registry_state(&state)?;
    write_json(&file, &state)?;
    Ok(PolicyInvalidationArchive {
        policies: archived_policies,
        rollouts: archived_rollouts,
    })
}
