#![allow(dead_code)]

use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{json, Map, Value};
use std::{collections::HashSet, error::Error, fmt};

pub const BUNDLE_VERSION: &str = "outcome-learning@1";
pub const FIXTURE_SET_VERSION: &str = "outcome-learning-contract-fixtures@1";
pub const LEARNING_CANDIDATE_SEED_VERSION: &str = "learning-candidate-seed@1";

fn edit_line_kind(line: &str) -> &'static str {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return "blank";
    }
    if trimmed.starts_with("```") {
        return "fence";
    }
    let bytes = trimmed.as_bytes();
    let heading_marks = bytes.iter().take_while(|value| **value == b'#').count();
    if (1..=6).contains(&heading_marks) && bytes.get(heading_marks) == Some(&b' ') {
        return "heading";
    }
    if bytes.len() >= 2 && matches!(bytes[0], b'-' | b'*' | b'+') && bytes[1] == b' ' {
        return "bullet";
    }
    let digits = bytes
        .iter()
        .take_while(|value| value.is_ascii_digit())
        .count();
    if digits > 0
        && matches!(bytes.get(digits), Some(b'.' | b')'))
        && bytes.get(digits + 1) == Some(&b' ')
    {
        return "number";
    }
    "text"
}

fn edit_structure_signature(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(edit_line_kind)
        .collect::<Vec<_>>()
        .join("|")
}

pub fn derive_edit_feature_summary(generated_text: &str, inserted_text: &str) -> Value {
    if generated_text == inserted_text {
        return json!({
            "userEdited": false,
            "lengthDeltaBucket": "none",
            "structureChanged": false
        });
    }
    let generated_len = generated_text.len();
    let inserted_len = inserted_text.len();
    let ratio = generated_len.abs_diff(inserted_len) as f64 / generated_len.max(1) as f64;
    let length_delta_bucket = if ratio <= 0.1 {
        "small"
    } else if ratio <= 0.3 {
        "medium"
    } else {
        "large"
    };
    json!({
        "userEdited": true,
        "lengthDeltaBucket": length_delta_bucket,
        "structureChanged": edit_structure_signature(generated_text) != edit_structure_signature(inserted_text)
    })
}

fn contains_learning_phrase(value: &str, phrases: &[&str]) -> bool {
    phrases.iter().any(|phrase| value.contains(phrase))
}

fn contains_ascii_scenario_term(value: &str, term: &str) -> bool {
    let bytes = value.as_bytes();
    value.match_indices(term).any(|(start, _)| {
        let end = start + term.len();
        let before_is_word = start > 0
            && bytes[start - 1].is_ascii()
            && (bytes[start - 1].is_ascii_alphanumeric() || bytes[start - 1] == b'_');
        let after_is_word = end < bytes.len()
            && bytes[end].is_ascii()
            && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'_');
        !before_is_word && !after_is_word
    })
}

fn matches_task_scenario(value: &str, ascii_terms: &[&str], unicode_terms: &[&str]) -> bool {
    ascii_terms
        .iter()
        .any(|term| contains_ascii_scenario_term(value, term))
        || unicode_terms.iter().any(|term| value.contains(term))
}

pub fn infer_task_scenario(input: &str) -> &'static str {
    let value = input
        .chars()
        .take(20_000)
        .collect::<String>()
        .to_lowercase();
    if matches_task_scenario(
        &value,
        &[
            "security",
            "privacy",
            "auth",
            "authentication",
            "authorization",
            "permission",
            "injection",
            "xss",
            "csrf",
            "secret",
            "token",
            "credential",
            "threat",
        ],
        &["安全", "隐私", "权限", "注入", "密钥", "凭据"],
    ) {
        return "security-review";
    }
    if matches_task_scenario(
        &value,
        &[
            "test",
            "qa",
            "acceptance",
            "regression",
            "coverage",
            "e2e",
            "unit",
            "integration",
            "flaky",
        ],
        &["测试", "验收", "回归", "覆盖"],
    ) {
        return "test-plan";
    }
    if matches_task_scenario(
        &value,
        &[
            "code",
            "review",
            "refactor",
            "bug",
            "patch",
            "diff",
            "api",
            "endpoint",
            "module",
            "repo",
            "pull request",
            "pr",
        ],
        &["代码", "重构", "修复", "接口", "仓库"],
    ) {
        return "code-review";
    }
    if matches_task_scenario(
        &value,
        &[
            "ui",
            "ux",
            "design",
            "layout",
            "component",
            "responsive",
            "frontend",
            "screen",
            "interaction",
            "visual",
        ],
        &["界面", "设计", "布局", "交互", "视觉"],
    ) {
        return "ui-ux";
    }
    if matches_task_scenario(
        &value,
        &[
            "release",
            "deploy",
            "installer",
            "checksum",
            "beta",
            "tag",
            "publish",
            "sidecar",
            "diagnostic",
            "crash",
            "port",
        ],
        &["发布", "安装", "打包", "诊断", "崩溃"],
    ) {
        return "release-ops";
    }
    if matches_task_scenario(
        &value,
        &[
            "metric",
            "analytics",
            "dashboard",
            "report",
            "kpi",
            "cohort",
            "funnel",
            "dataset",
            "sql",
        ],
        &["指标", "数据", "报表", "仪表", "分析"],
    ) {
        return "data-analysis";
    }
    if matches_task_scenario(
        &value,
        &[
            "prompt",
            "skill",
            "adapter",
            "llm",
            "model",
            "agent",
            "copilot",
            "extension",
        ],
        &["提示词", "模型", "插件", "扩展"],
    ) {
        return "prompt-engineering";
    }
    if matches_task_scenario(
        &value,
        &[
            "prd",
            "product",
            "idea",
            "roadmap",
            "user story",
            "prototype",
            "mvp",
            "feature",
        ],
        &["产品", "需求", "原型", "功能", "用户"],
    ) {
        return "product-idea";
    }
    "general"
}

fn normalize_learning_scenario_token(value: &str) -> &'static str {
    let token = value
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let token = token.trim_matches('_');
    match token {
        "feature" | "feature_development" => "feature_development",
        "bug" | "bug_fix" => "bug_fix",
        "test" | "test_plan" => "test_plan",
        "review" | "code_review" => "code_review",
        "docs" | "doc" | "documentation" => "documentation",
        "security" | "security_review" => "security_review",
        "ui" | "ux" | "ui_ux" => "ui_ux",
        "release" | "release_ops" => "release_ops",
        "analysis" | "data_analysis" => "data_analysis",
        "prompt" | "prompt_engineering" => "prompt_engineering",
        "product" | "product_idea" => "product_idea",
        "refactor" => "refactor",
        _ => "general",
    }
}

fn learning_skill_steps(scenario: &str) -> &'static [&'static str] {
    match scenario {
        "bug_fix" => &[
            "reproduce_issue",
            "identify_root_cause",
            "apply_scoped_fix",
            "run_regression_tests",
        ],
        "feature_development" => &[
            "inspect_existing_contract",
            "implement_scoped_change",
            "add_or_update_tests",
            "verify_acceptance",
        ],
        "refactor" => &[
            "lock_behavior_with_tests",
            "map_dependencies",
            "refactor_in_small_steps",
            "run_regression_tests",
        ],
        "test_plan" => &[
            "identify_risk_surface",
            "add_failing_test",
            "implement_fixture",
            "run_test_matrix",
        ],
        "code_review" => &[
            "inspect_diff",
            "identify_behavioral_risks",
            "verify_evidence",
            "report_findings",
        ],
        "documentation" => &[
            "inspect_source_of_truth",
            "update_scoped_docs",
            "verify_examples",
            "check_links",
        ],
        "security_review" => &[
            "map_trust_boundaries",
            "test_abuse_cases",
            "verify_guards",
            "report_residual_risk",
        ],
        "ui_ux" => &[
            "inspect_existing_design",
            "implement_interaction",
            "verify_responsive_states",
            "review_visual_evidence",
        ],
        "release_ops" => &[
            "build_release",
            "verify_artifacts",
            "run_packaged_smoke",
            "record_checksums",
        ],
        "data_analysis" => &[
            "validate_inputs",
            "compute_metrics",
            "inspect_anomalies",
            "publish_findings",
        ],
        "prompt_engineering" => &[
            "inspect_prompt_contract",
            "implement_scoped_prompt_change",
            "run_fixture_tests",
            "compare_output",
        ],
        "product_idea" => &[
            "define_user_outcome",
            "map_constraints",
            "prototype_core_flow",
            "validate_acceptance",
        ],
        _ => &[
            "inspect_context",
            "execute_scoped_steps",
            "verify_result",
            "report_evidence",
        ],
    }
}

fn learning_skill_seed(scenario: &str) -> Value {
    let scenario = normalize_learning_scenario_token(scenario);
    json!({
        "schemaVersion": LEARNING_CANDIDATE_SEED_VERSION,
        "artifactType": "skill",
        "patternToken": format!("skill_{scenario}"),
        "payload": {
            "triggerConditionTokens": [scenario],
            "stepTokens": learning_skill_steps(scenario),
            "verificationTokens": ["focused_checks_pass", "acceptance_evidence_recorded"],
            "resourceTokens": ["project_files", "project_test_runner"],
            "permissionTokens": ["workspace_read", "workspace_write_reviewed"],
            "failureRecoveryTokens": ["stop_on_guard_failure", "restore_scoped_change"],
            "scriptsExecutable": false,
            "permissionCheckPassed": false,
            "isolationTestPassed": false,
            "adversarialReviewPassed": false
        }
    })
}

fn learning_rule_seed(pattern: &str) -> Option<Value> {
    let (directive, scenario) = match pattern {
        "rule_preserve_existing_changes" => (
            "Preserve existing user changes while completing scoped work.",
            "workspace_change",
        ),
        "rule_recoverable_removal_only" => (
            "Use a recoverable Trash or Recycle Bin operation for removals.",
            "workspace_change",
        ),
        "rule_no_auto_submit" => (
            "Keep no-auto-submit enabled for generated input.",
            "safe_insert",
        ),
        "rule_verify_changed_behavior" => (
            "Verify changed behavior with focused tests before completion.",
            "workspace_change",
        ),
        "rule_keep_changes_scoped" => (
            "Keep implementation changes scoped to the requested behavior.",
            "workspace_change",
        ),
        _ => return None,
    };
    Some(json!({
        "schemaVersion": LEARNING_CANDIDATE_SEED_VERSION,
        "artifactType": "rule",
        "patternToken": pattern,
        "payload": {
            "directive": directive,
            "taskScenarioTokens": [scenario]
        }
    }))
}

fn learning_memory_seed(pattern: &str) -> Option<Value> {
    let label = match pattern {
        "memory_tauri" => "Tauri",
        "memory_electron" => "Electron",
        "memory_typescript" => "TypeScript",
        "memory_javascript" => "JavaScript",
        "memory_react" => "React",
        "memory_vue" => "Vue",
        "memory_rust" => "Rust",
        "memory_node_js" => "Node.js",
        "memory_python" => "Python",
        "memory_vite" => "Vite",
        "memory_next_js" => "Next.js",
        "memory_windows" => "Windows",
        "memory_linux" => "Linux",
        _ => return None,
    };
    Some(json!({
        "schemaVersion": LEARNING_CANDIDATE_SEED_VERSION,
        "artifactType": "memory",
        "patternToken": pattern,
        "payload": {
            "category": "technology_stack",
            "statement": format!("The project uses {label}.")
        }
    }))
}

