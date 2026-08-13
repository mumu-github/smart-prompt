#[path = "../src/target_adapter.rs"]
mod target_adapter;

use serde_json::{json, Value};
use std::{
    cell::Cell,
    collections::{HashMap, VecDeque},
    path::Path,
    rc::Rc,
};
use target_adapter::{
    bundled_driver_path_for_executable, extract_driver_contract, normalize_editor_readback,
    validate_result_semantics, AdapterResult, AtomicReplaceReply, AtomicReplaceRequest, Clock,
    CodexTargetAdapter, PowerShellProbeRunner, ProbeError, ProbeRunner, ProbeSnapshot,
    TargetExpectation, TargetLease, TransactionClaimResponse, VerifiedTransactionHandle,
    ADAPTER_VERSION, DRIVER_SCHEMA_VERSION, LEASE_VERSION, RESULT_CONTRACT_VERSION,
    TRANSACTION_CLAIM_VERSION, TRANSACTION_VERSION,
};

const FIXTURES: &str =
    include_str!("../../local-service/src/modules/codex-target-adapter/contract-fixtures.json");

#[test]
fn editor_readback_normalization_only_removes_line_end_whitespace() {
    assert_eq!(
        normalize_editor_readback("alpha  \r\nbeta\t\ngamma  "),
        "alpha\nbeta\ngamma"
    );
    assert_eq!(
        normalize_editor_readback("alpha  beta\n  indented  prose\n```txt\nx  y\n```"),
        "alpha beta\n  indented prose\n```txt\nx  y\n```"
    );
    assert_ne!(
        normalize_editor_readback("alpha beta"),
        normalize_editor_readback("alphabeta")
    );
}

#[derive(Clone)]
struct FixtureClock {
    now: Rc<Cell<i64>>,
}

impl FixtureClock {
    fn new(now_ms: i64) -> Self {
        Self {
            now: Rc::new(Cell::new(now_ms)),
        }
    }

    fn set(&self, now_ms: i64) {
        self.now.set(now_ms);
    }
}

impl Clock for FixtureClock {
    fn now_ms(&self) -> i64 {
        self.now.get()
    }
}

fn deep_merge(base: &Value, patch: &Value) -> Value {
    match (base, patch) {
        (Value::Object(base_map), Value::Object(patch_map)) => {
            let mut merged = base_map.clone();
            for (key, value) in patch_map {
                let next = merged
                    .get(key)
                    .map(|current| deep_merge(current, value))
                    .unwrap_or_else(|| value.clone());
                merged.insert(key.clone(), next);
            }
            Value::Object(merged)
        }
        (_, value) => value.clone(),
    }
}

struct FixtureProbeRunner {
    base_snapshot: Value,
    base_atomic_reply: Value,
    queue: VecDeque<Value>,
    calls: Vec<String>,
    atomic_requests: Vec<AtomicReplaceRequest>,
    read_expectations: Vec<TargetExpectation>,
}

impl FixtureProbeRunner {
    fn new(fixture_set: &Value, scenario: &Value) -> Self {
        Self {
            base_snapshot: fixture_set["baseSnapshot"].clone(),
            base_atomic_reply: fixture_set["baseAtomicReply"].clone(),
            queue: scenario["probes"]
                .as_array()
                .expect("scenario probes")
                .iter()
                .cloned()
                .collect(),
            calls: Vec::new(),
            atomic_requests: Vec::new(),
            read_expectations: Vec::new(),
        }
    }

    fn next(&mut self, command: &str) -> Value {
        let probe = self.queue.pop_front().expect("unexpected fake probe call");
        assert_eq!(probe["command"].as_str(), Some(command));
        self.calls.push(command.to_string());
        probe
    }

    fn snapshot_for(&self, probe: &Value) -> Result<ProbeSnapshot, ProbeError> {
        let snapshot = deep_merge(&self.base_snapshot, &probe["snapshotPatch"]);
        serde_json::from_value(snapshot).map_err(|error| ProbeError::new(error.to_string()))
    }
}

impl ProbeRunner for FixtureProbeRunner {
    fn inspect(&mut self) -> Result<ProbeSnapshot, ProbeError> {
        let probe = self.next("inspect");
        self.snapshot_for(&probe)
    }

