#[path = "../src/outcome_contracts.rs"]
mod outcome_contracts;
#[path = "../src/pending_outcomes.rs"]
mod pending_outcomes;

use outcome_contracts::validate_contract;
use pending_outcomes::{
    ask_next_at, backup_file, claim_next_feedback_at, expire_due_outcomes_at,
    get_feedback_state_at, get_outcome_at, invalidate_project_at, list_implicit_signals_at,
    list_outcomes_at, record_event_at, record_implicit_signal_at, record_verified_insert_at,
    state_file, submit_failure_reason_at, submit_outcome_feedback_at, PendingOutcomeError,
    FAILURE_REASON_TOKENS, FEEDBACK_DELAY_MS, IMPLICIT_SIGNAL_TYPES, OUTCOME_TTL_MS,
    STORE_SCHEMA_VERSION,
};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Barrier,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

static NEXT_TEST_DIR: AtomicU64 = AtomicU64::new(0);

fn retained_data_dir(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock must follow the Unix epoch")
        .as_nanos();
    let serial = NEXT_TEST_DIR.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "smart-prompt-pending-outcomes-rust-{}-{nonce}-{serial}-{label}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).expect("create retained pending-outcome test directory");
    dir
}

fn prompt_session_event(
    event_id: &str,
    event_type: &str,
    occurred_at: &str,
    project_scope_token: &str,
    outcome_id: Option<&str>,
) -> Value {
    let verified = event_type == "verified_insert";
    json!({
        "contractVersion": "prompt-session@2",
        "eventId": event_id,
        "eventType": event_type,
        "occurredAt": occurred_at,
        "sessionId": format!("session-{event_id}"),
        "generationId": format!("generation-{event_id}"),
        "target": "codex",
        "projectScopeToken": project_scope_token,
        "strategyId": "strategy-compact",
        "strategyVersion": "v2",
        "modelFamilyToken": "model-family-fast",
        "outcomeId": outcome_id,
        "policyId": Value::Null,
        "policyVersion": Value::Null,
        "taskOutcomeToken": "unknown",
        "insertVerified": verified,
        "noAutoSubmit": true,
        "failureReasonTokens": if event_type == "insert_failed" {
            json!(["insert_failed"])
        } else {
            json!([])
        },
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
    })
}

fn set_field(mut value: Value, field: &str, replacement: Value) -> Value {
    value
        .as_object_mut()
        .expect("fixture must be an object")
        .insert(field.to_string(), replacement);
    value
}

fn expect_code<T: std::fmt::Debug>(result: Result<T, PendingOutcomeError>, expected: &str) {
    let error = result.expect_err("operation should be rejected");
    assert_eq!(error.code, expected, "unexpected error: {error:?}");
}

fn as_array(value: &Value) -> &Vec<Value> {
    value.as_array().expect("response must be an array")
}

fn assert_valid_pending(outcome: &Value) {
    let validation = validate_contract("pending_outcome", outcome).expect("known contract");
    assert!(
        validation.is_valid(),
        "pending outcome must satisfy the shared Rust contract: {:?}",
        validation.errors
    );
}

fn fixture_value(id: &str) -> Value {
    let fixtures: Value = serde_json::from_str(include_str!(
        "../../../packages/outcome-learning/contract-fixtures.json"
    ))
    .expect("parse canonical Node fixtures");
    fixtures["valid"]
        .as_array()
        .expect("valid fixture list")
        .iter()
        .find(|fixture| fixture["id"] == id)
        .unwrap_or_else(|| panic!("missing fixture {id}"))["value"]
        .clone()
}