fn canonical_learning_candidate_seed(pattern: &str) -> Option<Value> {
    if let Some(scenario) = pattern.strip_prefix("skill_") {
        let seed = learning_skill_seed(scenario);
        if seed["patternToken"].as_str() == Some(pattern) {
            return Some(seed);
        }
        return None;
    }
    learning_rule_seed(pattern).or_else(|| learning_memory_seed(pattern))
}

pub fn normalize_learning_candidate_seed(value: &Value) -> Option<Value> {
    if value["schemaVersion"].as_str() != Some(LEARNING_CANDIDATE_SEED_VERSION) {
        return None;
    }
    let expected = canonical_learning_candidate_seed(value["patternToken"].as_str()?)?;
    if expected == *value {
        Some(expected)
    } else {
        None
    }
}

pub fn derive_learning_candidate_seed(
    input_text: &str,
    task_scenario_token: &str,
) -> Option<Value> {
    let lower = input_text
        .to_lowercase()
        .chars()
        .take(20_000)
        .collect::<String>();
    if lower.trim().is_empty() {
        return None;
    }
    if contains_learning_phrase(
        &lower,
        &[
            "reusable workflow",
            "repeatable workflow",
            "standard workflow",
            "standard process",
            "\u{53ef}\u{590d}\u{7528}\u{6d41}\u{7a0b}",
            "\u{53ef}\u{91cd}\u{590d}\u{6d41}\u{7a0b}",
            "\u{6807}\u{51c6}\u{6d41}\u{7a0b}",
            "\u{56fa}\u{5b9a}\u{6d41}\u{7a0b}",
        ],
    ) {
        return Some(learning_skill_seed(task_scenario_token));
    }
    let rules: &[(&str, &[&str])] = &[
        (
            "rule_preserve_existing_changes",
            &[
                "do not overwrite existing changes",
                "do not revert existing changes",
                "preserve existing changes",
                "\u{4e0d}\u{8981}\u{8986}\u{76d6}\u{73b0}\u{6709}\u{6539}\u{52a8}",
                "\u{4e0d}\u{5f97}\u{56de}\u{9000}\u{73b0}\u{6709}\u{6539}\u{52a8}",
                "\u{4fdd}\u{7559}\u{73b0}\u{6709}\u{6539}\u{52a8}",
            ],
        ),
        (
            "rule_recoverable_removal_only",
            &[
                "do not permanently delete",
                "never permanently delete",
                "trash or recycle bin",
                "move to the recycle bin",
                "\u{4e0d}\u{8981}\u{6c38}\u{4e45}\u{5220}\u{9664}",
                "\u{4e0d}\u{5f97}\u{6c38}\u{4e45}\u{5220}\u{9664}",
                "\u{79fb}\u{5165}\u{56de}\u{6536}\u{7ad9}",
            ],
        ),
        (
            "rule_no_auto_submit",
            &[
                "no auto submit",
                "do not auto submit",
                "never send automatically",
                "do not send automatically",
                "\u{4e0d}\u{8981}\u{81ea}\u{52a8}\u{53d1}\u{9001}",
                "\u{4e0d}\u{5f97}\u{81ea}\u{52a8}\u{53d1}\u{9001}",
                "\u{7981}\u{6b62}\u{81ea}\u{52a8}\u{53d1}\u{9001}",
            ],
        ),
        (
            "rule_verify_changed_behavior",
            &[
                "must run tests",
                "tests must pass",
                "verify the changed behavior",
                "require regression tests",
                "\u{5fc5}\u{987b}\u{8fd0}\u{884c}\u{6d4b}\u{8bd5}",
                "\u{5fc5}\u{987b}\u{901a}\u{8fc7}\u{6d4b}\u{8bd5}",
                "\u{9700}\u{8981}\u{56de}\u{5f52}\u{6d4b}\u{8bd5}",
                "\u{9a8c}\u{8bc1}\u{6539}\u{52a8}\u{884c}\u{4e3a}",
            ],
        ),
        (
            "rule_keep_changes_scoped",
            &[
                "keep changes scoped",
                "minimal scoped change",
                "do not refactor unrelated",
                "avoid unrelated refactors",
                "\u{4fdd}\u{6301}\u{6700}\u{5c0f}\u{6539}\u{52a8}",
                "\u{4e0d}\u{8981}\u{65e0}\u{5173}\u{91cd}\u{6784}",
                "\u{4e0d}\u{5f97}\u{6269}\u{5927}\u{8303}\u{56f4}",
            ],
        ),
    ];
    for (pattern, phrases) in rules {
        if contains_learning_phrase(&lower, phrases) {
            return learning_rule_seed(pattern);
        }
    }
    if contains_learning_phrase(
        &lower,
        &[
            "project uses",
            "this project uses",
            "project is built with",
            "technology stack includes",
            "runs on",
            "\u{9879}\u{76ee}\u{4f7f}\u{7528}",
            "\u{9879}\u{76ee}\u{57fa}\u{4e8e}",
            "\u{6280}\u{672f}\u{6808}\u{5305}\u{542b}",
            "\u{8fd0}\u{884c}\u{5728}",
        ],
    ) {
        for (needle, pattern) in [
            ("tauri", "memory_tauri"),
            ("electron", "memory_electron"),
            ("typescript", "memory_typescript"),
            ("javascript", "memory_javascript"),
            ("react", "memory_react"),
            ("vue", "memory_vue"),
            ("rust", "memory_rust"),
            ("node.js", "memory_node_js"),
            ("nodejs", "memory_node_js"),
            ("python", "memory_python"),
            ("vite", "memory_vite"),
            ("next.js", "memory_next_js"),
            ("windows", "memory_windows"),
            ("linux", "memory_linux"),
        ] {
            if lower.contains(needle) {
                return learning_memory_seed(pattern);
            }
        }
    }
    None
}

pub const CONTRACT_VERSIONS: [(&str, &str); 10] = [
    ("prompt_session_event", "prompt-session@2"),
    (
        "codex_target_adapter_result",
        "codex-target-adapter-result@1",
    ),
    ("pending_outcome", "pending-outcome@1"),
    ("learning_observation", "learning-observation@1"),
    ("learning_artifact", "learning-artifact@1"),
    ("generation_policy", "generation-policy@1"),
    ("policy_rollout", "policy-rollout@1"),
    ("benchmark_result", "benchmark-result@1"),
    ("runtime_evidence", "runtime-evidence@1"),
    ("context_source", "context-source@1"),
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

const PROMPT_SESSION_EVENT_TYPES: &[&str] = &[
    "verified_insert",
    "insert_failed",
    "retry",
    "undo",
    "regenerated",
    "outcome_feedback",
    "outcome_expired",
    "policy_selected",
];
const TARGETS: &[&str] = &["codex"];
const ADAPTER_OPERATIONS: &[&str] = &["inspect", "read", "insert", "undo"];
const ADAPTER_STATUSES: &[&str] = &["ready", "blocked", "copy_only", "failed"];
const VERIFICATIONS: &[&str] = &["none", "machine"];
const WRITE_METHODS: &[&str] = &["none", "direct", "controlled_clipboard"];
const PUBLIC_REASONS: &[&str] = &[
    "none",
    "target_unavailable",
    "target_not_ready",
    "target_changed",
    "readback_unavailable",
    "write_not_verified",
    "safety_blocked",
    "model_unavailable",
    "budget_exhausted",
    "privacy_blocked",
    "permission_required",
    "benchmark_incomplete",
    "unknown",
];
const PENDING_OUTCOME_STATUSES: &[&str] = &[
    "unknown",
    "succeeded",
    "failed",
    "expired_unknown",
    "invalidated",
];
const TASK_OUTCOMES: &[&str] = &[
    "unknown",
    "completed",
    "not_completed",
    "expired_unknown",
    "invalidated",
];
const OUTCOME_FAILURE_REASONS: &[&str] = &[
    "missing_context",
    "wrong_format",
    "not_actionable",
    "too_long",
    "token_waste",
    "tool_mismatch",
    "low_quality",
    "insert_failed",
];
const TOKEN_ACCOUNTING_SOURCES: &[&str] = &["provider", "estimated", "unavailable"];
const FINGERPRINT_KINDS: &[&str] = &["keyed_feature_hash", "encrypted_local_embedding"];
const FINGERPRINT_RESIDUAL_RISKS: &[&str] = &["unknown", "low", "accepted", "rejected"];
const EDIT_LENGTH_DELTA_BUCKETS: &[&str] = &["none", "small", "medium", "large"];
const ARTIFACT_TYPES: &[&str] = &["memory", "rule", "skill", "generation_policy"];
const ARTIFACT_STATUSES: &[&str] = &[
    "pending_review",
    "active",
    "rejected",
    "rolled_back",
    "archived",
];
const ARTIFACT_SCOPES: &[&str] = &["project", "global_proposal", "global"];
const REVIEW_DECISIONS: &[&str] = &["pending", "accepted", "rejected"];
const EXECUTION_PERMISSIONS: &[&str] = &["none", "review_required"];
const SCOPE_EXPANSION_PERMISSIONS: &[&str] = &["project_only", "user_confirmation_required"];
const GENERATION_POLICY_STATUSES: &[&str] =
    &["draft", "benchmarked", "canary", "stable", "rolled_back"];
const POLICY_RISK_LEVELS: &[&str] = &["low", "high"];
const POLICY_DIRECTIVE_KINDS: &[&str] = &[
    "structure_order",
    "detail_level",
    "deduplicate",
    "strategy_selection",
    "context_budget",
];
const POLICY_ROLLOUT_STATUSES: &[&str] = &[
    "planned",
    "canary",
    "collecting",
    "promoted",
    "rolled_back",
    "paused",
];
const ROLLBACK_REASONS: &[&str] = &[
    "none",
    "safety_incident",
    "auto_submit_incident",
    "miswrite_incident",
    "privacy_incident",
    "permission_incident",
    "quality_regression",
    "manual",
];
const BENCHMARK_STATUSES: &[&str] = &["not_run", "passed", "failed", "budget_exhausted"];
const BENCHMARK_EXECUTORS: &[&str] = &["fake", "codex"];
const BENCHMARK_INITIATORS: &[&str] = &["test", "user"];
const BENCHMARK_CATEGORIES: &[&str] = &[
    "feature_development",
    "bug_fix",
    "refactor",
    "test_completion",
    "code_review",
    "documentation",
];
const RUNTIME_EVIDENCE_KINDS: &[&str] = &[
    "contract_test",
    "node_runtime",
    "rust_runtime",
    "installed_runtime",
    "verified_insert",
    "privacy_scan",
    "benchmark",
];
const RUNTIME_CONSUMERS: &[&str] = &["node", "rust", "desktop", "installed_app", "test"];
const RUNTIME_EVIDENCE_STATUSES: &[&str] = &["pass", "fail", "blocked", "not_run"];
const CONTEXT_SOURCE_TYPES: &[&str] = &[
    "chat_history",
    "current_screen",
    "project_files",
    "clipboard",
    "attachment",
];
const CONTEXT_TRUST_LEVELS: &[&str] = &["untrusted"];
const CONTEXT_PERMISSION_STATUSES: &[&str] = &["not_granted", "granted", "revoked"];
const CONTEXT_PREVIEW_STATUSES: &[&str] = &["not_available", "available", "reviewed", "removed"];
const CONTEXT_COLLECT_STATUSES: &[&str] = &[
    "not_requested",
    "not_implemented",
    "collected",
    "blocked",
    "removed",
];
const PROMPT_INJECTION_RISKS: &[&str] = &["unknown", "low", "medium", "high", "blocked"];

const MIN_FEEDBACK_DELAY_MS: i64 = 60_000;
const OUTCOME_TTL_MS: i64 = 86_400_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    pub code: String,
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationResult {
    pub contract: &'static str,
    pub contract_version: &'static str,
    pub errors: Vec<ValidationError>,
}

impl ValidationResult {
    pub fn is_valid(&self) -> bool {
        self.errors.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnsupportedContract {
    pub contract: String,
}

impl fmt::Display for UnsupportedContract {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "unknown outcome-learning contract: {}",
            self.contract
        )
    }
}

impl Error for UnsupportedContract {}

pub fn contract_version(contract: &str) -> Option<&'static str> {
    CONTRACT_VERSIONS
        .iter()
        .find(|(name, version)| contract == *name || contract == *version)
        .map(|(_, version)| *version)
}