    fn read_exact(&mut self, expected: &TargetExpectation) -> Result<ProbeSnapshot, ProbeError> {
        self.read_expectations.push(expected.clone());
        let probe = self.next("read_exact");
        self.snapshot_for(&probe)
    }

    fn replace_all_atomic(
        &mut self,
        request: &AtomicReplaceRequest,
    ) -> Result<AtomicReplaceReply, ProbeError> {
        self.atomic_requests.push(request.clone());
        let probe = self.next("replace_all_atomic");
        let mut reply = deep_merge(&self.base_atomic_reply, &probe["replyPatch"]);
        let before = deep_merge(&self.base_snapshot, &probe["beforePatch"]);
        reply
            .as_object_mut()
            .expect("atomic reply object")
            .insert("before".to_string(), before);
        serde_json::from_value(reply).map_err(|error| ProbeError::new(error.to_string()))
    }
}

struct Observed {
    result: Option<AdapterResult>,
    lease: Option<TargetLease>,
    draft_text: Option<String>,
    undo_token: Option<String>,
    transaction: Option<VerifiedTransactionHandle>,
    claim: Option<TransactionClaimResponse>,
}

fn assert_lease(lease: &TargetLease) {
    assert_eq!(lease.lease_version, LEASE_VERSION);
    assert_eq!(lease.target, "codex");
    assert!(lease.hwnd.starts_with("0x"));
    assert!(lease.pid > 0);
    assert_eq!(lease.runtime_identity_hash.len(), 64);
    assert!(lease.focused);
    assert_eq!(lease.focus_identity_hash.len(), 64);
    assert_eq!(lease.draft_hash.len(), 64);
    assert!(lease.project_scope_token.starts_with("project_scope"));
    assert!(["reliable_hash", "session_opaque"].contains(&lease.project_scope_kind.as_str()));
    assert_eq!(
        lease.project_scope_reliable,
        lease.capabilities.project_scope_reliable
    );
    assert!([
        "project_scope_reliable",
        "project_scope_window_runtime_session_only"
    ]
    .contains(&lease.project_scope_reason.as_str()));
    assert!(chrono::DateTime::parse_from_rfc3339(&lease.issued_at).is_ok());
    assert!(chrono::DateTime::parse_from_rfc3339(&lease.expires_at).is_ok());

    let serialized = serde_json::to_value(lease).expect("serialize lease");
    let object = serialized.as_object().expect("lease object");
    for forbidden in [
        "title",
        "windowTitle",
        "draft",
        "draftText",
        "candidateToken",
        "nearbyText",
    ] {
        assert!(!object.contains_key(forbidden), "lease exposed {forbidden}");
    }
}

fn assert_transaction(transaction: &VerifiedTransactionHandle) {
    assert_eq!(transaction.transaction_version, TRANSACTION_VERSION);
    assert!(transaction.transaction_id.starts_with("transaction_"));
    assert_eq!(transaction.target, "codex");
    assert!(transaction.project_scope_token.starts_with("project_scope"));
    assert!(["reliable_hash", "session_opaque"].contains(&transaction.project_scope_kind.as_str()));
    assert!(chrono::DateTime::parse_from_rfc3339(&transaction.issued_at).is_ok());
    assert!(chrono::DateTime::parse_from_rfc3339(&transaction.expires_at).is_ok());
}