#[test]
fn verified_insert_matches_node_fixture_and_event_idempotency() {
    assert_eq!(STORE_SCHEMA_VERSION, "pending-outcome-store@1");
    assert_eq!(FEEDBACK_DELAY_MS, 60_000);
    assert_eq!(OUTCOME_TTL_MS, 86_400_000);
    assert_eq!(
        IMPLICIT_SIGNAL_TYPES,
        ["retry", "undo", "regenerated", "insert_failed"]
    );
    assert_eq!(
        FAILURE_REASON_TOKENS,
        [
            "missing_context",
            "wrong_format",
            "not_actionable",
            "too_long",
            "token_waste",
            "tool_mismatch",
            "low_quality",
            "insert_failed"
        ]
    );

    let dir = retained_data_dir("fixture");
    let event = fixture_value("prompt-session-verified-insert");
    let mut expected = fixture_value("pending-outcome-unknown");
    expected["policyId"] = event["policyId"].clone();
    expected["policyVersion"] = event["policyVersion"].clone();
    let created = record_verified_insert_at(&dir, &event, "2026-07-19T02:00:00.000Z")
        .expect("create pending outcome from canonical fixture");
    assert_eq!(created["kind"], "pending_outcome");
    assert_eq!(created["created"], true);
    assert_eq!(created["duplicate"], false);
    assert_eq!(created["outcome"], expected);
    assert_eq!(created["outcome"]["policyId"], "policy_001");
    assert_eq!(created["outcome"]["policyVersion"], 2);
    assert_valid_pending(&created["outcome"]);

    for (field, replacement) in [("policyId", Value::Null), ("policyVersion", Value::Null)] {
        let invalid = set_field(created["outcome"].clone(), field, replacement);
        let validation = validate_contract("pending_outcome", &invalid).expect("known contract");
        assert!(validation
            .errors
            .iter()
            .any(|error| error.code == "policy_attribution_invariant"));
    }

    let duplicate =
        record_event_at(&dir, &event, "2026-07-19T02:00:00.000Z").expect("replay exact event");
    assert_eq!(duplicate["duplicate"], true);
    assert_eq!(
        as_array(&list_outcomes_at(&dir, &json!({}), "2026-07-19T02:00:00.000Z").unwrap()).len(),
        1
    );

    expect_code(
        record_event_at(
            &dir,
            &set_field(event.clone(), "generationId", json!("generation-conflict")),
            "2026-07-19T02:00:00.000Z",
        ),
        "outcome_idempotency_conflict",
    );
    expect_code(
        record_verified_insert_at(
            &dir,
            &prompt_session_event(
                "event-not-verified",
                "retry",
                "2026-07-19T02:00:01.000Z",
                "project_scope_alpha",
                Some("outcome_001"),
            ),
            "2026-07-19T02:00:01.000Z",
        ),
        "verified_insert_required",
    );
    expect_code(
        record_event_at(
            &dir,
            &set_field(event, "insertVerified", json!(false)),
            "2026-07-19T02:00:00.000Z",
        ),
        "invalid_prompt_session_event",
    );
    assert!(state_file(&dir).exists());
    assert!(backup_file(&dir).exists());
}

#[test]
fn legacy_store_without_policy_attribution_hydrates_to_a_null_pair() {
    let dir = retained_data_dir("legacy-policy-attribution");
    let occurred_at = "2026-07-19T02:00:00.000Z";
    record_verified_insert_at(
        &dir,
        &prompt_session_event(
            "event-legacy-policy",
            "verified_insert",
            occurred_at,
            "project-legacy-policy",
            Some("outcome-legacy-policy"),
        ),
        occurred_at,
    )
    .expect("create pending outcome");

    let mut stored: Value = serde_json::from_str(
        &fs::read_to_string(state_file(&dir)).expect("read pending outcome state"),
    )
    .expect("parse pending outcome state");
    let outcome = stored["outcomes"][0]["outcome"]
        .as_object_mut()
        .expect("stored outcome object");
    outcome.remove("policyId");
    outcome.remove("policyVersion");
    fs::write(
        state_file(&dir),
        format!("{}\n", serde_json::to_string_pretty(&stored).unwrap()),
    )
    .expect("write legacy pending outcome state");

    let outcomes = list_outcomes_at(&dir, &json!({}), occurred_at)
        .expect("legacy state should remain readable");
    assert_eq!(outcomes[0]["policyId"], Value::Null);
    assert_eq!(outcomes[0]["policyVersion"], Value::Null);
    assert_valid_pending(&outcomes[0]);
}