fn contract_name(contract: &str) -> Option<&'static str> {
    CONTRACT_VERSIONS
        .iter()
        .find(|(name, version)| contract == *name || contract == *version)
        .map(|(name, _)| *name)
}

pub fn validate_contract(
    contract: &str,
    value: &Value,
) -> Result<ValidationResult, UnsupportedContract> {
    let resolved = contract_name(contract).ok_or_else(|| UnsupportedContract {
        contract: contract.to_owned(),
    })?;
    let result = match resolved {
        "prompt_session_event" => validate_prompt_session_event(value),
        "codex_target_adapter_result" => validate_codex_target_adapter_result(value),
        "pending_outcome" => validate_pending_outcome(value),
        "learning_observation" => validate_learning_observation(value),
        "learning_artifact" => validate_learning_artifact(value),
        "generation_policy" => validate_generation_policy(value),
        "policy_rollout" => validate_policy_rollout(value),
        "benchmark_result" => validate_benchmark_result(value),
        "runtime_evidence" => validate_runtime_evidence(value),
        "context_source" => validate_context_source(value),
        _ => unreachable!("resolved contracts are exhaustive"),
    };
    Ok(result)
}

struct ValidationContext {
    contract: &'static str,
    contract_version: &'static str,
    errors: Vec<ValidationError>,
}

impl ValidationContext {
    fn new(contract: &'static str) -> Self {
        Self {
            contract,
            contract_version: contract_version(contract).expect("known contract version"),
            errors: Vec::new(),
        }
    }

    fn add(&mut self, code: &str, path: impl Into<String>, message: impl Into<String>) {
        let path = path.into();
        if self
            .errors
            .iter()
            .any(|error| error.code == code && error.path == path)
        {
            return;
        }
        self.errors.push(ValidationError {
            code: code.to_owned(),
            path,
            message: message.into(),
        });
    }

    fn finish(self) -> ValidationResult {
        ValidationResult {
            contract: self.contract,
            contract_version: self.contract_version,
            errors: self.errors,
        }
    }
}

fn prepare_contract(
    contract: &'static str,
    value: &Value,
    fields: &[&str],
) -> (ValidationContext, bool) {
    let mut ctx = ValidationContext::new(contract);
    let root_is_object = check_object(&mut ctx, value, "$", fields, fields).is_some();
    if !root_is_object {
        return (ctx, false);
    }
    if value.get("contractVersion").and_then(Value::as_str) != Some(ctx.contract_version) {
        ctx.add(
            "contract_version",
            "$.contractVersion",
            format!("expected {}", ctx.contract_version),
        );
    }
    scan_privacy(&mut ctx, value, "$", "");
    validate_privacy_flags(&mut ctx, &value["privacyFlags"], "$.privacyFlags");
    (ctx, true)
}

fn check_object<'a>(
    ctx: &mut ValidationContext,
    value: &'a Value,
    path: &str,
    required: &[&str],
    allowed: &[&str],
) -> Option<&'a Map<String, Value>> {
    let Some(object) = value.as_object() else {
        ctx.add("type", path, "expected an object");
        return None;
    };
    for key in required {
        if !object.contains_key(*key) {
            ctx.add(
                "required",
                child_path(path, key),
                "required field is missing",
            );
        }
    }
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            ctx.add(
                "unknown_field",
                child_path(path, key),
                "field is not part of this contract version",
            );
        }
    }
    Some(object)
}

fn child_path(parent: &str, key: &str) -> String {
    format!("{parent}.{key}")
}

fn index_path(parent: &str, index: usize) -> String {
    format!("{parent}[{index}]")
}

fn check_string(
    ctx: &mut ValidationContext,
    value: &Value,
    path: &str,
    allow_empty: bool,
    max_length: usize,
) -> bool {
    let Some(text) = value.as_str() else {
        ctx.add("type", path, "expected a string");
        return false;
    };
    if !allow_empty && text.is_empty() {
        ctx.add("required", path, "string must not be empty");
    }
    if text.chars().count() > max_length {
        ctx.add(
            "range",
            path,
            format!("string exceeds {max_length} characters"),
        );
    }
    true
}

fn is_token(text: &str) -> bool {
    let mut chars = text.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    text.chars().count() <= 180
        && first.is_ascii_alphanumeric()
        && chars.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ':' | '@' | '-')
        })
}

fn check_token(ctx: &mut ValidationContext, value: &Value, path: &str, nullable: bool) -> bool {
    if nullable && value.is_null() {
        return true;
    }
    if !check_string(ctx, value, path, false, 180) {
        return false;
    }
    if !is_token(value.as_str().unwrap_or_default()) {
        ctx.add(
            "token_format",
            path,
            "expected a bounded opaque token without whitespace or path separators",
        );
        return false;
    }
    true
}

fn check_enum(ctx: &mut ValidationContext, value: &Value, path: &str, allowed: &[&str]) -> bool {
    if value
        .as_str()
        .is_some_and(|candidate| allowed.contains(&candidate))
    {
        return true;
    }
    ctx.add(
        "enum",
        path,
        format!("expected one of: {}", allowed.join(", ")),
    );
    false
}

fn check_bool(ctx: &mut ValidationContext, value: &Value, path: &str, nullable: bool) -> bool {
    if nullable && value.is_null() {
        return true;
    }
    if !value.is_boolean() {
        ctx.add("type", path, "expected a boolean");
        return false;
    }
    true
}

fn check_number(
    ctx: &mut ValidationContext,
    value: &Value,
    path: &str,
    nullable: bool,
    integer: bool,
    min: Option<f64>,
    max: Option<f64>,
) -> bool {
    if nullable && value.is_null() {
        return true;
    }
    let Some(number) = value.as_f64() else {
        ctx.add("type", path, "expected a finite number");
        return false;
    };
    if !number.is_finite() {
        ctx.add("type", path, "expected a finite number");
        return false;
    }
    if integer && number.fract() != 0.0 {
        ctx.add("type", path, "expected an integer");
    }
    if min.is_some_and(|minimum| number < minimum) || max.is_some_and(|maximum| number > maximum) {
        ctx.add("range", path, "number is outside the allowed range");
    }
    true
}

fn check_timestamp(ctx: &mut ValidationContext, value: &Value, path: &str, nullable: bool) -> bool {
    if nullable && value.is_null() {
        return true;
    }
    let Some(text) = value.as_str() else {
        ctx.add("timestamp", path, "expected an ISO-8601 timestamp");
        return false;
    };
    let Ok(parsed) = DateTime::parse_from_rfc3339(text) else {
        ctx.add("timestamp", path, "expected an ISO-8601 timestamp");
        return false;
    };
    let canonical = parsed
        .with_timezone(&Utc)
        .to_rfc3339_opts(SecondsFormat::Millis, true);
    if canonical != text {
        ctx.add(
            "timestamp",
            path,
            "timestamp must use canonical UTC ISO-8601 form",
        );
        return false;
    }
    true
}

fn timestamp_millis(value: &Value) -> Option<i64> {
    DateTime::parse_from_rfc3339(value.as_str()?)
        .ok()
        .map(|timestamp| timestamp.timestamp_millis())
}

fn check_token_array(
    ctx: &mut ValidationContext,
    value: &Value,
    path: &str,
    min_length: usize,
    max_length: usize,
    allowed: Option<&[&str]>,
) -> bool {
    let Some(items) = value.as_array() else {
        ctx.add("type", path, "expected an array");
        return false;
    };
    if items.len() < min_length || items.len() > max_length {
        ctx.add("range", path, "array length is outside the allowed range");
    }
    let mut seen = HashSet::new();
    for (index, item) in items.iter().enumerate() {
        let item_path = index_path(path, index);
        if let Some(values) = allowed {
            check_enum(ctx, item, &item_path, values);
        } else {
            check_token(ctx, item, &item_path, false);
        }
        if let Some(text) = item.as_str() {
            if !seen.insert(text) {
                ctx.add("duplicate", path, "array items must be unique");
            }
        }
    }
    true
}

fn validate_privacy_flags(ctx: &mut ValidationContext, value: &Value, path: &str) {
    if check_object(ctx, value, path, &PRIVACY_FLAG_NAMES, &PRIVACY_FLAG_NAMES).is_none() {
        return;
    }
    for name in PRIVACY_FLAG_NAMES {
        let field_path = child_path(path, name);
        check_bool(ctx, &value[name], &field_path, false);
        if value.get(name) != Some(&Value::Bool(false)) {
            ctx.add(
                "privacy_flag",
                field_path,
                "persisted privacy flags must remain false",
            );
        }
    }
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
        if token.starts_with("sk-") && token.len() >= 15 {
            return true;
        }
        if token.starts_with("AKIA") && token.len() >= 16 {
            return true;
        }
    }
    lowered
        .find("bearer ")
        .and_then(|index| lowered[index + 7..].split_whitespace().next())
        .is_some_and(|token| token.len() >= 12)
}

fn scan_privacy(ctx: &mut ValidationContext, value: &Value, path: &str, parent_key: &str) {
    match value {
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                scan_privacy(ctx, item, &index_path(path, index), parent_key);
            }
        }
        Value::Object(object) => {
            for (key, item) in object {
                let item_path = child_path(path, key);
                let compact = compact_key(key);
                if forbidden_raw_field(&compact) {
                    ctx.add(
                        "privacy_forbidden_field",
                        &item_path,
                        "raw or sensitive fields are forbidden in persisted contracts",
                    );
                }
                if PRIVACY_FLAG_NAMES.contains(&key.as_str()) && item != &Value::Bool(false) {
                    ctx.add(
                        "privacy_flag",
                        &item_path,
                        "persisted privacy flags must remain false",
                    );
                }
                scan_privacy(ctx, item, &item_path, key);
            }
        }
        Value::String(text) => {
            if looks_like_absolute_path(text) || looks_like_credential(text) {
                ctx.add(
                    "privacy_forbidden_value",
                    path,
                    "absolute paths and credential-shaped values are forbidden",
                );
            }
            let sensitive_parent = ["title", "path", "key", "secret", "credential"]
                .iter()
                .any(|token| parent_key.to_ascii_lowercase().contains(token));
            if sensitive_parent && text.len() > 180 {
                ctx.add(
                    "privacy_forbidden_value",
                    path,
                    "sensitive metadata must be represented by a bounded token",
                );
            }
        }
        _ => {}
    }
}

fn value_is(value: &Value, expected: &str) -> bool {
    value.as_str() == Some(expected)
}

fn is_true(value: &Value) -> bool {
    value == &Value::Bool(true)
}

fn normalize_reason_token(value: &str) -> String {
    let mut normalized = String::new();
    let mut needs_separator = false;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            if needs_separator && !normalized.is_empty() {
                normalized.push('_');
            }
            normalized.push(character.to_ascii_lowercase());
            needs_separator = false;
        } else {
            needs_separator = true;
        }
    }
    normalized
}

fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn map_public_reason(value: &str) -> &'static str {
    let token = normalize_reason_token(value);
    if token.is_empty()
        || [
            "none",
            "ok",
            "pass",
            "passed",
            "ready",
            "inserted",
            "succeeded",
            "success",
        ]
        .contains(&token.as_str())
    {
        return "none";
    }
    if let Some(reason) = PUBLIC_REASONS
        .iter()
        .find(|reason| token == **reason)
        .copied()
    {
        return reason;
    }
    if contains_any(&token, &["budget_exhaust", "exhausted_budget"]) {
        "budget_exhausted"
    } else if contains_any(
        &token,
        &[
            "privacy",
            "secret",
            "credential_leak",
            "raw_content",
            "sensitive",
        ],
    ) {
        "privacy_blocked"
    } else if contains_any(
        &token,
        &[
            "permission",
            "authorization",
            "authorisation",
            "consent",
            "not_authorized",
            "not_authorised",
        ],
    ) {
        "permission_required"
    } else if contains_any(
        &token,
        &["readback", "read_back", "machine_read", "unreadable"],
    ) {
        "readback_unavailable"
    } else if contains_any(
        &token,
        &[
            "after_write_mismatch",
            "write_mismatch",
            "insert_failed",
            "write_failed",
            "paste_failed",
            "not_verified",
        ],
    ) {
        "write_not_verified"
    } else if contains_any(
        &token,
        &[
            "safe_candidate",
            "unsafe",
            "auto_submit",
            "payload_guard",
            "wrong_target",
            "safety",
        ],
    ) {
        "safety_blocked"
    } else if contains_any(
        &token,
        &[
            "target_changed",
            "draft_changed",
            "stale_payload",
            "focus_changed",
            "window_changed",
        ],
    ) {
        "target_changed"
    } else if contains_any(
        &token,
        &[
            "not_foreground",
            "not_focused",
            "focus_required",
            "target_not_ready",
        ],
    ) {
        "target_not_ready"
    } else if contains_any(
        &token,
        &[
            "target_missing",
            "not_found",
            "hidden",
            "minimized",
            "cloaked",
            "unsupported_target",
        ],
    ) {
        "target_unavailable"
    } else if contains_any(
        &token,
        &[
            "model",
            "provider",
            "network",
            "api_key",
            "authentication",
            "credential_invalid",
        ],
    ) {
        "model_unavailable"
    } else if contains_any(&token, &["benchmark", "insufficient_evidence", "not_run"]) {
        "benchmark_incomplete"
    } else {
        "unknown"
    }
}

fn validate_semantic_fingerprint(ctx: &mut ValidationContext, value: &Value, path: &str) {
    let fields = [
        "kind",
        "projectScoped",
        "algorithm",
        "valueToken",
        "encryptedAtRest",
        "exportable",
        "absoluteIrreversibilityClaimed",
        "inversionRiskTested",
        "membershipInferenceRiskTested",
        "residualRisk",
    ];
    if check_object(ctx, value, path, &fields, &fields).is_none() {
        return;
    }
    check_enum(
        ctx,
        &value["kind"],
        &child_path(path, "kind"),
        FINGERPRINT_KINDS,
    );
    check_bool(
        ctx,
        &value["projectScoped"],
        &child_path(path, "projectScoped"),
        false,
    );
    check_token(
        ctx,
        &value["algorithm"],
        &child_path(path, "algorithm"),
        false,
    );
    check_token(
        ctx,
        &value["valueToken"],
        &child_path(path, "valueToken"),
        false,
    );
    for key in [
        "encryptedAtRest",
        "exportable",
        "absoluteIrreversibilityClaimed",
        "inversionRiskTested",
        "membershipInferenceRiskTested",
    ] {
        check_bool(ctx, &value[key], &child_path(path, key), false);
    }
    check_enum(
        ctx,
        &value["residualRisk"],
        &child_path(path, "residualRisk"),
        FINGERPRINT_RESIDUAL_RISKS,
    );
    if !is_true(&value["projectScoped"]) || value["exportable"] != Value::Bool(false) {
        ctx.add(
            "fingerprint_policy",
            path,
            "fingerprints must remain project-scoped and non-exportable",
        );
    }
    if value["absoluteIrreversibilityClaimed"] != Value::Bool(false) {
        ctx.add(
            "fingerprint_policy",
            child_path(path, "absoluteIrreversibilityClaimed"),
            "absolute irreversibility claims are forbidden",
        );
    }
    if value_is(&value["kind"], "keyed_feature_hash") {
        let digest = value["valueToken"].as_str().unwrap_or_default();
        if !value_is(&value["algorithm"], "hmac_sha256")
            || !is_lower_hex_64(digest)
            || value["encryptedAtRest"] != Value::Bool(false)
        {
            ctx.add(
                "fingerprint_policy",
                path,
                "keyed feature hashes require a project HMAC-SHA256 digest",
            );
        }
    }
    if value_is(&value["kind"], "encrypted_local_embedding")
        && (!value_is(&value["algorithm"], "local_embedding_aes_256_gcm")
            || !is_true(&value["encryptedAtRest"])
            || !is_true(&value["inversionRiskTested"])
            || !is_true(&value["membershipInferenceRiskTested"])
            || !["low", "accepted"].contains(&value["residualRisk"].as_str().unwrap_or_default()))
    {
        ctx.add(
            "fingerprint_policy",
            path,
            "encrypted local embeddings require encryption and residual-risk tests",
        );
    }
}

fn is_lower_hex_64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_prompt_session_event(value: &Value) -> ValidationResult {
    let fields = [
        "contractVersion",
        "eventId",
        "eventType",
        "occurredAt",
        "sessionId",
        "generationId",
        "target",
        "projectScopeToken",
        "strategyId",
        "strategyVersion",
        "modelFamilyToken",
        "outcomeId",
        "policyId",
        "policyVersion",
        "taskOutcomeToken",
        "insertVerified",
        "noAutoSubmit",
        "failureReasonTokens",
        "privacyFlags",
    ];
    let (mut ctx, root_is_object) = prepare_contract("prompt_session_event", value, &fields);
    if !root_is_object {
        return ctx.finish();
    }
    check_token(&mut ctx, &value["eventId"], "$.eventId", false);
    check_enum(
        &mut ctx,
        &value["eventType"],
        "$.eventType",
        PROMPT_SESSION_EVENT_TYPES,
    );
    check_timestamp(&mut ctx, &value["occurredAt"], "$.occurredAt", false);
    for key in [
        "sessionId",
        "generationId",
        "projectScopeToken",
        "strategyId",
        "strategyVersion",
        "modelFamilyToken",
    ] {
        check_token(&mut ctx, &value[key], &format!("$.{key}"), false);
    }
    check_enum(&mut ctx, &value["target"], "$.target", TARGETS);
    check_token(&mut ctx, &value["outcomeId"], "$.outcomeId", true);
    check_token(&mut ctx, &value["policyId"], "$.policyId", true);
    check_number(
        &mut ctx,
        &value["policyVersion"],
        "$.policyVersion",
        true,
        true,
        Some(1.0),
        None,
    );
    check_enum(
        &mut ctx,
        &value["taskOutcomeToken"],
        "$.taskOutcomeToken",
        TASK_OUTCOMES,
    );
    check_bool(
        &mut ctx,
        &value["insertVerified"],
        "$.insertVerified",
        false,
    );
    check_bool(&mut ctx, &value["noAutoSubmit"], "$.noAutoSubmit", false);
    check_token_array(
        &mut ctx,
        &value["failureReasonTokens"],
        "$.failureReasonTokens",
        0,
        8,
        Some(OUTCOME_FAILURE_REASONS),
    );
    if !is_true(&value["noAutoSubmit"]) {
        ctx.add(
            "safety_invariant",
            "$.noAutoSubmit",
            "prompt session events must preserve no-auto-submit",
        );
    }
    if value_is(&value["eventType"], "verified_insert")
        && (!is_true(&value["insertVerified"]) || value["outcomeId"].is_null())
    {
        ctx.add(
            "verification_invariant",
            "$",
            "verified_insert requires verified insertion and an outcome id",
        );
    }
    if value_is(&value["eventType"], "insert_failed")
        && value["insertVerified"] != Value::Bool(false)
    {
        ctx.add(
            "verification_invariant",
            "$.insertVerified",
            "insert_failed cannot be verified",
        );
    }
    if ["outcome_feedback", "outcome_expired"]
        .contains(&value["eventType"].as_str().unwrap_or_default())
        && value["outcomeId"].is_null()
    {
        ctx.add(
            "outcome_invariant",
            "$.outcomeId",
            "outcome events require an outcome id",
        );
    }
    if value_is(&value["eventType"], "outcome_expired")
        && !value_is(&value["taskOutcomeToken"], "expired_unknown")
    {
        ctx.add(
            "outcome_invariant",
            "$.taskOutcomeToken",
            "expired outcomes must remain expired_unknown",
        );
    }
    ctx.finish()
}

fn validate_codex_target_adapter_result(value: &Value) -> ValidationResult {
    let fields = [
        "contractVersion",
        "adapterResultId",
        "operation",
        "status",
        "target",
        "attempted",
        "verified",
        "verification",
        "writeMethod",
        "reasonToken",
        "publicReason",
        "foregroundVerified",
        "targetIdentityVerified",
        "focusVerified",
        "draftUnchanged",
        "payloadFresh",
        "readbackMatched",
        "clipboardRestored",
        "noAutoSubmit",
        "occurredAt",
        "privacyFlags",
    ];
    let (mut ctx, root_is_object) = prepare_contract("codex_target_adapter_result", value, &fields);
    if !root_is_object {
        return ctx.finish();
    }
    check_token(
        &mut ctx,
        &value["adapterResultId"],
        "$.adapterResultId",
        false,
    );
    check_enum(
        &mut ctx,
        &value["operation"],
        "$.operation",
        ADAPTER_OPERATIONS,
    );
    check_enum(&mut ctx, &value["status"], "$.status", ADAPTER_STATUSES);
    check_enum(&mut ctx, &value["target"], "$.target", TARGETS);
    for key in [
        "attempted",
        "verified",
        "foregroundVerified",
        "targetIdentityVerified",
        "focusVerified",
        "draftUnchanged",
        "payloadFresh",
        "readbackMatched",
        "noAutoSubmit",
    ] {
        check_bool(&mut ctx, &value[key], &format!("$.{key}"), false);
    }
    check_bool(
        &mut ctx,
        &value["clipboardRestored"],
        "$.clipboardRestored",
        true,
    );
    check_enum(
        &mut ctx,
        &value["verification"],
        "$.verification",
        VERIFICATIONS,
    );
    check_enum(
        &mut ctx,
        &value["writeMethod"],
        "$.writeMethod",
        WRITE_METHODS,
    );
    check_token(&mut ctx, &value["reasonToken"], "$.reasonToken", false);
    check_enum(
        &mut ctx,
        &value["publicReason"],
        "$.publicReason",
        PUBLIC_REASONS,
    );
    check_timestamp(&mut ctx, &value["occurredAt"], "$.occurredAt", false);
    if value["reasonToken"].as_str().is_some_and(|reason| {
        map_public_reason(reason) != value["publicReason"].as_str().unwrap_or_default()
    }) {
        ctx.add(
            "public_reason_mismatch",
            "$.publicReason",
            "public reason must be derived from the internal reason token",
        );
    }
    if !is_true(&value["noAutoSubmit"]) {
        ctx.add(
            "safety_invariant",
            "$.noAutoSubmit",
            "adapters must never permit automatic submission",
        );
    }
    if is_true(&value["verified"]) {
        let verified = value_is(&value["operation"], "insert")
            && value_is(&value["status"], "ready")
            && is_true(&value["attempted"])
            && value_is(&value["verification"], "machine")
            && ["direct", "controlled_clipboard"]
                .contains(&value["writeMethod"].as_str().unwrap_or_default())
            && [
                "foregroundVerified",
                "targetIdentityVerified",
                "focusVerified",
                "draftUnchanged",
                "payloadFresh",
                "readbackMatched",
                "noAutoSubmit",
            ]
            .iter()
            .all(|key| is_true(&value[key]));
        if !verified {
            ctx.add(
                "verification_invariant",
                "$",
                "verified insert requires all machine-readback safety guards",
            );
        }
    }
    if value_is(&value["writeMethod"], "controlled_clipboard")
        && !is_true(&value["clipboardRestored"])
    {
        ctx.add(
            "clipboard_invariant",
            "$.clipboardRestored",
            "controlled clipboard writes require verified restoration",
        );
    }
    ctx.finish()
}