fn assert_expected(observed: &Observed, expected: &Value, operation: &str) {
    if operation == "claim" {
        let claim = observed.claim.as_ref().expect("claim response");
        assert_eq!(Some(claim.status.as_str()), expected["status"].as_str());
        assert_eq!(
            Some(claim.reason_token.as_str()),
            expected["reasonToken"].as_str()
        );
        assert_eq!(
            claim.receipt.is_some(),
            expected["receipt"].as_bool().unwrap()
        );
        if let Some(receipt) = &claim.receipt {
            assert_eq!(receipt.claim_version, TRANSACTION_CLAIM_VERSION);
            assert_eq!(Some(receipt.binding.as_str()), expected["binding"].as_str());
            assert_eq!(receipt.target, "codex");
            assert_eq!(receipt.verification, "machine");
            assert!(receipt.insert_verified);
            assert!(receipt.no_auto_submit);
        }
        return;
    }

    let result = observed.result.as_ref().expect("adapter result");
    validate_result_semantics(result).expect("outcome-learning result semantics");
    assert_eq!(result.contract_version, RESULT_CONTRACT_VERSION);
    assert_eq!(result.operation, operation);
    assert_eq!(result.target, "codex");
    assert!(result.no_auto_submit);

    let result_value = serde_json::to_value(result).expect("serialize adapter result");
    for key in [
        "status",
        "reasonToken",
        "publicReason",
        "verified",
        "writeMethod",
        "readbackMatched",
        "clipboardRestored",
    ] {
        if expected.get(key).is_some() {
            assert_eq!(
                result_value.get(key),
                expected.get(key),
                "{operation}.{key}"
            );
        }
    }
    if let Some(expected_lease) = expected.get("lease").and_then(Value::as_bool) {
        assert_eq!(observed.lease.is_some(), expected_lease);
        if let Some(lease) = &observed.lease {
            assert_lease(lease);
        }
    }
    if let Some(expected_undo) = expected.get("undo").and_then(Value::as_bool) {
        assert_eq!(observed.undo_token.is_some(), expected_undo);
    }
    if let Some(expected_draft) = expected.get("draftText").and_then(Value::as_str) {
        assert_eq!(observed.draft_text.as_deref(), Some(expected_draft));
    }
    if let Some(expected_transaction) = expected.get("transaction").and_then(Value::as_bool) {
        assert_eq!(observed.transaction.is_some(), expected_transaction);
        if let Some(transaction) = &observed.transaction {
            assert_transaction(transaction);
        }
    }
    let scope_kind = observed
        .lease
        .as_ref()
        .map(|lease| lease.project_scope_kind.as_str())
        .or_else(|| {
            observed
                .transaction
                .as_ref()
                .map(|transaction| transaction.project_scope_kind.as_str())
        });
    let scope_reliable = observed
        .lease
        .as_ref()
        .map(|lease| lease.project_scope_reliable)
        .or_else(|| {
            observed
                .transaction
                .as_ref()
                .map(|transaction| transaction.project_scope_reliable)
        });
    if let Some(expected_kind) = expected.get("projectScopeKind").and_then(Value::as_str) {
        assert_eq!(scope_kind, Some(expected_kind));
    }
    if let Some(expected_reliable) = expected
        .get("projectScopeReliable")
        .and_then(Value::as_bool)
    {
        assert_eq!(scope_reliable, Some(expected_reliable));
    }
}