#[test]
fn feedback_boundaries_queue_order_and_concurrent_claims_are_exact() {
    let boundary_dir = retained_data_dir("boundaries");
    let event = prompt_session_event(
        "event-boundary",
        "verified_insert",
        "2026-07-19T00:00:00.000Z",
        "project-boundary",
        Some("outcome-boundary"),
    );
    record_event_at(&boundary_dir, &event, "2026-07-19T00:00:00.000Z").unwrap();

    let too_early = ask_next_at(
        &boundary_dir,
        &json!({
            "askId": "ask-too-early",
            "target": "codex",
            "projectScopeToken": "project-boundary"
        }),
        "2026-07-19T00:00:59.999Z",
    )
    .unwrap();
    assert_eq!(
        too_early,
        json!({ "state": "none", "outcome": Value::Null })
    );

    let eligible = ask_next_at(
        &boundary_dir,
        &json!({
            "askId": "ask-at-boundary",
            "target": "codex",
            "projectScopeToken": "project-boundary"
        }),
        "2026-07-19T00:01:00.000Z",
    )
    .unwrap();
    assert_eq!(eligible["state"], "question");
    assert_eq!(eligible["outcome"]["outcomeId"], "outcome-boundary");
    assert_eq!(
        eligible["outcome"]["feedbackPromptedAt"],
        "2026-07-19T00:01:00.000Z"
    );

    let completed = submit_outcome_feedback_at(
        &boundary_dir,
        &json!({
            "feedbackId": "feedback-boundary",
            "outcomeId": "outcome-boundary",
            "taskOutcomeToken": "completed"
        }),
        "2026-07-19T00:01:00.000Z",
    )
    .unwrap();
    assert_eq!(completed["state"], "completed");
    assert_eq!(completed["outcome"]["status"], "succeeded");

    let expiry_dir = retained_data_dir("expiry-boundary");
    record_event_at(
        &expiry_dir,
        &prompt_session_event(
            "event-expiry-boundary",
            "verified_insert",
            "2026-07-19T06:00:00.000Z",
            "project-expiry-boundary",
            Some("outcome-expiry-boundary"),
        ),
        "2026-07-19T06:00:00.000Z",
    )
    .unwrap();
    assert_eq!(
        get_outcome_at(
            &expiry_dir,
            "outcome-expiry-boundary",
            "2026-07-20T05:59:59.999Z"
        )
        .unwrap()["status"],
        "unknown"
    );
    assert_eq!(
        get_outcome_at(
            &expiry_dir,
            "outcome-expiry-boundary",
            "2026-07-20T06:00:00.000Z"
        )
        .unwrap()["status"],
        "expired_unknown"
    );

    let queue_dir = retained_data_dir("queue-order");
    for (suffix, occurred_at, project) in [
        ("base", "2026-07-19T08:00:00.000Z", "project-a"),
        ("older", "2026-07-19T08:00:10.000Z", "project-a"),
        ("latest", "2026-07-19T08:00:20.000Z", "project-a"),
        ("other", "2026-07-19T08:00:30.000Z", "project-b"),
        ("not-yet", "2026-07-19T08:01:00.000Z", "project-a"),
    ] {
        record_event_at(
            &queue_dir,
            &prompt_session_event(
                &format!("event-{suffix}"),
                "verified_insert",
                occurred_at,
                project,
                Some(&format!("outcome-{suffix}")),
            ),
            occurred_at,
        )
        .unwrap();
    }
    let first = claim_next_feedback_at(
        &queue_dir,
        &json!({
            "askId": "ask-project-a-1",
            "target": "codex",
            "projectScopeToken": "project-a"
        }),
        "2026-07-19T08:01:35.000Z",
    )
    .unwrap();
    assert_eq!(first["outcome"]["outcomeId"], "outcome-latest");
    let replay = claim_next_feedback_at(
        &queue_dir,
        &json!({
            "requestId": "ask-project-a-1",
            "target": "codex",
            "projectScopeToken": "project-a"
        }),
        "2026-07-19T08:01:35.000Z",
    )
    .unwrap();
    assert_eq!(replay, first);
    let second = claim_next_feedback_at(
        &queue_dir,
        &json!({
            "eventId": "ask-project-a-2",
            "target": "codex",
            "projectScopeToken": "project-a"
        }),
        "2026-07-19T08:01:35.000Z",
    )
    .unwrap();
    assert_eq!(second["outcome"]["outcomeId"], "outcome-older");
    let other = claim_next_feedback_at(
        &queue_dir,
        &json!({
            "askId": "ask-project-b-1",
            "target": "codex",
            "projectScopeToken": "project-b"
        }),
        "2026-07-19T08:01:35.000Z",
    )
    .unwrap();
    assert_eq!(other["outcome"]["outcomeId"], "outcome-other");

    let concurrent_dir = retained_data_dir("concurrent-claims");
    for index in 0..12 {
        let occurred_at = format!("2026-07-19T10:00:{index:02}.000Z");
        record_event_at(
            &concurrent_dir,
            &prompt_session_event(
                &format!("event-concurrent-{index}"),
                "verified_insert",
                &occurred_at,
                "project-concurrent",
                Some(&format!("outcome-concurrent-{index}")),
            ),
            &occurred_at,
        )
        .unwrap();
    }
    let barrier = Arc::new(Barrier::new(12));
    let handles = (0..12)
        .map(|index| {
            let dir = concurrent_dir.clone();
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                claim_next_feedback_at(
                    &dir,
                    &json!({
                        "askId": format!("ask-concurrent-{index}"),
                        "target": "codex",
                        "projectScopeToken": "project-concurrent"
                    }),
                    "2026-07-19T10:02:00.000Z",
                )
                .expect("concurrent claim")
            })
        })
        .collect::<Vec<_>>();
    let claimed = handles
        .into_iter()
        .map(|handle| handle.join().expect("claim thread"))
        .collect::<Vec<_>>();
    assert!(claimed
        .iter()
        .all(|response| response["state"] == "question"));
    let outcome_ids = claimed
        .iter()
        .map(|response| {
            response["outcome"]["outcomeId"]
                .as_str()
                .expect("claimed outcome id")
        })
        .collect::<HashSet<_>>();
    assert_eq!(
        outcome_ids.len(),
        12,
        "each concurrent claim must be unique"
    );
}