fn validate_pending_outcome(value: &Value) -> ValidationResult {
    let fields = [
        "contractVersion",
        "outcomeId",
        "generationId",
        "sessionId",
        "strategyId",
        "strategyVersion",
        "target",
        "projectScopeToken",
        "modelFamilyToken",
        "createdAt",
        "eligibleAt",
        "expiresAt",
        "status",
        "insertVerified",
        "policyId",
        "policyVersion",
        "feedbackPromptedAt",
        "failureReasonTokens",
        "privacyFlags",
    ];
    let (mut ctx, root_is_object) = prepare_contract("pending_outcome", value, &fields);
    if !root_is_object {
        return ctx.finish();
    }
    for key in [
        "outcomeId",
        "generationId",
        "sessionId",
        "strategyId",
        "strategyVersion",
        "projectScopeToken",
        "modelFamilyToken",
    ] {
        check_token(&mut ctx, &value[key], &format!("$.{key}"), false);
    }
    check_enum(&mut ctx, &value["target"], "$.target", TARGETS);
    for key in ["createdAt", "eligibleAt", "expiresAt"] {
        check_timestamp(&mut ctx, &value[key], &format!("$.{key}"), false);
    }
    check_timestamp(
        &mut ctx,
        &value["feedbackPromptedAt"],
        "$.feedbackPromptedAt",
        true,
    );
    check_enum(
        &mut ctx,
        &value["status"],
        "$.status",
        PENDING_OUTCOME_STATUSES,
    );
    check_bool(
        &mut ctx,
        &value["insertVerified"],
        "$.insertVerified",
        false,
    );
    check_token(&mut ctx, &value["policyId"], "$.policyId", true);
    check_number(
        &mut ctx,
        &value["policyVersion"],
        "$.policyVersion",
        true,
        true,
        Some(1.0),
        None,
    );
    if value["policyId"].is_null() != value["policyVersion"].is_null() {
        ctx.add(
            "policy_attribution_invariant",
            "$",
            "policy attribution requires both policyId and policyVersion",
        );
    }
    check_token_array(
        &mut ctx,
        &value["failureReasonTokens"],
        "$.failureReasonTokens",
        0,
        8,
        Some(OUTCOME_FAILURE_REASONS),
    );
    let created_at = timestamp_millis(&value["createdAt"]);
    let eligible_at = timestamp_millis(&value["eligibleAt"]);
    let expires_at = timestamp_millis(&value["expiresAt"]);
    if created_at
        .zip(eligible_at)
        .is_some_and(|(created, eligible)| eligible - created < MIN_FEEDBACK_DELAY_MS)
    {
        ctx.add(
            "time_window",
            "$.eligibleAt",
            "feedback cannot become eligible before 60 seconds",
        );
    }
    if created_at
        .zip(expires_at)
        .is_some_and(|(created, expires)| expires - created != OUTCOME_TTL_MS)
    {
        ctx.add(
            "time_window",
            "$.expiresAt",
            "pending outcomes expire exactly 24 hours after creation",
        );
    }
    if let (Some(prompted), Some(eligible), Some(expires)) = (
        timestamp_millis(&value["feedbackPromptedAt"]),
        eligible_at,
        expires_at,
    ) {
        if prompted < eligible || prompted >= expires {
            ctx.add(
                "time_window",
                "$.feedbackPromptedAt",
                "feedback must be prompted after eligibility and before expiry",
            );
        }
    }
    if !is_true(&value["insertVerified"]) {
        ctx.add(
            "verification_invariant",
            "$.insertVerified",
            "only verified inserts create pending outcomes",
        );
    }
    let failure_count = value["failureReasonTokens"].as_array().map_or(0, Vec::len);
    if value_is(&value["status"], "failed") && failure_count == 0 {
        ctx.add(
            "outcome_invariant",
            "$.failureReasonTokens",
            "failed outcomes require a finite user reason",
        );
    }
    if !value_is(&value["status"], "failed") && failure_count > 0 {
        ctx.add(
            "outcome_invariant",
            "$.failureReasonTokens",
            "failure reasons are only valid for failed outcomes",
        );
    }
    ctx.finish()
}

fn validate_learning_observation(value: &Value) -> ValidationResult {
    let fields = [
        "contractVersion",
        "observationId",
        "projectScopeToken",
        "taskScenarioToken",
        "modeToken",
        "strategyId",
        "strategyVersion",
        "modelFamilyToken",
        "contextSourceTokens",
        "editFeatureSummary",
        "insertVerified",
        "retryCount",
        "undoUsed",
        "taskOutcomeToken",
        "failureReasonTokens",
        "inputTokens",
        "outputTokens",
        "cachedTokens",
        "reasoningTokens",
        "insertedPromptTokenEstimate",
        "latencyMs",
        "tokenAccountingSource",
        "semanticFingerprint",
        "privacyFlags",
        "createdAt",
    ];
    let (mut ctx, root_is_object) = prepare_contract("learning_observation", value, &fields);
    if !root_is_object {
        return ctx.finish();
    }
    for key in [
        "observationId",
        "projectScopeToken",
        "taskScenarioToken",
        "modeToken",
        "strategyId",
        "strategyVersion",
        "modelFamilyToken",
    ] {
        check_token(&mut ctx, &value[key], &format!("$.{key}"), false);
    }
    check_token_array(
        &mut ctx,
        &value["contextSourceTokens"],
        "$.contextSourceTokens",
        0,
        16,
        None,
    );
    let edit_fields = ["userEdited", "lengthDeltaBucket", "structureChanged"];
    if check_object(
        &mut ctx,
        &value["editFeatureSummary"],
        "$.editFeatureSummary",
        &edit_fields,
        &edit_fields,
    )
    .is_some()
    {
        check_bool(
            &mut ctx,
            &value["editFeatureSummary"]["userEdited"],
            "$.editFeatureSummary.userEdited",
            false,
        );
        check_enum(
            &mut ctx,
            &value["editFeatureSummary"]["lengthDeltaBucket"],
            "$.editFeatureSummary.lengthDeltaBucket",
            EDIT_LENGTH_DELTA_BUCKETS,
        );
        check_bool(
            &mut ctx,
            &value["editFeatureSummary"]["structureChanged"],
            "$.editFeatureSummary.structureChanged",
            false,
        );
    }
    check_bool(
        &mut ctx,
        &value["insertVerified"],
        "$.insertVerified",
        false,
    );
    check_number(
        &mut ctx,
        &value["retryCount"],
        "$.retryCount",
        false,
        true,
        Some(0.0),
        None,
    );
    check_bool(&mut ctx, &value["undoUsed"], "$.undoUsed", false);
    check_enum(
        &mut ctx,
        &value["taskOutcomeToken"],
        "$.taskOutcomeToken",
        TASK_OUTCOMES,
    );
    check_token_array(
        &mut ctx,
        &value["failureReasonTokens"],
        "$.failureReasonTokens",
        0,
        8,
        Some(OUTCOME_FAILURE_REASONS),
    );
    let token_fields = [
        "inputTokens",
        "outputTokens",
        "cachedTokens",
        "reasoningTokens",
        "insertedPromptTokenEstimate",
    ];
    for key in token_fields {
        check_number(
            &mut ctx,
            &value[key],
            &format!("$.{key}"),
            true,
            true,
            Some(0.0),
            None,
        );
    }
    check_number(
        &mut ctx,
        &value["latencyMs"],
        "$.latencyMs",
        false,
        true,
        Some(0.0),
        None,
    );
    check_enum(
        &mut ctx,
        &value["tokenAccountingSource"],
        "$.tokenAccountingSource",
        TOKEN_ACCOUNTING_SOURCES,
    );
    check_timestamp(&mut ctx, &value["createdAt"], "$.createdAt", false);
    validate_semantic_fingerprint(
        &mut ctx,
        &value["semanticFingerprint"],
        "$.semanticFingerprint",
    );
    if value_is(&value["tokenAccountingSource"], "unavailable")
        && token_fields.iter().any(|key| !value[key].is_null())
    {
        ctx.add(
            "token_accounting",
            "$",
            "unavailable token accounting cannot contain numeric token claims",
        );
    }
    if !value_is(&value["tokenAccountingSource"], "unavailable")
        && value["inputTokens"].is_null()
        && value["outputTokens"].is_null()
    {
        ctx.add(
            "token_accounting",
            "$",
            "provider or estimated accounting requires input or output tokens",
        );
    }
    if value_is(&value["taskOutcomeToken"], "completed")
        && value["failureReasonTokens"]
            .as_array()
            .is_some_and(|reasons| !reasons.is_empty())
    {
        ctx.add(
            "outcome_invariant",
            "$.failureReasonTokens",
            "completed outcomes cannot carry failure reasons",
        );
    }
    ctx.finish()
}

fn validate_artifact_payload(ctx: &mut ValidationContext, artifact_type: &Value, payload: &Value) {
    match artifact_type.as_str() {
        Some("memory") => {
            let fields = ["category", "statement"];
            if check_object(ctx, payload, "$.payload", &fields, &fields).is_some() {
                check_token(ctx, &payload["category"], "$.payload.category", false);
                check_string(
                    ctx,
                    &payload["statement"],
                    "$.payload.statement",
                    false,
                    600,
                );
            }
        }
        Some("rule") => {
            let fields = ["directive", "taskScenarioTokens"];
            if check_object(ctx, payload, "$.payload", &fields, &fields).is_some() {
                check_string(
                    ctx,
                    &payload["directive"],
                    "$.payload.directive",
                    false,
                    600,
                );
                check_token_array(
                    ctx,
                    &payload["taskScenarioTokens"],
                    "$.payload.taskScenarioTokens",
                    1,
                    16,
                    None,
                );
            }
        }
        Some("skill") => {
            let fields = [
                "triggerConditionTokens",
                "stepTokens",
                "verificationTokens",
                "resourceTokens",
                "permissionTokens",
                "failureRecoveryTokens",
                "scriptsExecutable",
                "permissionCheckPassed",
                "isolationTestPassed",
                "adversarialReviewPassed",
            ];
            if check_object(ctx, payload, "$.payload", &fields, &fields).is_some() {
                for key in &fields[..6] {
                    check_token_array(ctx, &payload[key], &format!("$.payload.{key}"), 1, 32, None);
                }
                for key in &fields[6..] {
                    check_bool(ctx, &payload[key], &format!("$.payload.{key}"), false);
                }
                if payload["scriptsExecutable"] != Value::Bool(false) {
                    ctx.add(
                        "skill_execution_policy",
                        "$.payload.scriptsExecutable",
                        "generated skill scripts are not executable by default",
                    );
                }
            }
        }
        Some("generation_policy") => {
            let fields = ["policyId", "policyVersion"];
            if check_object(ctx, payload, "$.payload", &fields, &fields).is_some() {
                check_token(ctx, &payload["policyId"], "$.payload.policyId", false);
                check_number(
                    ctx,
                    &payload["policyVersion"],
                    "$.payload.policyVersion",
                    false,
                    true,
                    Some(1.0),
                    None,
                );
            }
        }
        _ => {
            if !payload.is_object() {
                ctx.add("type", "$.payload", "expected an object");
            }
        }
    }
}