#[test]
fn node_and_rust_consume_the_same_fake_only_target_adapter_contract() {
    let fixture_set: Value = serde_json::from_str(FIXTURES).expect("parse shared fixtures");
    assert_eq!(
        fixture_set["fixtureSetVersion"].as_str(),
        Some("codex-target-adapter-fixtures@1")
    );
    assert_eq!(ADAPTER_VERSION, "codex-windows-target-adapter@1");
    let scenarios = fixture_set["cases"].as_array().expect("fixture cases");
    assert!(scenarios.len() >= 15);
    let mut session_scope_token_owners: HashMap<String, String> = HashMap::new();

    for scenario in scenarios {
        let actions = scenario["actions"].as_array().expect("scenario actions");
        let expected = scenario["expected"].as_array().expect("expected results");
        assert_eq!(actions.len(), expected.len());
        let initial_now = actions[0]["atMs"].as_i64().expect("initial fixture time");
        let clock = FixtureClock::new(initial_now);
        let runner = FixtureProbeRunner::new(&fixture_set, scenario);
        let mut adapter = CodexTargetAdapter::with_clock(
            runner,
            clock.clone(),
            fixture_set["leaseTtlMs"].as_i64().expect("lease ttl"),
        );
        assert_eq!(adapter.adapter_version(), ADAPTER_VERSION);
        assert_eq!(
            adapter.lease_ttl_ms(),
            fixture_set["leaseTtlMs"].as_i64().unwrap()
        );

        let mut latest_lease: Option<TargetLease> = None;
        let mut latest_undo_token: Option<String> = None;
        let mut latest_transaction: Option<VerifiedTransactionHandle> = None;
        let mut previous_project_scope_token: Option<String> = None;
        for (index, action) in actions.iter().enumerate() {
            let operation = action["operation"].as_str().expect("fixture operation");
            clock.set(action["atMs"].as_i64().expect("action time"));
            let observed = match operation {
                "inspect" => {
                    let response = adapter.inspect();
                    if let Some(lease) = &response.lease {
                        latest_lease = Some(lease.clone());
                        if lease.project_scope_kind == "session_opaque" {
                            match session_scope_token_owners.get(&lease.project_scope_token) {
                                Some(owner) => {
                                    assert_eq!(owner, scenario["id"].as_str().unwrap())
                                }
                                None => {
                                    session_scope_token_owners.insert(
                                        lease.project_scope_token.clone(),
                                        scenario["id"].as_str().unwrap().to_string(),
                                    );
                                }
                            }
                        }
                    }
                    Observed {
                        result: Some(response.result),
                        lease: response.lease,
                        draft_text: None,
                        undo_token: None,
                        transaction: None,
                        claim: None,
                    }
                }
                "read" => {
                    let response = adapter.read_draft(
                        &latest_lease
                            .as_ref()
                            .map(|lease| lease.lease_id.as_str())
                            .unwrap_or("missing_lease"),
                    );
                    Observed {
                        result: Some(response.result),
                        lease: None,
                        draft_text: response.draft_text,
                        undo_token: None,
                        transaction: None,
                        claim: None,
                    }
                }
                "insert" => {
                    let response = adapter.insert(
                        &latest_lease
                            .as_ref()
                            .map(|lease| lease.lease_id.as_str())
                            .unwrap_or("missing_lease"),
                        action["text"].as_str().expect("insert text"),
                        action["allowClipboardFallback"].as_bool().unwrap_or(false),
                    );
                    if let Some(token) = &response.undo_token {
                        latest_undo_token = Some(token.clone());
                    }
                    if let Some(transaction) = &response.transaction {
                        assert_eq!(
                            transaction.project_scope_token,
                            latest_lease.as_ref().unwrap().project_scope_token
                        );
                        latest_transaction = Some(transaction.clone());
                    }
                    Observed {
                        result: Some(response.result),
                        lease: None,
                        draft_text: None,
                        undo_token: response.undo_token,
                        transaction: response.transaction,
                        claim: None,
                    }
                }
                "undo" => {
                    let response = adapter.undo(
                        latest_undo_token.as_deref().unwrap_or("missing_undo"),
                        action["allowClipboardFallback"].as_bool().unwrap_or(false),
                    );
                    Observed {
                        result: Some(response.result),
                        lease: None,
                        draft_text: None,
                        undo_token: None,
                        transaction: None,
                        claim: None,
                    }
                }
                "claim" => {
                    let transaction_id = action["transactionId"]
                        .as_str()
                        .or_else(|| {
                            latest_transaction
                                .as_ref()
                                .map(|transaction| transaction.transaction_id.as_str())
                        })
                        .unwrap_or("missing_transaction");
                    let claim = adapter.claim_verified_transaction(
                        transaction_id,
                        action["binding"].as_str().expect("claim binding"),
                    );
                    if let (Some(receipt), Some(transaction)) =
                        (claim.receipt.as_ref(), latest_transaction.as_ref())
                    {
                        assert_eq!(receipt.project_scope_token, transaction.project_scope_token);
                    }
                    Observed {
                        result: None,
                        lease: None,
                        draft_text: None,
                        undo_token: None,
                        transaction: None,
                        claim: Some(claim),
                    }
                }
                other => panic!("unknown fixture operation {other}"),
            };

            assert_expected(&observed, &expected[index], operation);
            let current_scope_token = observed
                .lease
                .as_ref()
                .map(|lease| lease.project_scope_token.as_str())
                .or_else(|| {
                    observed
                        .transaction
                        .as_ref()
                        .map(|transaction| transaction.project_scope_token.as_str())
                });
            if let Some(expected_changed) = expected[index]
                .get("projectScopeChanged")
                .and_then(Value::as_bool)
            {
                assert_eq!(
                    current_scope_token
                        .map(|token| Some(token) != previous_project_scope_token.as_deref())
                        .unwrap_or(false),
                    expected_changed
                );
            }
            if let Some(token) = current_scope_token {
                previous_project_scope_token = Some(token.to_string());
            }
            let public_surface = json!({
                "result": observed.result.as_ref().map(|result| serde_json::to_value(result).unwrap()),
                "lease": observed.lease.as_ref().map(|lease| serde_json::to_value(lease).unwrap()),
                "undoToken": observed.undo_token,
                "transaction": observed.transaction.as_ref().map(|transaction| serde_json::to_value(transaction).unwrap()),
                "claim": observed.claim.as_ref().map(|claim| serde_json::to_value(claim).unwrap())
            });
            let serialized_public = serde_json::to_string(&public_surface).unwrap();
            for sentinel in fixture_set["privacySentinels"]
                .as_array()
                .expect("privacy sentinels")
            {
                assert!(
                    !serialized_public.contains(sentinel.as_str().unwrap()),
                    "{} leaked {}",
                    scenario["id"].as_str().unwrap(),
                    sentinel.as_str().unwrap()
                );
            }
        }

        if scenario["id"].as_str() == Some("direct-full-replace-and-undo") {
            let transaction = latest_transaction.as_ref().expect("verified transaction");
            let repeated =
                adapter.claim_verified_transaction(&transaction.transaction_id, "activation");
            assert_eq!(repeated.status, "ready");
            assert_eq!(
                repeated.receipt.as_ref().unwrap().transaction_id,
                transaction.transaction_id
            );
        }

        let expected_calls: Vec<String> = scenario["expectedProbeCalls"]
            .as_array()
            .expect("expected probe calls")
            .iter()
            .map(|value| value.as_str().unwrap().to_string())
            .collect();
        assert_eq!(adapter.runner().calls, expected_calls);
        assert!(adapter.runner().queue.is_empty());
        for expectation in &adapter.runner().read_expectations {
            assert_eq!(expectation.target, "codex");
            assert!(!expectation.hwnd.is_empty());
            assert!(!expectation.candidate_token.is_empty());
            assert_eq!(expectation.draft_hash.len(), 64);
        }
        for request in &adapter.runner().atomic_requests {
            assert_eq!(request.expected.target, "codex");
            assert_eq!(request.replacement_intent, "full");
            assert!(request.prefer_direct_set_value);
            assert!(request.no_submit);
            assert_eq!(request.prohibited_actions, ["enter", "submit", "send"]);
            assert!(["insert", "undo"].contains(&request.operation.as_str()));
            assert!(!request.text.is_empty());
            if request.operation == "insert" {
                let freshness = request
                    .lease_freshness
                    .as_ref()
                    .expect("insert must atomically guard lease freshness");
                assert!(freshness.require_fresh_at_commit);
                assert!(freshness.lease_id.starts_with("lease_"));
                assert!(freshness.expires_at_ms > freshness.issued_at_ms);
            } else {
                assert!(request.lease_freshness.is_none());
            }
            if request.allow_clipboard_fallback {
                assert!(request.prohibited_actions.contains(&"enter".to_string()));
            }
        }
    }
}