#[test]
fn completed_and_not_completed_feedback_cover_all_finite_reasons() {
    let dir = retained_data_dir("feedback");
    let created_at = "2026-07-19T12:00:00.000Z";

    record_event_at(
        &dir,
        &prompt_session_event(
            "event-completed",
            "verified_insert",
            created_at,
            "project-completed",
            Some("outcome-completed"),
        ),
        created_at,
    )
    .unwrap();
    ask_next_at(
        &dir,
        &json!({
            "askId": "ask-completed",
            "target": "codex",
            "projectScopeToken": "project-completed"
        }),
        "2026-07-19T12:01:00.000Z",
    )
    .unwrap();
    let completed_request = json!({
        "feedbackId": "feedback-completed",
        "outcomeId": "outcome-completed",
        "taskOutcomeToken": "completed"
    });
    let completed =
        submit_outcome_feedback_at(&dir, &completed_request, "2026-07-19T12:01:00.000Z").unwrap();
    assert_eq!(completed["state"], "completed");
    assert_eq!(completed["outcome"]["status"], "succeeded");
    assert_eq!(
        submit_outcome_feedback_at(&dir, &completed_request, "2026-07-19T12:01:00.000Z").unwrap(),
        completed
    );
    expect_code(
        submit_outcome_feedback_at(
            &dir,
            &json!({
                "feedbackId": "feedback-completed",
                "outcomeId": "outcome-completed",
                "taskOutcomeToken": "not_completed"
            }),
            "2026-07-19T12:01:00.000Z",
        ),
        "outcome_idempotency_conflict",
    );

    for (index, reason) in FAILURE_REASON_TOKENS.iter().enumerate() {
        let project = format!("project-reason-{index}");
        let outcome_id = format!("outcome-reason-{index}");
        record_event_at(
            &dir,
            &prompt_session_event(
                &format!("event-reason-{index}"),
                "verified_insert",
                created_at,
                &project,
                Some(&outcome_id),
            ),
            created_at,
        )
        .unwrap();
        ask_next_at(
            &dir,
            &json!({
                "askId": format!("ask-reason-{index}"),
                "target": "codex",
                "projectScopeToken": project
            }),
            "2026-07-19T12:01:00.000Z",
        )
        .unwrap();
        let first_step = submit_outcome_feedback_at(
            &dir,
            &json!({
                "feedbackId": format!("feedback-choice-{index}"),
                "outcomeId": outcome_id,
                "taskOutcomeToken": "not_completed"
            }),
            "2026-07-19T12:01:00.000Z",
        )
        .unwrap();
        assert_eq!(first_step["state"], "reason_required");
        assert_eq!(first_step["outcome"]["status"], "unknown");
        assert_eq!(
            first_step["failureReasonTokens"],
            serde_json::to_value(FAILURE_REASON_TOKENS).unwrap()
        );
        if index == 0 {
            expect_code(
                submit_failure_reason_at(
                    &dir,
                    &json!({
                        "feedbackId": "feedback-invalid-reason",
                        "outcomeId": outcome_id,
                        "reasonToken": "other"
                    }),
                    "2026-07-19T12:01:00.000Z",
                ),
                "invalid_failure_reason",
            );
        }
        let failed = submit_failure_reason_at(
            &dir,
            &json!({
                "feedbackId": format!("feedback-reason-{index}"),
                "outcomeId": outcome_id,
                "reasonToken": reason
            }),
            "2026-07-19T12:01:00.000Z",
        )
        .unwrap();
        assert_eq!(failed["state"], "not_completed");
        assert_eq!(failed["outcome"]["status"], "failed");
        assert_eq!(failed["outcome"]["failureReasonTokens"], json!([reason]));
        assert_valid_pending(&failed["outcome"]);
    }
}