fn validate_learning_artifact(value: &Value) -> ValidationResult {
    let fields = [
        "contractVersion",
        "artifactId",
        "artifactType",
        "status",
        "scope",
        "payload",
        "evidenceSummary",
        "permissions",
        "review",
        "autoCreated",
        "effective",
        "createdAt",
        "updatedAt",
        "privacyFlags",
    ];
    let (mut ctx, root_is_object) = prepare_contract("learning_artifact", value, &fields);
    if !root_is_object {
        return ctx.finish();
    }
    check_token(&mut ctx, &value["artifactId"], "$.artifactId", false);
    check_enum(
        &mut ctx,
        &value["artifactType"],
        "$.artifactType",
        ARTIFACT_TYPES,
    );
    check_enum(&mut ctx, &value["status"], "$.status", ARTIFACT_STATUSES);
    let scope_fields = ["kind", "projectScopeToken"];
    if check_object(
        &mut ctx,
        &value["scope"],
        "$.scope",
        &scope_fields,
        &scope_fields,
    )
    .is_some()
    {
        check_enum(
            &mut ctx,
            &value["scope"]["kind"],
            "$.scope.kind",
            ARTIFACT_SCOPES,
        );
        check_token(
            &mut ctx,
            &value["scope"]["projectScopeToken"],
            "$.scope.projectScopeToken",
            value_is(&value["scope"]["kind"], "global"),
        );
    }
    validate_artifact_payload(&mut ctx, &value["artifactType"], &value["payload"]);
    let evidence_fields = [
        "sessionCount",
        "successfulOutcomeCount",
        "explicitNegativeFeedbackCount",
        "evidenceTokenCount",
    ];
    if check_object(
        &mut ctx,
        &value["evidenceSummary"],
        "$.evidenceSummary",
        &evidence_fields,
        &evidence_fields,
    )
    .is_some()
    {
        for key in evidence_fields {
            check_number(
                &mut ctx,
                &value["evidenceSummary"][key],
                &format!("$.evidenceSummary.{key}"),
                false,
                true,
                Some(0.0),
                None,
            );
        }
    }
    let permission_fields = ["execution", "scopeExpansion"];
    if check_object(
        &mut ctx,
        &value["permissions"],
        "$.permissions",
        &permission_fields,
        &permission_fields,
    )
    .is_some()
    {
        check_enum(
            &mut ctx,
            &value["permissions"]["execution"],
            "$.permissions.execution",
            EXECUTION_PERMISSIONS,
        );
        check_enum(
            &mut ctx,
            &value["permissions"]["scopeExpansion"],
            "$.permissions.scopeExpansion",
            SCOPE_EXPANSION_PERMISSIONS,
        );
    }
    let review_fields = ["required", "decision", "ignoredCount"];
    if check_object(
        &mut ctx,
        &value["review"],
        "$.review",
        &review_fields,
        &review_fields,
    )
    .is_some()
    {
        check_bool(
            &mut ctx,
            &value["review"]["required"],
            "$.review.required",
            false,
        );
        check_enum(
            &mut ctx,
            &value["review"]["decision"],
            "$.review.decision",
            REVIEW_DECISIONS,
        );
        check_number(
            &mut ctx,
            &value["review"]["ignoredCount"],
            "$.review.ignoredCount",
            false,
            true,
            Some(0.0),
            Some(3.0),
        );
    }
    check_bool(&mut ctx, &value["autoCreated"], "$.autoCreated", false);
    check_bool(&mut ctx, &value["effective"], "$.effective", false);
    check_timestamp(&mut ctx, &value["createdAt"], "$.createdAt", false);
    check_timestamp(&mut ctx, &value["updatedAt"], "$.updatedAt", false);
    if is_true(&value["autoCreated"]) {
        let evidence = &value["evidenceSummary"];
        let threshold_met = evidence["sessionCount"].as_i64().unwrap_or_default() >= 2
            && evidence["successfulOutcomeCount"]
                .as_i64()
                .unwrap_or_default()
                >= 3
            && evidence["explicitNegativeFeedbackCount"].as_i64() == Some(0)
            && value_is(&value["scope"]["kind"], "project");
        if !threshold_met {
            ctx.add(
                "candidate_threshold",
                "$.evidenceSummary",
                "auto-created project candidates require two sessions and three successes",
            );
        }
        if !value_is(&value["status"], "pending_review") || value["effective"] != Value::Bool(false)
        {
            ctx.add(
                "candidate_activation",
                "$",
                "auto-created candidates remain pending and ineffective until review",
            );
        }
    }
    if is_true(&value["effective"])
        && (!value_is(&value["status"], "active")
            || !value_is(&value["review"]["decision"], "accepted"))
    {
        ctx.add(
            "candidate_activation",
            "$.effective",
            "only accepted active artifacts may be effective",
        );
    }
    ctx.finish()
}

fn validate_generation_policy(value: &Value) -> ValidationResult {
    let fields = [
        "contractVersion",
        "policyId",
        "version",
        "scope",
        "selectedStrategy",
        "directives",
        "contextBudget",
        "evidenceSummary",
        "baselineVersion",
        "status",
        "riskLevel",
        "automaticRolloutEligible",
        "createdAt",
        "privacyFlags",
    ];
    let (mut ctx, root_is_object) = prepare_contract("generation_policy", value, &fields);
    if !root_is_object {
        return ctx.finish();
    }
    check_token(&mut ctx, &value["policyId"], "$.policyId", false);
    check_number(
        &mut ctx,
        &value["version"],
        "$.version",
        false,
        true,
        Some(1.0),
        None,
    );
    let scope_fields = [
        "kind",
        "target",
        "projectScopeToken",
        "taskScenarioToken",
        "modelFamilyToken",
    ];
    if check_object(
        &mut ctx,
        &value["scope"],
        "$.scope",
        &scope_fields,
        &scope_fields,
    )
    .is_some()
    {
        check_enum(
            &mut ctx,
            &value["scope"]["kind"],
            "$.scope.kind",
            ARTIFACT_SCOPES,
        );
        check_enum(
            &mut ctx,
            &value["scope"]["target"],
            "$.scope.target",
            TARGETS,
        );
        for key in ["projectScopeToken", "taskScenarioToken", "modelFamilyToken"] {
            check_token(
                &mut ctx,
                &value["scope"][key],
                &format!("$.scope.{key}"),
                false,
            );
        }
    }
    let strategy_fields = ["strategyId", "strategyVersion"];
    if check_object(
        &mut ctx,
        &value["selectedStrategy"],
        "$.selectedStrategy",
        &strategy_fields,
        &strategy_fields,
    )
    .is_some()
    {
        for key in strategy_fields {
            check_token(
                &mut ctx,
                &value["selectedStrategy"][key],
                &format!("$.selectedStrategy.{key}"),
                false,
            );
        }
    }
    if let Some(directives) = value["directives"].as_array() {
        if directives.len() > 8 {
            ctx.add(
                "range",
                "$.directives",
                "policies may contain at most eight directives",
            );
        }
        let directive_fields = ["directiveId", "kind", "valueToken", "priority"];
        for (index, directive) in directives.iter().enumerate() {
            let path = index_path("$.directives", index);
            if check_object(
                &mut ctx,
                directive,
                &path,
                &directive_fields,
                &directive_fields,
            )
            .is_some()
            {
                check_token(
                    &mut ctx,
                    &directive["directiveId"],
                    &child_path(&path, "directiveId"),
                    false,
                );
                check_enum(
                    &mut ctx,
                    &directive["kind"],
                    &child_path(&path, "kind"),
                    POLICY_DIRECTIVE_KINDS,
                );
                check_token(
                    &mut ctx,
                    &directive["valueToken"],
                    &child_path(&path, "valueToken"),
                    false,
                );
                check_number(
                    &mut ctx,
                    &directive["priority"],
                    &child_path(&path, "priority"),
                    false,
                    true,
                    Some(1.0),
                    Some(8.0),
                );
            }
        }
    } else {
        ctx.add("type", "$.directives", "expected an array");
    }
    let budget_fields = ["maxInputTokens", "maxContextSourceTokens"];
    if check_object(
        &mut ctx,
        &value["contextBudget"],
        "$.contextBudget",
        &budget_fields,
        &budget_fields,
    )
    .is_some()
    {
        for key in budget_fields {
            check_number(
                &mut ctx,
                &value["contextBudget"][key],
                &format!("$.contextBudget.{key}"),
                false,
                true,
                Some(0.0),
                None,
            );
        }
        if value["contextBudget"]["maxContextSourceTokens"]
            .as_f64()
            .unwrap_or(0.0)
            > value["contextBudget"]["maxInputTokens"]
                .as_f64()
                .unwrap_or(0.0)
        {
            ctx.add(
                "budget_invariant",
                "$.contextBudget",
                "context-source budget cannot exceed total input budget",
            );
        }
    }
    validate_generation_evidence(&mut ctx, &value["evidenceSummary"]);
    check_number(
        &mut ctx,
        &value["baselineVersion"],
        "$.baselineVersion",
        false,
        true,
        Some(1.0),
        None,
    );
    check_enum(
        &mut ctx,
        &value["status"],
        "$.status",
        GENERATION_POLICY_STATUSES,
    );
    check_enum(
        &mut ctx,
        &value["riskLevel"],
        "$.riskLevel",
        POLICY_RISK_LEVELS,
    );
    check_bool(
        &mut ctx,
        &value["automaticRolloutEligible"],
        "$.automaticRolloutEligible",
        false,
    );
    check_timestamp(&mut ctx, &value["createdAt"], "$.createdAt", false);
    if is_true(&value["automaticRolloutEligible"])
        && (!value_is(&value["riskLevel"], "low") || !value_is(&value["scope"]["kind"], "project"))
    {
        ctx.add(
            "rollout_eligibility",
            "$.automaticRolloutEligible",
            "only low-risk project policies are eligible for automatic rollout",
        );
    }
    ctx.finish()
}

fn validate_generation_evidence(ctx: &mut ValidationContext, value: &Value) {
    let fields = [
        "attributableOutcomeCount",
        "successfulOutcomeCount",
        "negativeOutcomeCount",
        "retryRate",
        "undoRate",
        "tokenDeltaRatio",
        "evidenceTokenCount",
    ];
    if check_object(ctx, value, "$.evidenceSummary", &fields, &fields).is_none() {
        return;
    }
    for key in [
        "attributableOutcomeCount",
        "successfulOutcomeCount",
        "negativeOutcomeCount",
        "evidenceTokenCount",
    ] {
        check_number(
            ctx,
            &value[key],
            &format!("$.evidenceSummary.{key}"),
            false,
            true,
            Some(0.0),
            None,
        );
    }
    for key in ["retryRate", "undoRate"] {
        check_number(
            ctx,
            &value[key],
            &format!("$.evidenceSummary.{key}"),
            false,
            false,
            Some(0.0),
            Some(1.0),
        );
    }
    check_number(
        ctx,
        &value["tokenDeltaRatio"],
        "$.evidenceSummary.tokenDeltaRatio",
        false,
        false,
        Some(-1.0),
        Some(10.0),
    );
}