#[test]
fn production_runner_uses_the_bundled_driver_contract_without_executing_it() {
    let executable = Path::new(
        "C:/Program Files/Smart Prompt/resources/smart-prompt-sidecar/bin/local-service-sidecar.exe",
    );
    assert_eq!(
        bundled_driver_path_for_executable(executable)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/"),
        "C:/Program Files/Smart Prompt/resources/smart-prompt-sidecar/scripts/codex-target-adapter-driver.ps1"
    );

    let driver = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("scripts")
        .join("codex-target-adapter-driver.ps1");
    let runner = PowerShellProbeRunner::new(&driver).expect("repository fixture driver exists");
    assert_eq!(runner.script_path(), driver.as_path());

    let output = format!(
        "warning\n{{\"schemaVersion\":\"{DRIVER_SCHEMA_VERSION}\",\"kind\":\"read_exact\",\"driverOk\":true,\"reasonToken\":\"ready\"}}\n{{\"schemaVersion\":\"{DRIVER_SCHEMA_VERSION}\",\"kind\":\"inspect\",\"driverOk\":true,\"reasonToken\":\"ready\"}}\n"
    );
    let contract = extract_driver_contract(output.as_bytes(), "inspect")
        .expect("last matching driver contract");
    assert_eq!(contract["kind"], "inspect");
    assert!(extract_driver_contract(output.as_bytes(), "replace_all_atomic").is_none());
}