#[test]
fn implicit_signals_and_privacy_guards_never_persist_raw_values() {
    let dir = retained_data_dir("signals-privacy");
    let created_at = "2026-07-19T14:00:00.000Z";
    record_event_at(
        &dir,
        &prompt_session_event(
            "event-source",
            "verified_insert",
            created_at,
            "project-safe",
            Some("outcome-source"),
        ),
        created_at,
    )
    .unwrap();

    for (index, event_type) in IMPLICIT_SIGNAL_TYPES.iter().enumerate() {
        let occurred_at = format!("2026-07-19T14:00:{:02}.000Z", index + 1);
        let signal = prompt_session_event(
            &format!("event-signal-{index}"),
            event_type,
            &occurred_at,
            "project-safe",
            Some("outcome-source"),
        );
        let recorded = record_implicit_signal_at(&dir, &signal, &occurred_at).unwrap();
        assert_eq!(recorded["kind"], "implicit_signal");
        assert_eq!(recorded["recorded"], true);
        assert_eq!(
            record_event_at(&dir, &signal, &occurred_at).unwrap()["duplicate"],
            true
        );
    }
    assert_eq!(
        as_array(&list_implicit_signals_at(&dir, &json!({}), "2026-07-19T14:01:00.000Z").unwrap())
            .len(),
        4
    );
    expect_code(
        record_event_at(
            &dir,
            &prompt_session_event(
                "event-signal-0",
                "undo",
                "2026-07-19T14:00:01.000Z",
                "project-safe",
                Some("outcome-source"),
            ),
            "2026-07-19T14:01:00.000Z",
        ),
        "outcome_idempotency_conflict",
    );

    let unsafe_events = [
        set_field(
            prompt_session_event(
                "event-raw-prompt",
                "verified_insert",
                created_at,
                "project-safe",
                Some("outcome-raw-prompt"),
            ),
            "prompt",
            json!("RAW_PROMPT_SENTINEL"),
        ),
        set_field(
            prompt_session_event(
                "event-project-path",
                "verified_insert",
                created_at,
                "project-safe",
                Some("outcome-project-path"),
            ),
            "projectScopeToken",
            json!("C:\\Users\\private\\project"),
        ),
        set_field(
            prompt_session_event(
                "event-window-title",
                "verified_insert",
                created_at,
                "project-safe",
                Some("outcome-window-title"),
            ),
            "windowTitle",
            json!("RAW_TITLE_SENTINEL"),
        ),
        set_field(
            prompt_session_event(
                "event-credential",
                "verified_insert",
                created_at,
                "project-safe",
                Some("outcome-credential"),
            ),
            "modelFamilyToken",
            json!("sk-1234567890abcdef"),
        ),
    ];
    for event in unsafe_events {
        expect_code(
            record_event_at(&dir, &event, "2026-07-19T14:01:00.000Z"),
            "outcome_privacy_violation",
        );
    }
    expect_code(
        record_event_at(
            &dir,
            &set_field(
                prompt_session_event(
                    "event-raw-spaces",
                    "verified_insert",
                    created_at,
                    "project-safe",
                    Some("outcome-raw-spaces"),
                ),
                "generationId",
                json!("raw prompt body with spaces"),
            ),
            "2026-07-19T14:01:00.000Z",
        ),
        "invalid_prompt_session_event",
    );
    expect_code(
        ask_next_at(
            &dir,
            &json!({
                "askId": "ask-private-path",
                "target": "codex",
                "projectScopeToken": "C:\\private"
            }),
            "2026-07-19T14:01:00.000Z",
        ),
        "outcome_privacy_violation",
    );

    let persisted = fs::read_to_string(state_file(&dir)).expect("read persisted queue");
    for forbidden in [
        "RAW_PROMPT_SENTINEL",
        "RAW_TITLE_SENTINEL",
        "C:\\\\Users\\\\private\\\\project",
        "sk-1234567890abcdef",
        "raw prompt body with spaces",
    ] {
        assert!(
            !persisted.contains(forbidden),
            "persisted state leaked {forbidden}: {persisted}"
        );
    }
}