fn validate_rollout_arm(ctx: &mut ValidationContext, value: &Value, path: &str) {
    let fields = [
        "attributableOutcomes",
        "successRate",
        "retryRate",
        "undoRate",
        "averageTokens",
        "averageLatencyMs",
        "averageReworkCount",
    ];
    if check_object(ctx, value, path, &fields, &fields).is_none() {
        return;
    }
    check_number(
        ctx,
        &value["attributableOutcomes"],
        &child_path(path, "attributableOutcomes"),
        false,
        true,
        Some(0.0),
        None,
    );
    for key in ["successRate", "retryRate", "undoRate"] {
        check_number(
            ctx,
            &value[key],
            &child_path(path, key),
            false,
            false,
            Some(0.0),
            Some(1.0),
        );
    }
    for key in ["averageTokens", "averageLatencyMs", "averageReworkCount"] {
        check_number(
            ctx,
            &value[key],
            &child_path(path, key),
            false,
            false,
            Some(0.0),
            None,
        );
    }
}

fn validate_policy_rollout(value: &Value) -> ValidationResult {
    let fields = [
        "contractVersion",
        "rolloutId",
        "policyId",
        "policyVersion",
        "baselineVersion",
        "projectScopeToken",
        "status",
        "canaryShareBps",
        "minimums",
        "arms",
        "gates",
        "rollbackReasonToken",
        "startedAt",
        "endedAt",
        "privacyFlags",
    ];
    let (mut ctx, root_is_object) = prepare_contract("policy_rollout", value, &fields);
    if !root_is_object {
        return ctx.finish();
    }
    for key in ["rolloutId", "policyId", "projectScopeToken"] {
        check_token(&mut ctx, &value[key], &format!("$.{key}"), false);
    }
    for key in ["policyVersion", "baselineVersion"] {
        check_number(
            &mut ctx,
            &value[key],
            &format!("$.{key}"),
            false,
            true,
            Some(1.0),
            None,
        );
    }
    check_enum(
        &mut ctx,
        &value["status"],
        "$.status",
        POLICY_ROLLOUT_STATUSES,
    );
    check_number(
        &mut ctx,
        &value["canaryShareBps"],
        "$.canaryShareBps",
        false,
        true,
        Some(1.0),
        Some(10_000.0),
    );
    let minimum_fields = [
        "perArmAttributableOutcomes",
        "tokenImprovementRatio",
        "minimumEffectRatio",
        "confidenceThreshold",
    ];
    if check_object(
        &mut ctx,
        &value["minimums"],
        "$.minimums",
        &minimum_fields,
        &minimum_fields,
    )
    .is_some()
    {
        check_number(
            &mut ctx,
            &value["minimums"]["perArmAttributableOutcomes"],
            "$.minimums.perArmAttributableOutcomes",
            false,
            true,
            Some(10.0),
            None,
        );
        for (key, min) in [
            ("tokenImprovementRatio", 0.05),
            ("minimumEffectRatio", 0.0),
            ("confidenceThreshold", 0.0),
        ] {
            check_number(
                &mut ctx,
                &value["minimums"][key],
                &format!("$.minimums.{key}"),
                false,
                false,
                Some(min),
                Some(1.0),
            );
        }
    }
    let arm_fields = ["baseline", "candidate"];
    if check_object(&mut ctx, &value["arms"], "$.arms", &arm_fields, &arm_fields).is_some() {
        validate_rollout_arm(&mut ctx, &value["arms"]["baseline"], "$.arms.baseline");
        validate_rollout_arm(&mut ctx, &value["arms"]["candidate"], "$.arms.candidate");
    }
    let gate_fields = [
        "benchmarkPassed",
        "taskQualityNotDegraded",
        "retryUndoNotDegraded",
        "efficiencyImproved",
        "statisticalRequirementMet",
        "safetyIncidentCount",
        "privacyIncidentCount",
        "permissionIncidentCount",
        "autoSubmitIncidentCount",
        "miswriteIncidentCount",
    ];
    if check_object(
        &mut ctx,
        &value["gates"],
        "$.gates",
        &gate_fields,
        &gate_fields,
    )
    .is_some()
    {
        for key in &gate_fields[..5] {
            check_bool(
                &mut ctx,
                &value["gates"][key],
                &format!("$.gates.{key}"),
                false,
            );
        }
        for key in &gate_fields[5..] {
            check_number(
                &mut ctx,
                &value["gates"][key],
                &format!("$.gates.{key}"),
                false,
                true,
                Some(0.0),
                None,
            );
        }
    }
    check_enum(
        &mut ctx,
        &value["rollbackReasonToken"],
        "$.rollbackReasonToken",
        ROLLBACK_REASONS,
    );
    check_timestamp(&mut ctx, &value["startedAt"], "$.startedAt", false);
    check_timestamp(&mut ctx, &value["endedAt"], "$.endedAt", true);
    let incident_count: i64 = gate_fields[5..]
        .iter()
        .map(|key| value["gates"][key].as_i64().unwrap_or_default())
        .sum();
    if incident_count > 0 && !value_is(&value["status"], "rolled_back") {
        ctx.add(
            "rollback_gate",
            "$.status",
            "safety, privacy, permission, auto-submit, or miswrite incidents require rollback",
        );
    }
    if value_is(&value["status"], "rolled_back") && value_is(&value["rollbackReasonToken"], "none")
    {
        ctx.add(
            "rollback_gate",
            "$.rollbackReasonToken",
            "rolled-back policies require a finite rollback reason",
        );
    }
    if value_is(&value["status"], "promoted") {
        let minimum = value["minimums"]["perArmAttributableOutcomes"]
            .as_i64()
            .unwrap_or(10);
        let enough_samples = value["arms"]["baseline"]["attributableOutcomes"]
            .as_i64()
            .unwrap_or_default()
            >= minimum
            && value["arms"]["candidate"]["attributableOutcomes"]
                .as_i64()
                .unwrap_or_default()
                >= minimum;
        let passed_gates = gate_fields[..5]
            .iter()
            .all(|key| is_true(&value["gates"][key]))
            && incident_count == 0;
        if !enough_samples || !passed_gates {
            ctx.add(
                "rollout_gate",
                "$.status",
                "promotion requires samples, quality, safety, efficiency, and statistical confidence gates",
            );
        }
    }
    ctx.finish()
}

fn validate_benchmark_arm(ctx: &mut ValidationContext, value: &Value, path: &str) {
    let fields = [
        "completedTasks",
        "safetyPassedTasks",
        "totalTokens",
        "totalDurationMs",
        "totalRetries",
        "totalToolCalls",
    ];
    if check_object(ctx, value, path, &fields, &fields).is_none() {
        return;
    }
    for key in fields {
        check_number(
            ctx,
            &value[key],
            &child_path(path, key),
            false,
            true,
            Some(0.0),
            None,
        );
    }
}

fn validate_benchmark_result(value: &Value) -> ValidationResult {
    let fields = [
        "contractVersion",
        "benchmarkId",
        "status",
        "executor",
        "initiatedBy",
        "authorization",
        "modelFamilyToken",
        "fixtureSetToken",
        "taskCount",
        "categoryCounts",
        "comparability",
        "budget",
        "arms",
        "safety",
        "startedAt",
        "finishedAt",
        "publicReason",
        "privacyFlags",
    ];
    let (mut ctx, root_is_object) = prepare_contract("benchmark_result", value, &fields);
    if !root_is_object {
        return ctx.finish();
    }
    check_token(&mut ctx, &value["benchmarkId"], "$.benchmarkId", false);
    check_enum(&mut ctx, &value["status"], "$.status", BENCHMARK_STATUSES);
    check_enum(
        &mut ctx,
        &value["executor"],
        "$.executor",
        BENCHMARK_EXECUTORS,
    );
    check_enum(
        &mut ctx,
        &value["initiatedBy"],
        "$.initiatedBy",
        BENCHMARK_INITIATORS,
    );
    let authorization_fields = ["required", "granted"];
    if check_object(
        &mut ctx,
        &value["authorization"],
        "$.authorization",
        &authorization_fields,
        &authorization_fields,
    )
    .is_some()
    {
        for key in authorization_fields {
            check_bool(
                &mut ctx,
                &value["authorization"][key],
                &format!("$.authorization.{key}"),
                false,
            );
        }
    }
    check_token(
        &mut ctx,
        &value["modelFamilyToken"],
        "$.modelFamilyToken",
        false,
    );
    check_token(
        &mut ctx,
        &value["fixtureSetToken"],
        "$.fixtureSetToken",
        false,
    );
    check_number(
        &mut ctx,
        &value["taskCount"],
        "$.taskCount",
        false,
        true,
        Some(0.0),
        None,
    );
    if check_object(
        &mut ctx,
        &value["categoryCounts"],
        "$.categoryCounts",
        BENCHMARK_CATEGORIES,
        BENCHMARK_CATEGORIES,
    )
    .is_some()
    {
        for category in BENCHMARK_CATEGORIES {
            check_number(
                &mut ctx,
                &value["categoryCounts"][category],
                &format!("$.categoryCounts.{category}"),
                false,
                true,
                Some(0.0),
                None,
            );
        }
    }
    let comparability_fields = [
        "sameModelFamily",
        "sameStartingPoint",
        "samePermissions",
        "sameBudget",
        "deterministicAcceptance",
    ];
    if check_object(
        &mut ctx,
        &value["comparability"],
        "$.comparability",
        &comparability_fields,
        &comparability_fields,
    )
    .is_some()
    {
        for key in comparability_fields {
            check_bool(
                &mut ctx,
                &value["comparability"][key],
                &format!("$.comparability.{key}"),
                false,
            );
        }
    }
    let budget_fields = [
        "tokenLimit",
        "maxAgentTurns",
        "maxRetries",
        "estimatedCostMicros",
        "consumedTokens",
        "exhausted",
    ];
    if check_object(
        &mut ctx,
        &value["budget"],
        "$.budget",
        &budget_fields,
        &budget_fields,
    )
    .is_some()
    {
        for key in &budget_fields[..5] {
            check_number(
                &mut ctx,
                &value["budget"][key],
                &format!("$.budget.{key}"),
                false,
                true,
                Some(0.0),
                None,
            );
        }
        check_bool(
            &mut ctx,
            &value["budget"]["exhausted"],
            "$.budget.exhausted",
            false,
        );
        if value["budget"]["consumedTokens"]
            .as_i64()
            .unwrap_or_default()
            > value["budget"]["tokenLimit"].as_i64().unwrap_or_default()
            && !is_true(&value["budget"]["exhausted"])
        {
            ctx.add(
                "budget_invariant",
                "$.budget",
                "token consumption above the hard limit must be marked exhausted",
            );
        }
    }
    let arm_fields = ["baseline", "candidate"];
    if check_object(&mut ctx, &value["arms"], "$.arms", &arm_fields, &arm_fields).is_some() {
        validate_benchmark_arm(&mut ctx, &value["arms"]["baseline"], "$.arms.baseline");
        validate_benchmark_arm(&mut ctx, &value["arms"]["candidate"], "$.arms.candidate");
    }
    let safety_fields = [
        "qualityGatePassed",
        "noAutoSubmitPassed",
        "privacyPassed",
        "permissionPassed",
    ];
    if check_object(
        &mut ctx,
        &value["safety"],
        "$.safety",
        &safety_fields,
        &safety_fields,
    )
    .is_some()
    {
        for key in safety_fields {
            check_bool(
                &mut ctx,
                &value["safety"][key],
                &format!("$.safety.{key}"),
                false,
            );
        }
    }
    check_timestamp(&mut ctx, &value["startedAt"], "$.startedAt", true);
    check_timestamp(&mut ctx, &value["finishedAt"], "$.finishedAt", true);
    check_enum(
        &mut ctx,
        &value["publicReason"],
        "$.publicReason",
        PUBLIC_REASONS,
    );
    if value_is(&value["executor"], "codex")
        && (!is_true(&value["authorization"]["required"])
            || !is_true(&value["authorization"]["granted"])
            || !value_is(&value["initiatedBy"], "user"))
    {
        ctx.add(
            "authorization_gate",
            "$.authorization",
            "the real Codex executor requires explicit user authorization for this run",
        );
    }
    if value_is(&value["executor"], "fake")
        && value["budget"]["estimatedCostMicros"].as_i64() != Some(0)
    {
        ctx.add(
            "budget_invariant",
            "$.budget.estimatedCostMicros",
            "fake executor fixtures cannot claim model cost",
        );
    }
    if value_is(&value["status"], "passed") {
        let category_total: i64 = BENCHMARK_CATEGORIES
            .iter()
            .map(|category| {
                value["categoryCounts"][category]
                    .as_i64()
                    .unwrap_or_default()
            })
            .sum();
        let category_coverage = BENCHMARK_CATEGORIES.iter().all(|category| {
            value["categoryCounts"][category]
                .as_i64()
                .unwrap_or_default()
                >= 2
        });
        let comparable = comparability_fields
            .iter()
            .all(|key| is_true(&value["comparability"][key]));
        let safe = safety_fields
            .iter()
            .all(|key| is_true(&value["safety"][key]));
        if value["taskCount"].as_i64().unwrap_or_default() < 12
            || category_total != value["taskCount"].as_i64().unwrap_or_default()
            || !category_coverage
            || !comparable
            || !safe
            || value["finishedAt"].is_null()
        {
            ctx.add(
                "benchmark_gate",
                "$.status",
                "passing requires category coverage, comparable arms, and all safety gates",
            );
        }
        if !value_is(&value["publicReason"], "none") {
            ctx.add(
                "public_reason_mismatch",
                "$.publicReason",
                "passing benchmark results use public reason none",
            );
        }
    }
    if value_is(&value["status"], "budget_exhausted")
        && (!is_true(&value["budget"]["exhausted"])
            || !value_is(&value["publicReason"], "budget_exhausted"))
    {
        ctx.add(
            "budget_invariant",
            "$.status",
            "budget exhaustion must be represented explicitly",
        );
    }
    ctx.finish()
}