#[test]
fn restart_backup_recovery_and_all_unknown_expiry_states_survive() {
    let dir = retained_data_dir("restart-recovery");
    let created_at = "2026-07-19T16:00:00.000Z";
    for suffix in ["unasked", "asked", "reason-required"] {
        record_event_at(
            &dir,
            &prompt_session_event(
                &format!("event-{suffix}"),
                "verified_insert",
                created_at,
                &format!("project-{suffix}"),
                Some(&format!("outcome-{suffix}")),
            ),
            created_at,
        )
        .unwrap();
    }
    for suffix in ["asked", "reason-required"] {
        ask_next_at(
            &dir,
            &json!({
                "askId": format!("ask-{suffix}"),
                "target": "codex",
                "projectScopeToken": format!("project-{suffix}")
            }),
            "2026-07-19T16:01:00.000Z",
        )
        .unwrap();
    }
    submit_outcome_feedback_at(
        &dir,
        &json!({
            "feedbackId": "feedback-reason-required",
            "outcomeId": "outcome-reason-required",
            "taskOutcomeToken": "not_completed"
        }),
        "2026-07-19T16:01:00.000Z",
    )
    .unwrap();

    assert_eq!(
        get_feedback_state_at(&dir, "outcome-reason-required", "2026-07-20T15:59:59.999Z").unwrap()
            ["state"],
        "reason_required"
    );
    let expired = expire_due_outcomes_at(&dir, "2026-07-20T16:00:00.000Z").unwrap();
    assert_eq!(as_array(&expired).len(), 3);
    assert!(as_array(&expired)
        .iter()
        .all(|outcome| outcome["status"] == "expired_unknown"));
    assert!(
        as_array(&expire_due_outcomes_at(&dir, "2026-07-20T16:00:00.000Z").unwrap()).is_empty()
    );

    let recovery_dir = retained_data_dir("backup-recovery");
    for index in 0..2 {
        record_event_at(
            &recovery_dir,
            &prompt_session_event(
                &format!("event-recovery-{index}"),
                "verified_insert",
                created_at,
                "project-recovery",
                Some(&format!("outcome-recovery-{index}")),
            ),
            created_at,
        )
        .unwrap();
    }
    ask_next_at(
        &recovery_dir,
        &json!({
            "askId": "ask-recovery",
            "target": "codex",
            "projectScopeToken": "project-recovery"
        }),
        "2026-07-19T16:01:00.000Z",
    )
    .unwrap();
    assert!(backup_file(&recovery_dir).exists());

    fs::write(state_file(&recovery_dir), "{\n").expect("simulate interrupted overwrite");
    let recovered = list_outcomes_at(
        &recovery_dir,
        &json!({ "projectScopeToken": "project-recovery" }),
        "2026-07-19T16:01:00.000Z",
    )
    .expect("recover primary state from backup");
    assert_eq!(as_array(&recovered).len(), 2);
    serde_json::from_str::<Value>(
        &fs::read_to_string(state_file(&recovery_dir)).expect("read restored primary"),
    )
    .expect("restored primary is valid JSON");
    assert_eq!(
        record_event_at(
            &recovery_dir,
            &prompt_session_event(
                "event-recovery-0",
                "verified_insert",
                created_at,
                "project-recovery",
                Some("outcome-recovery-0"),
            ),
            "2026-07-19T16:01:00.000Z",
        )
        .unwrap()["duplicate"],
        true
    );
}