fn validate_runtime_evidence(value: &Value) -> ValidationResult {
    let fields = [
        "contractVersion",
        "evidenceId",
        "kind",
        "consumer",
        "status",
        "buildId",
        "observedAt",
        "contractVersions",
        "checkTokens",
        "checks",
        "evidenceDigest",
        "publicReason",
        "privacyFlags",
    ];
    let (mut ctx, root_is_object) = prepare_contract("runtime_evidence", value, &fields);
    if !root_is_object {
        return ctx.finish();
    }
    for key in ["evidenceId", "buildId"] {
        check_token(&mut ctx, &value[key], &format!("$.{key}"), false);
    }
    check_enum(&mut ctx, &value["kind"], "$.kind", RUNTIME_EVIDENCE_KINDS);
    check_enum(
        &mut ctx,
        &value["consumer"],
        "$.consumer",
        RUNTIME_CONSUMERS,
    );
    check_enum(
        &mut ctx,
        &value["status"],
        "$.status",
        RUNTIME_EVIDENCE_STATUSES,
    );
    check_timestamp(&mut ctx, &value["observedAt"], "$.observedAt", false);
    let version_keys: Vec<&str> = CONTRACT_VERSIONS.iter().map(|(name, _)| *name).collect();
    if check_object(
        &mut ctx,
        &value["contractVersions"],
        "$.contractVersions",
        &version_keys,
        &version_keys,
    )
    .is_some()
    {
        for (name, version) in CONTRACT_VERSIONS {
            if value["contractVersions"][name].as_str() != Some(version) {
                ctx.add(
                    "contract_version",
                    format!("$.contractVersions.{name}"),
                    format!("expected {version}"),
                );
            }
        }
    }
    check_token_array(
        &mut ctx,
        &value["checkTokens"],
        "$.checkTokens",
        1,
        32,
        None,
    );
    let check_fields = [
        "contractParsed",
        "fixturesPassed",
        "machineReadbackVerified",
        "noAutoSubmitVerified",
        "privacyScanPassed",
    ];
    if check_object(
        &mut ctx,
        &value["checks"],
        "$.checks",
        &check_fields,
        &check_fields,
    )
    .is_some()
    {
        for key in check_fields {
            check_bool(
                &mut ctx,
                &value["checks"][key],
                &format!("$.checks.{key}"),
                false,
            );
        }
    }
    check_string(
        &mut ctx,
        &value["evidenceDigest"],
        "$.evidenceDigest",
        false,
        64,
    );
    if !is_lower_hex_64(value["evidenceDigest"].as_str().unwrap_or_default()) {
        ctx.add(
            "digest_format",
            "$.evidenceDigest",
            "evidence digest must be a lowercase SHA-256 token",
        );
    }
    check_enum(
        &mut ctx,
        &value["publicReason"],
        "$.publicReason",
        PUBLIC_REASONS,
    );
    if value_is(&value["status"], "pass") && !value_is(&value["publicReason"], "none") {
        ctx.add(
            "public_reason_mismatch",
            "$.publicReason",
            "passing runtime evidence uses public reason none",
        );
    }
    if value_is(&value["status"], "pass")
        && (!is_true(&value["checks"]["contractParsed"])
            || !is_true(&value["checks"]["privacyScanPassed"]))
    {
        ctx.add(
            "runtime_evidence_gate",
            "$.checks",
            "passing runtime evidence requires parsed contracts and a privacy scan",
        );
    }
    ctx.finish()
}

fn validate_context_source(value: &Value) -> ValidationResult {
    let fields = [
        "contractVersion",
        "contextSourceId",
        "sourceType",
        "enabled",
        "permissionStatus",
        "trustLevel",
        "independentAuthorizationRequired",
        "preview",
        "tokenBudget",
        "collectResult",
        "executionPermissionsExpanded",
        "createdAt",
        "privacyFlags",
    ];
    let (mut ctx, root_is_object) = prepare_contract("context_source", value, &fields);
    if !root_is_object {
        return ctx.finish();
    }
    check_token(
        &mut ctx,
        &value["contextSourceId"],
        "$.contextSourceId",
        false,
    );
    check_enum(
        &mut ctx,
        &value["sourceType"],
        "$.sourceType",
        CONTEXT_SOURCE_TYPES,
    );
    check_bool(&mut ctx, &value["enabled"], "$.enabled", false);
    check_enum(
        &mut ctx,
        &value["permissionStatus"],
        "$.permissionStatus",
        CONTEXT_PERMISSION_STATUSES,
    );
    check_enum(
        &mut ctx,
        &value["trustLevel"],
        "$.trustLevel",
        CONTEXT_TRUST_LEVELS,
    );
    check_bool(
        &mut ctx,
        &value["independentAuthorizationRequired"],
        "$.independentAuthorizationRequired",
        false,
    );
    let preview_fields = [
        "status",
        "itemCount",
        "tokenEstimate",
        "removable",
        "reviewed",
    ];
    if check_object(
        &mut ctx,
        &value["preview"],
        "$.preview",
        &preview_fields,
        &preview_fields,
    )
    .is_some()
    {
        check_enum(
            &mut ctx,
            &value["preview"]["status"],
            "$.preview.status",
            CONTEXT_PREVIEW_STATUSES,
        );
        for key in ["itemCount", "tokenEstimate"] {
            check_number(
                &mut ctx,
                &value["preview"][key],
                &format!("$.preview.{key}"),
                false,
                true,
                Some(0.0),
                None,
            );
        }
        for key in ["removable", "reviewed"] {
            check_bool(
                &mut ctx,
                &value["preview"][key],
                &format!("$.preview.{key}"),
                false,
            );
        }
    }
    check_number(
        &mut ctx,
        &value["tokenBudget"],
        "$.tokenBudget",
        false,
        true,
        Some(0.0),
        None,
    );
    let collect_fields = [
        "status",
        "itemCount",
        "tokenCount",
        "contentHandleToken",
        "promptInjectionRisk",
    ];
    if check_object(
        &mut ctx,
        &value["collectResult"],
        "$.collectResult",
        &collect_fields,
        &collect_fields,
    )
    .is_some()
    {
        check_enum(
            &mut ctx,
            &value["collectResult"]["status"],
            "$.collectResult.status",
            CONTEXT_COLLECT_STATUSES,
        );
        for key in ["itemCount", "tokenCount"] {
            check_number(
                &mut ctx,
                &value["collectResult"][key],
                &format!("$.collectResult.{key}"),
                false,
                true,
                Some(0.0),
                None,
            );
        }
        check_token(
            &mut ctx,
            &value["collectResult"]["contentHandleToken"],
            "$.collectResult.contentHandleToken",
            true,
        );
        check_enum(
            &mut ctx,
            &value["collectResult"]["promptInjectionRisk"],
            "$.collectResult.promptInjectionRisk",
            PROMPT_INJECTION_RISKS,
        );
    }
    check_bool(
        &mut ctx,
        &value["executionPermissionsExpanded"],
        "$.executionPermissionsExpanded",
        false,
    );
    check_timestamp(&mut ctx, &value["createdAt"], "$.createdAt", false);
    if is_true(&value["enabled"]) && !value_is(&value["permissionStatus"], "granted") {
        ctx.add(
            "permission_gate",
            "$.permissionStatus",
            "every context source requires independent authorization before enablement",
        );
    }
    if !is_true(&value["independentAuthorizationRequired"]) {
        ctx.add(
            "permission_gate",
            "$.independentAuthorizationRequired",
            "independent authorization cannot be bypassed",
        );
    }
    if !value_is(&value["trustLevel"], "untrusted") {
        ctx.add(
            "trust_invariant",
            "$.trustLevel",
            "collected context remains untrusted data",
        );
    }
    if value["executionPermissionsExpanded"] != Value::Bool(false) {
        ctx.add(
            "permission_gate",
            "$.executionPermissionsExpanded",
            "context content cannot expand execution permissions",
        );
    }
    if !is_true(&value["preview"]["removable"]) {
        ctx.add(
            "preview_invariant",
            "$.preview.removable",
            "context must remain removable before model invocation",
        );
    }
    if value["collectResult"]["tokenCount"]
        .as_i64()
        .unwrap_or_default()
        > value["tokenBudget"].as_i64().unwrap_or_default()
    {
        ctx.add(
            "budget_invariant",
            "$.collectResult.tokenCount",
            "collected context cannot exceed its independent token budget",
        );
    }
    if value_is(&value["collectResult"]["status"], "collected")
        && (!is_true(&value["enabled"])
            || !value_is(&value["permissionStatus"], "granted")
            || !is_true(&value["preview"]["reviewed"])
            || value["collectResult"]["contentHandleToken"].is_null())
    {
        ctx.add(
            "collect_gate",
            "$.collectResult",
            "collection requires enablement, authorization, reviewed preview, and a content handle",
        );
    }
    if value_is(&value["collectResult"]["status"], "collected")
        && !value_is(&value["collectResult"]["promptInjectionRisk"], "low")
    {
        ctx.add(
            "prompt_injection_gate",
            "$.collectResult.promptInjectionRisk",
            "only context assessed as low prompt-injection risk may be collected",
        );
    }
    ctx.finish()
}