#[test]
fn project_invalidation_is_scoped_persistent_and_non_destructive() {
    let dir = retained_data_dir("project-invalidation");
    let created_at = "2026-07-19T18:00:00.000Z";
    for (suffix, project) in [
        ("a-completed", "project-a"),
        ("a-failed", "project-a"),
        ("b-pending", "project-b"),
    ] {
        record_event_at(
            &dir,
            &prompt_session_event(
                &format!("event-{suffix}"),
                "verified_insert",
                created_at,
                project,
                Some(&format!("outcome-{suffix}")),
            ),
            created_at,
        )
        .unwrap();
    }
    let first = ask_next_at(
        &dir,
        &json!({
            "askId": "ask-a-first",
            "target": "codex",
            "projectScopeToken": "project-a"
        }),
        "2026-07-19T18:01:00.000Z",
    )
    .unwrap();
    let first_outcome = first["outcome"]["outcomeId"].as_str().unwrap();
    submit_outcome_feedback_at(
        &dir,
        &json!({
            "feedbackId": "feedback-a-completed",
            "outcomeId": first_outcome,
            "taskOutcomeToken": "completed"
        }),
        "2026-07-19T18:01:00.000Z",
    )
    .unwrap();
    let second = ask_next_at(
        &dir,
        &json!({
            "askId": "ask-a-second",
            "target": "codex",
            "projectScopeToken": "project-a"
        }),
        "2026-07-19T18:01:00.000Z",
    )
    .unwrap();
    let second_outcome = second["outcome"]["outcomeId"].as_str().unwrap();
    submit_outcome_feedback_at(
        &dir,
        &json!({
            "feedbackId": "feedback-a-not-completed",
            "outcomeId": second_outcome,
            "taskOutcomeToken": "not_completed"
        }),
        "2026-07-19T18:01:00.000Z",
    )
    .unwrap();
    submit_failure_reason_at(
        &dir,
        &json!({
            "feedbackId": "feedback-a-reason",
            "outcomeId": second_outcome,
            "reasonToken": "low_quality"
        }),
        "2026-07-19T18:01:00.000Z",
    )
    .unwrap();

    let invalidated = invalidate_project_at(&dir, "project-a", "2026-07-19T18:02:00.000Z").unwrap();
    assert_eq!(invalidated["projectScopeToken"], "project-a");
    assert_eq!(invalidated["invalidatedCount"], 2);
    for outcome in invalidated["outcomes"].as_array().unwrap() {
        assert_eq!(outcome["status"], "invalidated");
        assert_eq!(outcome["failureReasonTokens"], json!([]));
        assert_valid_pending(outcome);
    }
    let project_a = list_outcomes_at(
        &dir,
        &json!({ "projectScopeToken": "project-a" }),
        "2026-07-19T18:02:00.000Z",
    )
    .unwrap();
    assert!(as_array(&project_a)
        .iter()
        .all(|outcome| outcome["status"] == "invalidated"));
    assert_eq!(
        get_outcome_at(&dir, "outcome-b-pending", "2026-07-19T18:02:00.000Z").unwrap()["status"],
        "unknown"
    );
    assert_eq!(
        get_feedback_state_at(&dir, first_outcome, "2026-07-19T18:02:00.000Z").unwrap()["state"],
        "invalidated"
    );
    assert_eq!(
        ask_next_at(
            &dir,
            &json!({
                "askId": "ask-a-after-invalidation",
                "target": "codex",
                "projectScopeToken": "project-a"
            }),
            "2026-07-19T18:02:00.000Z",
        )
        .unwrap()["state"],
        "none"
    );
    expect_code(
        submit_outcome_feedback_at(
            &dir,
            &json!({
                "feedbackId": "feedback-after-invalidation",
                "outcomeId": first_outcome,
                "taskOutcomeToken": "completed"
            }),
            "2026-07-19T18:02:00.000Z",
        ),
        "pending_outcome_invalidated",
    );
    assert_eq!(
        invalidate_project_at(&dir, "project-a", "2026-07-19T18:03:00.000Z").unwrap()
            ["invalidatedCount"],
        0
    );
    assert!(state_file(&dir).exists());
    assert!(backup_file(&dir).exists());
}
