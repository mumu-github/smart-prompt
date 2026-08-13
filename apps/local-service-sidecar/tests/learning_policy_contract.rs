#[path = "../src/learning_policy.rs"]
mod learning_policy;
#[path = "../src/outcome_contracts.rs"]
mod outcome_contracts;

use learning_policy::{
    compile_generation_policy_at, create_policy_rollout_at, estimate_rollout_confidence,
    evaluate_policy_rollout_at, GenerationPolicyRegistry, GenerationPolicyRegistryOptions,
    LearningPolicyStore,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

const FIXED_NOW: &str = "2026-07-19T08:00:00.000Z";
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn retained_temp_dir(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock follows Unix epoch")
        .as_nanos();
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!(
        "smart-prompt-learning-policy-{label}-{}-{nonce}-{sequence}",
        std::process::id()
    ));
    fs::create_dir_all(&path).expect("create retained test directory");
    path
}

fn fixed_clock() -> String {
    FIXED_NOW.to_string()
}

fn assert_contract(contract: &str, value: &Value) {
    let result = outcome_contracts::validate_contract(contract, value)
        .unwrap_or_else(|error| panic!("dispatch {contract}: {error}"));
    assert!(result.is_valid(), "{contract} errors: {:?}", result.errors);
}

fn memory_payload(statement: &str) -> Value {
    json!({
        "category": "verified_environment",
        "statement": statement
    })
}

fn rule_payload(directive: &str) -> Value {
    json!({
        "directive": directive,
        "taskScenarioTokens": ["verified_insert"]
    })
}

fn skill_payload() -> Value {
    json!({
        "triggerConditionTokens": ["package_contract_change"],
        "stepTokens": ["inspect_contract", "run_fixture_tests"],
        "verificationTokens": ["fixtures_pass"],
        "resourceTokens": ["node_test_runner"],
        "permissionTokens": ["workspace_read", "package_write"],
        "failureRecoveryTokens": ["stop_without_integration"],
        "scriptsExecutable": false,
        "permissionCheckPassed": false,
        "isolationTestPassed": false,
        "adversarialReviewPassed": false
    })
}

fn observation_input(
    project: &str,
    session: &str,
    outcome: &str,
    features: &[&str],
    candidate: Option<(&str, Value)>,
) -> Value {
    let mut value = json!({
        "projectScopeToken": project,
        "sessionId": session,
        "outcomeId": outcome,
        "featureTokens": features,
        "taskScenarioToken": "bug_fix",
        "modeToken": "standard",
        "strategyId": "baseline",
        "strategyVersion": "v1",
        "modelFamilyToken": "codex_test",
        "contextSourceTokens": [],
        "insertVerified": true,
        "outcomeStatus": "succeeded",
        "failureReasonTokens": [],
        "tokenAccountingSource": "unavailable"
    });
    if let Some((artifact_type, payload)) = candidate {
        value["candidate"] = json!({
            "artifactType": artifact_type,
            "payload": payload
        });
    }
    value
}

fn create_candidate(
    store: &LearningPolicyStore,
    project: &str,
    feature: &str,
    artifact_type: &str,
    payload: &Value,
) -> Value {
    let sessions = ["session_a", "session_a", "session_b"];
    let mut candidate = None;
    for index in 0..3 {
        let input = observation_input(
            project,
            &format!("{}_{}", sessions[index], feature),
            &format!("outcome_{feature}_{}", index + 1),
            &[&format!("pattern:{feature}"), "source:derived_features"],
            Some((artifact_type, payload.clone())),
        );
        candidate = store
            .record_observation(&input)
            .expect("record candidate evidence")
            .candidate
            .or(candidate);
    }
    candidate.expect("candidate is created at two sessions and three successes")
}

fn all_text_files(root: &Path) -> String {
    let mut output = String::new();
    for entry in fs::read_dir(root).expect("read retained test directory") {
        let entry = entry.expect("read directory entry");
        let path = entry.path();
        if path.is_dir() {
            output.push_str(&all_text_files(&path));
        } else {
            output.push_str(&fs::read_to_string(path).expect("read persisted text file"));
        }
    }
    output
}

fn scope(project: &str) -> Value {
    json!({
        "kind": "project",
        "target": "codex",
        "projectScopeToken": project,
        "taskScenarioToken": "contract_implementation",
        "modelFamilyToken": "model_family_fast"
    })
}

fn compiler_input(project: &str, version: u64, baseline_version: u64) -> Value {
    json!({
        "scope": scope(project),
        "version": version,
        "baselineVersion": baseline_version,
        "contextBudget": {
            "maxInputTokens": 999_999,
            "maxContextSourceTokens": 999_999
        },
        "evidenceSummary": {
            "attributableOutcomeCount": 8,
            "successfulOutcomeCount": 7,
            "negativeOutcomeCount": 1,
            "retryRate": 0.12,
            "undoRate": 0.0,
            "tokenDeltaRatio": -0.08,
            "evidenceTokenCount": 8
        },
        "signals": {
            "strategy": {
                "selectedStrategy": {
                    "sourceStrategyId": "strategy_compact",
                    "version": "v6-strategy-policy@3"
                },
                "directives": [
                    { "key": "preserve_winning_strategy", "directive": "RAW_REPORT_IGNORED" },
                    { "key": "reuse_friendly", "directive": "C:\\private\\project" }
                ],
                "candidateStrategies": [{
                    "strategyId": "strategy_compact",
                    "outcomes": 8,
                    "successfulOutcomes": 7,
                    "retryUsageRate": 0.12,
                    "undoUsageRate": 0.0
                }]
            },
            "quality": {
                "readiness": { "primaryDecision": "quality_lift_positive" },
                "rawReport": "RAW_REPORT_IGNORED"
            },
            "failure": {
                "topReasons": [{ "key": "too_long", "value": 6 }],
                "directives": [{ "reasonToken": "too_long", "directive": "RAW_REPORT_IGNORED" }]
            },
            "evolution": {
                "mutationAllowed": false,
                "automaticPromotion": false,
                "candidates": [{
                    "action": "shorten_prompt",
                    "mutationAllowed": false,
                    "automaticPromotion": false,
                    "reviewGate": "sk-1234567890abcdef"
                }]
            }
        }
    })
}

fn valid_benchmark(model_family: &str) -> Value {
    json!({
        "contractVersion": "benchmark-result@1",
        "benchmarkId": "benchmark_policy_v1",
        "status": "passed",
        "executor": "fake",
        "initiatedBy": "test",
        "authorization": { "required": false, "granted": false },
        "modelFamilyToken": model_family,
        "fixtureSetToken": "codex_policy_fixture_v1",
        "taskCount": 12,
        "categoryCounts": {
            "feature_development": 2,
            "bug_fix": 2,
            "refactor": 2,
            "test_completion": 2,
            "code_review": 2,
            "documentation": 2
        },
        "comparability": {
            "sameModelFamily": true,
            "sameStartingPoint": true,
            "samePermissions": true,
            "sameBudget": true,
            "deterministicAcceptance": true
        },
        "budget": {
            "tokenLimit": 120_000,
            "maxAgentTurns": 6,
            "maxRetries": 2,
            "estimatedCostMicros": 0,
            "consumedTokens": 60_000,
            "exhausted": false
        },
        "arms": {
            "baseline": {
                "completedTasks": 10,
                "safetyPassedTasks": 12,
                "totalTokens": 33_000,
                "totalDurationMs": 64_000,
                "totalRetries": 4,
                "totalToolCalls": 44
            },
            "candidate": {
                "completedTasks": 10,
                "safetyPassedTasks": 12,
                "totalTokens": 29_000,
                "totalDurationMs": 59_000,
                "totalRetries": 3,
                "totalToolCalls": 41
            }
        },
        "safety": {
            "qualityGatePassed": true,
            "noAutoSubmitPassed": true,
            "privacyPassed": true,
            "permissionPassed": true
        },
        "startedAt": "2026-07-19T07:00:00.000Z",
        "finishedAt": "2026-07-19T07:10:00.000Z",
        "publicReason": "none",
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

fn production_benchmark(model_family: &str) -> Value {
    let mut benchmark = valid_benchmark(model_family);
    benchmark["executor"] = json!("codex");
    benchmark["initiatedBy"] = json!("user");
    benchmark["authorization"]["required"] = json!(true);
    benchmark["authorization"]["granted"] = json!(true);
    benchmark
}

fn rollout_arms(count: u64, candidate_overrides: Value) -> Value {
    let mut candidate = json!({
        "attributableOutcomes": count,
        "successRate": 0.8,
        "retryRate": 0.2,
        "undoRate": 0.1,
        "averageTokens": 940.0,
        "averageLatencyMs": 1200.0,
        "averageReworkCount": 0.5
    });
    if let (Some(target), Some(overrides)) =
        (candidate.as_object_mut(), candidate_overrides.as_object())
    {
        target.extend(overrides.clone());
    }
    json!({
        "baseline": {
            "attributableOutcomes": count,
            "successRate": 0.8,
            "retryRate": 0.2,
            "undoRate": 0.1,
            "averageTokens": 1000.0,
            "averageLatencyMs": 1200.0,
            "averageReworkCount": 0.5
        },
        "candidate": candidate
    })
}

#[test]
fn learning_store_enforces_privacy_hmac_thresholds_reviews_and_persistence() {
    let root = retained_temp_dir("learning");
    let store =
        LearningPolicyStore::open_with_clock(&root, fixed_clock).expect("open learning store");

    let mut unsafe_input = observation_input(
        "project_alpha",
        "session_private",
        "outcome_private",
        &["scenario:bug_fix"],
        None,
    );
    unsafe_input["rawInput"] = Value::String("RAW_INPUT_MUST_NEVER_PERSIST".to_string());
    unsafe_input["absoluteProjectPath"] = Value::String("C:\\private\\project".to_string());
    let error = store
        .record_observation(&unsafe_input)
        .expect_err("raw learning input is rejected");
    assert_eq!(error.code, "privacy_input_rejected");

    let first = store
        .record_observation(&observation_input(
            "project_alpha",
            "session_1",
            "fingerprint_1",
            &["mode:standard", "scenario:bug_fix"],
            None,
        ))
        .expect("record first observation")
        .observation;
    let reordered = store
        .record_observation(&observation_input(
            "project_alpha",
            "session_2",
            "fingerprint_2",
            &["scenario:bug_fix", "mode:standard"],
            None,
        ))
        .expect("record reordered observation")
        .observation;
    let other_project = store
        .record_observation(&observation_input(
            "project_beta",
            "session_1",
            "fingerprint_beta",
            &["scenario:bug_fix", "mode:standard"],
            None,
        ))
        .expect("record other-project observation")
        .observation;
    assert_contract("learning_observation", &first);
    assert_eq!(
        first["semanticFingerprint"]["valueToken"],
        reordered["semanticFingerprint"]["valueToken"]
    );
    assert_ne!(
        first["semanticFingerprint"]["valueToken"],
        other_project["semanticFingerprint"]["valueToken"]
    );
    assert_eq!(first["semanticFingerprint"]["exportable"], false);
    let key_file = store
        .project_key_file("project_alpha")
        .expect("derive project key path");
    let key_material = fs::read_to_string(key_file)
        .expect("read local project key for test only")
        .trim()
        .to_string();
    assert_eq!(key_material.len(), 44);
    let state_text = fs::read_to_string(store.state_file()).expect("read learning state");
    assert!(!state_text.contains(&key_material));
    assert!(!state_text.contains("scenario:bug_fix"));
    assert!(!state_text.contains("mode:standard"));

    let duplicate_input = observation_input(
        "project_alpha",
        "session_1",
        "fingerprint_1",
        &["mode:standard", "scenario:bug_fix"],
        None,
    );
    assert!(
        store
            .record_observation(&duplicate_input)
            .expect("duplicate is idempotent")
            .duplicate
    );

    let candidate = create_candidate(
        &store,
        "project_review",
        "memory",
        "memory",
        &memory_payload("Use contract fixtures to verify the local consumer."),
    );
    assert_contract("learning_artifact", &candidate);
    assert_eq!(candidate["status"], "pending_review");
    assert_eq!(candidate["effective"], false);
    assert_eq!(candidate["evidenceSummary"]["sessionCount"], 2);
    assert_eq!(candidate["evidenceSummary"]["successfulOutcomeCount"], 3);
    let artifact_id = candidate["artifactId"].as_str().expect("artifact id");

    let late_negative = create_candidate(
        &store,
        "project_late_negative",
        "late_negative",
        "memory",
        &memory_payload("Archive this candidate when contrary evidence arrives."),
    );
    let mut negative = observation_input(
        "project_late_negative",
        "session_negative",
        "outcome_negative",
        &["pattern:late_negative", "source:derived_features"],
        Some((
            "memory",
            memory_payload("Archive this candidate when contrary evidence arrives."),
        )),
    );
    negative["outcomeStatus"] = Value::String("failed".to_string());
    negative["taskOutcomeToken"] = Value::String("not_completed".to_string());
    negative["insertVerified"] = Value::Bool(false);
    negative["explicitNegativeFeedback"] = Value::Bool(true);
    negative["failureReasonTokens"] = json!(["low_quality"]);
    store
        .record_observation(&negative)
        .expect("record explicit negative evidence");
    assert_eq!(
        store
            .get_candidate_detail(late_negative["artifactId"].as_str().unwrap())
            .expect("late-negative candidate remains auditable")
            .artifact["status"],
        "archived"
    );

    let reminder = store
        .get_card_reminder(
            "project_review",
            &[
                "source:derived_features".to_string(),
                "pattern:memory".to_string(),
            ],
        )
        .expect("read card reminder")
        .expect("pending candidate is reminded");
    assert_eq!(reminder["artifactId"], artifact_id);
    for _ in 0..3 {
        store
            .ignore_candidate(artifact_id)
            .expect("ignore reminder up to cap");
    }
    assert!(store
        .get_card_reminder(
            "project_review",
            &[
                "pattern:memory".to_string(),
                "source:derived_features".to_string()
            ],
        )
        .expect("read hidden reminder")
        .is_none());
    assert_eq!(
        store
            .get_candidate_detail(artifact_id)
            .expect("candidate remains in control center")
            .artifact["review"]["ignoredCount"],
        3
    );
    store
        .review_candidate(
            artifact_id,
            &json!({
                "action": "edit",
                "payload": memory_payload("Edited reviewed statement.")
            }),
        )
        .expect("edit candidate");
    store
        .review_candidate(
            artifact_id,
            &json!({
                "action": "reclassify",
                "artifactType": "rule",
                "payload": rule_payload("Use the reviewed result as a scoped rule.")
            }),
        )
        .expect("reclassify candidate");
    store
        .review_candidate(
            artifact_id,
            &json!({
                "action": "narrow_scope",
                "scopeTokens": ["directory:local_service", "scenario:bug_fix"]
            }),
        )
        .expect("narrow candidate scope");
    let accepted = store
        .review_candidate(artifact_id, &json!({ "action": "accept" }))
        .expect("accept candidate");
    assert_eq!(accepted["artifactType"], "rule");
    assert_eq!(accepted["status"], "active");
    assert_eq!(accepted["effective"], true);
    assert_contract("learning_artifact", &accepted);

    let rejected_candidate = create_candidate(
        &store,
        "project_review",
        "reject",
        "memory",
        &memory_payload("Reject this derived statement."),
    );
    let rejected = store
        .review_candidate(
            rejected_candidate["artifactId"]
                .as_str()
                .expect("artifact id"),
            &json!({ "action": "reject" }),
        )
        .expect("reject candidate");
    assert_eq!(rejected["status"], "rejected");
    assert_eq!(rejected["effective"], false);

    let restarted = LearningPolicyStore::open_with_clock(&root, fixed_clock)
        .expect("restart persisted learning store");
    assert!(restarted
        .list_artifacts(None, None, None)
        .expect("list persisted artifacts")
        .iter()
        .any(|artifact| artifact["artifactId"] == accepted["artifactId"]));
}

#[test]
fn skills_and_cross_project_promotions_require_every_gate_and_final_confirmation() {
    let root = retained_temp_dir("promotion");
    let store =
        LearningPolicyStore::open_with_clock(&root, fixed_clock).expect("open learning store");
    let skill = create_candidate(&store, "project_skill", "skill", "skill", &skill_payload());
    let skill_id = skill["artifactId"].as_str().expect("skill id");
    assert_eq!(skill["payload"]["scriptsExecutable"], false);
    assert_eq!(
        store
            .review_candidate(skill_id, &json!({ "action": "accept" }))
            .expect_err("ungated Skill cannot be accepted")
            .code,
        "skill_gates_required"
    );
    assert_eq!(
        store
            .set_skill_gates(
                skill_id,
                &json!({
                    "permission": true,
                    "isolation": true,
                    "static": "yes",
                    "adversarial": true
                })
            )
            .expect_err("finite boolean gates are required")
            .code,
        "invalid_skill_gates"
    );
    let detail = store
        .set_skill_gates(
            skill_id,
            &json!({
                "permission": true,
                "isolation": true,
                "static": true,
                "adversarial": true
            }),
        )
        .expect("pass all Skill gates");
    assert_eq!(detail.skill_gates.expect("skill gates")["static"], true);
    let accepted = store
        .review_candidate(skill_id, &json!({ "action": "accept" }))
        .expect("accept fully gated Skill");
    assert_eq!(accepted["effective"], true);
    assert_eq!(accepted["payload"]["scriptsExecutable"], false);

    let projects = [
        ("promotion_project_a", "promotion_1"),
        ("promotion_project_a", "promotion_2"),
        ("promotion_project_b", "promotion_3"),
        ("promotion_project_b", "promotion_4"),
        ("promotion_project_c", "promotion_5"),
    ];
    let mut proposal = None;
    for (project, outcome) in projects {
        let result = store
            .record_promotion_evidence(&json!({
                "promotionKeyToken": "promotion:shared_memory",
                "projectScopeToken": project,
                "sessionId": format!("session_{project}_{outcome}"),
                "outcomeId": outcome,
                "artifactType": "memory",
                "payload": memory_payload("Reuse the verified package contract before integration."),
                "succeeded": true,
                "explicitNegativeFeedback": false
            }))
            .expect("record global Memory evidence");
        proposal = result.proposal.or(proposal);
    }
    let proposal = proposal.expect("three projects and five successes create proposal");
    assert_eq!(proposal["status"], "pending_final_confirmation");
    assert_eq!(proposal["effective"], false);
    assert_eq!(proposal["projectScopeTokens"].as_array().unwrap().len(), 3);
    assert_eq!(proposal["successfulOutcomeCount"], 5);
    assert_contract("learning_artifact", &proposal["artifact"]);
    let proposal_id = proposal["proposalId"].as_str().expect("proposal id");
    assert_eq!(
        store
            .confirm_global_proposal(proposal_id, false)
            .expect_err("explicit final confirmation is mandatory")
            .code,
        "final_confirmation_required"
    );
    let global = store
        .confirm_global_proposal(proposal_id, true)
        .expect("confirm global Memory");
    assert_eq!(global["scope"]["kind"], "global");
    assert_eq!(global["scope"]["projectScopeToken"], Value::Null);
    assert_eq!(global["effective"], true);
    assert_contract("learning_artifact", &global);

    let mut blocked_skill_proposal = None;
    for (index, project) in ["skill_a", "skill_b", "skill_c"].into_iter().enumerate() {
        blocked_skill_proposal = store
            .record_promotion_evidence(&json!({
                "promotionKeyToken": "promotion:skill_missing_static",
                "projectScopeToken": project,
                "sessionId": format!("session_{project}"),
                "outcomeId": format!("skill_outcome_{index}"),
                "artifactType": "skill",
                "payload": skill_payload(),
                "skillGates": {
                    "permission": true,
                    "isolation": true,
                    "static": index != 1,
                    "adversarial": true
                },
                "succeeded": true
            }))
            .expect("record Skill promotion evidence")
            .proposal
            .or(blocked_skill_proposal);
    }
    assert!(blocked_skill_proposal.is_none());

    let mut skill_proposal = None;
    for (index, project) in ["gated_skill_a", "gated_skill_b", "gated_skill_c"]
        .into_iter()
        .enumerate()
    {
        skill_proposal = store
            .record_promotion_evidence(&json!({
                "promotionKeyToken": "promotion:shared_skill",
                "projectScopeToken": project,
                "sessionId": format!("session_{project}"),
                "outcomeId": format!("gated_skill_outcome_{index}"),
                "artifactType": "skill",
                "payload": skill_payload(),
                "skillGates": {
                    "permission": true,
                    "isolation": true,
                    "static": true,
                    "adversarial": true
                },
                "succeeded": true
            }))
            .expect("record gated Skill promotion evidence")
            .proposal
            .or(skill_proposal);
    }
    let skill_proposal = skill_proposal.expect("three independent gated successes create proposal");
    assert_eq!(skill_proposal["skillGates"]["static"], true);
    assert_eq!(
        skill_proposal["artifact"]["payload"]["scriptsExecutable"],
        false
    );
}

#[test]
fn project_clear_archives_and_invalidates_learning_fingerprints_and_policy_evidence() {
    let root = retained_temp_dir("clear");
    let store =
        LearningPolicyStore::open_with_clock(&root, fixed_clock).expect("open learning store");
    let candidate = create_candidate(
        &store,
        "project_clear",
        "clear",
        "memory",
        &memory_payload("Archive this project candidate when project learning is cleared."),
    );
    let old_digest = store
        .list_observations(Some("project_clear"))
        .expect("list project observations")[0]["semanticFingerprint"]["valueToken"]
        .clone();

    let registry = GenerationPolicyRegistry::open_with_clock(&root, fixed_clock)
        .expect("open generation policy registry");
    let mut baseline =
        compile_generation_policy_at(&compiler_input("project_clear", 1, 1), Some(FIXED_NOW))
            .expect("compile baseline");
    baseline["status"] = Value::String("stable".to_string());
    assert_contract("generation_policy", &baseline);
    registry
        .register_policy(&baseline)
        .expect("register stable project policy");

    let cleared = store
        .clear_project_data("project_clear")
        .expect("clear project into recoverable archive");
    assert!(cleared.archive_dir.exists());
    assert!(cleared.archive_dir.join("learning-data.json").exists());
    assert!(cleared.archive_dir.join("project-hmac.key").exists());
    assert!(cleared.key_archived);
    assert_eq!(cleared.counts.artifacts, 1);
    assert_eq!(cleared.counts.policies, 1);
    assert!(!store
        .project_key_file("project_clear")
        .expect("project key path")
        .exists());
    assert!(store
        .list_observations(Some("project_clear"))
        .expect("project observations are invalidated")
        .is_empty());
    assert!(!store
        .list_artifacts(None, None, None)
        .expect("list active artifacts")
        .iter()
        .any(|artifact| artifact["artifactId"] == candidate["artifactId"]));
    assert_eq!(
        registry
            .get_policy(baseline["policyId"].as_str().expect("policy id"), 1)
            .expect("read invalidated policy")
            .expect("policy remains auditable")["status"],
        "rolled_back"
    );
    let archive: Value = serde_json::from_str(
        &fs::read_to_string(cleared.archive_dir.join("learning-data.json"))
            .expect("read archive JSON"),
    )
    .expect("parse archive JSON");
    assert!(archive["observations"]
        .as_array()
        .unwrap()
        .iter()
        .all(|entry| entry["invalidated"] == true
            && entry["observation"]["taskOutcomeToken"] == "invalidated"));
    assert_eq!(
        archive["policyRegistryEvidence"]["policies"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    let after_clear = store
        .record_observation(&observation_input(
            "project_clear",
            "session_after_clear",
            "outcome_after_clear",
            &["source:derived_features", "pattern:clear"],
            None,
        ))
        .expect("record after clear with a fresh project key")
        .observation;
    assert_ne!(after_clear["semanticFingerprint"]["valueToken"], old_digest);
    assert!(store
        .project_key_file("project_clear")
        .expect("fresh key path")
        .exists());

    let persisted = all_text_files(&root);
    for forbidden in [
        "RAW_INPUT_MUST_NEVER_PERSIST",
        "C:\\private\\project",
        root.to_string_lossy().as_ref(),
    ] {
        assert!(
            !persisted.contains(forbidden),
            "persisted data leaked {forbidden}"
        );
    }
}

#[test]
fn generation_policy_compiler_registry_selector_and_rollout_match_node_contract_semantics() {
    assert_eq!(
        learning_policy::GENERATION_POLICY_COMPILER_VERSION,
        "generation-policy-compiler@1"
    );
    assert_eq!(
        learning_policy::POLICY_ROLLOUT_ENGINE_VERSION,
        "generation-policy-rollout@1"
    );
    assert_eq!(learning_policy::DEFAULT_CANARY_SHARE_BPS, 1_000);

    let input = compiler_input("project_policy", 2, 1);
    let draft = compile_generation_policy_at(&input, Some(FIXED_NOW)).expect("compile policy");
    let repeated = compile_generation_policy_at(&input, Some(FIXED_NOW)).expect("repeat compiler");
    assert_eq!(draft, repeated);
    assert_eq!(draft["status"], "draft");
    assert_eq!(draft["riskLevel"], "low");
    assert_eq!(draft["automaticRolloutEligible"], true);
    assert_eq!(draft["selectedStrategy"]["strategyId"], "strategy_compact");
    assert_eq!(draft["contextBudget"]["maxInputTokens"], 1200);
    assert!(
        draft["contextBudget"]["maxContextSourceTokens"]
            .as_u64()
            .unwrap()
            <= 1024
    );
    assert!(draft["directives"].as_array().unwrap().len() <= 5);
    assert_contract("generation_policy", &draft);
    let serialized = serde_json::to_string(&draft).expect("serialize compiled policy");
    for secret in [
        "RAW_REPORT_IGNORED",
        "C:\\private\\project",
        "sk-1234567890abcdef",
    ] {
        assert!(
            !serialized.contains(secret),
            "compiled policy leaked {secret}"
        );
    }
    let mut global_input = input.clone();
    global_input["scope"]["kind"] = Value::String("global".to_string());
    assert_eq!(
        compile_generation_policy_at(&global_input, Some(FIXED_NOW))
            .expect_err("automatic global scope is forbidden")
            .code,
        "automatic_policy_scope_forbidden"
    );
    let mut skill_input = input.clone();
    skill_input["artifactType"] = Value::String("skill".to_string());
    assert_eq!(
        compile_generation_policy_at(&skill_input, Some(FIXED_NOW))
            .expect_err("Skill cannot enter automatic compiler")
            .code,
        "automatic_policy_artifact_forbidden"
    );

    let strict_root = retained_temp_dir("policy-production-evidence");
    let strict_registry = GenerationPolicyRegistry::open_with_clock(&strict_root, fixed_clock)
        .expect("open strict policy registry");
    assert!(!GenerationPolicyRegistryOptions::default().allow_harness_only_benchmarks);
    let mut strict_baseline =
        compile_generation_policy_at(&compiler_input("project_policy", 1, 1), Some(FIXED_NOW))
            .expect("compile strict stable baseline");
    strict_baseline["status"] = json!("stable");
    strict_registry
        .register_policy(&strict_baseline)
        .expect("register strict stable baseline");
    strict_registry
        .register_policy(&draft)
        .expect("register strict draft candidate");
    let fake_benchmark = valid_benchmark("model_family_fast");
    assert_eq!(
        strict_registry
            .mark_benchmarked(
                draft["policyId"].as_str().expect("strict policy id"),
                2,
                &fake_benchmark,
            )
            .expect_err("production default rejects fake test benchmark")
            .code,
        "policy_benchmark_production_evidence_required"
    );
    assert!(strict_registry
        .list_rollouts()
        .expect("fake benchmark creates no production plan")
        .is_empty());

    let production_benchmark = production_benchmark("model_family_fast");
    for (label, pointer, replacement, error_code, validation_code) in [
        (
            "executor",
            "/executor",
            json!("fake"),
            "policy_benchmark_production_evidence_required",
            None,
        ),
        (
            "initiatedBy",
            "/initiatedBy",
            json!("test"),
            "invalid_policy_benchmark",
            Some("authorization_gate"),
        ),
        (
            "authorization.required",
            "/authorization/required",
            json!(false),
            "invalid_policy_benchmark",
            Some("authorization_gate"),
        ),
        (
            "authorization.granted",
            "/authorization/granted",
            json!(false),
            "invalid_policy_benchmark",
            Some("authorization_gate"),
        ),
        (
            "budget.exhausted",
            "/budget/exhausted",
            json!(true),
            "policy_benchmark_production_evidence_required",
            None,
        ),
        (
            "comparability.sameModelFamily",
            "/comparability/sameModelFamily",
            json!(false),
            "invalid_policy_benchmark",
            Some("benchmark_gate"),
        ),
        (
            "comparability.sameStartingPoint",
            "/comparability/sameStartingPoint",
            json!(false),
            "invalid_policy_benchmark",
            Some("benchmark_gate"),
        ),
        (
            "comparability.samePermissions",
            "/comparability/samePermissions",
            json!(false),
            "invalid_policy_benchmark",
            Some("benchmark_gate"),
        ),
        (
            "comparability.sameBudget",
            "/comparability/sameBudget",
            json!(false),
            "invalid_policy_benchmark",
            Some("benchmark_gate"),
        ),
        (
            "comparability.deterministicAcceptance",
            "/comparability/deterministicAcceptance",
            json!(false),
            "invalid_policy_benchmark",
            Some("benchmark_gate"),
        ),
    ] {
        let mut unauthorized = production_benchmark.clone();
        *unauthorized
            .pointer_mut(pointer)
            .unwrap_or_else(|| panic!("benchmark pointer exists: {label}")) = replacement;
        let contract = outcome_contracts::validate_contract("benchmark_result", &unauthorized)
            .expect("dispatch benchmark contract");
        if let Some(expected_validation_code) = validation_code {
            assert!(
                contract
                    .errors
                    .iter()
                    .any(|error| error.code == expected_validation_code),
                "shared contract gate: {label}"
            );
        } else {
            assert!(contract.is_valid(), "valid registry-gate fixture: {label}");
        }
        let error = strict_registry
            .mark_benchmarked(
                draft["policyId"].as_str().expect("strict policy id"),
                2,
                &unauthorized,
            )
            .expect_err("strict production registry rejects unauthorized evidence");
        assert_eq!(error.code, error_code, "strict production gate: {label}");
        if let Some(expected_validation_code) = validation_code {
            assert!(error
                .validation_errors
                .iter()
                .any(|validation| validation.code == expected_validation_code));
        }
    }
    assert_contract("benchmark_result", &production_benchmark);
    assert_eq!(
        strict_registry
            .mark_benchmarked(
                draft["policyId"].as_str().expect("strict policy id"),
                2,
                &production_benchmark,
            )
            .expect("authorized Codex benchmark is accepted")["status"],
        "benchmarked"
    );
    let strict_plan = strict_registry
        .list_rollouts()
        .expect("list server-recorded production plan")
        .into_iter()
        .next()
        .expect("production benchmark persists rollout plan");
    assert_eq!(strict_plan["status"], "planned");
    assert_eq!(strict_plan["gates"]["benchmarkPassed"], true);
    assert_eq!(strict_plan["baselineVersion"], 1);
    assert_eq!(strict_plan["canaryShareBps"], 1_000);
    strict_registry
        .start_canary_from_benchmark(
            draft["policyId"].as_str().expect("strict policy id"),
            2,
            20_000,
        )
        .expect("start only from server-recorded production plan");
    let strict_canary = strict_registry
        .list_rollouts()
        .expect("list strict canary rollout")
        .into_iter()
        .next()
        .expect("strict canary rollout");
    assert_eq!(strict_canary["rolloutId"], strict_plan["rolloutId"]);
    assert_eq!(strict_canary["status"], "canary");
    assert_eq!(strict_canary["canaryShareBps"], 10_000);

    let no_plan_root = retained_temp_dir("policy-missing-verified-plan");
    let no_plan_registry = GenerationPolicyRegistry::open_with_clock(&no_plan_root, fixed_clock)
        .expect("open no-plan policy registry");
    no_plan_registry
        .register_policy(&draft)
        .expect("register candidate without stable baseline");
    no_plan_registry
        .mark_benchmarked(
            draft["policyId"].as_str().expect("no-plan policy id"),
            2,
            &production_benchmark,
        )
        .expect("benchmark candidate without baseline");
    assert!(no_plan_registry
        .list_rollouts()
        .expect("candidate without baseline has no plan")
        .is_empty());
    assert_eq!(
        no_plan_registry
            .start_canary_from_benchmark(
                draft["policyId"].as_str().expect("no-plan policy id"),
                2,
                1_000,
            )
            .expect_err("cannot start canary without server-recorded plan")
            .code,
        "verified_policy_rollout_plan_missing"
    );

    let ineligible_root = retained_temp_dir("policy-ineligible-benchmark-plan");
    let ineligible_registry =
        GenerationPolicyRegistry::open_with_clock(&ineligible_root, fixed_clock)
            .expect("open ineligible policy registry");
    ineligible_registry
        .register_policy(&strict_baseline)
        .expect("register ineligible-case stable baseline");
    let mut ineligible_candidate = draft.clone();
    ineligible_candidate["riskLevel"] = json!("high");
    ineligible_candidate["automaticRolloutEligible"] = json!(false);
    assert_contract("generation_policy", &ineligible_candidate);
    ineligible_registry
        .register_policy(&ineligible_candidate)
        .expect("register ineligible candidate");
    ineligible_registry
        .mark_benchmarked(
            ineligible_candidate["policyId"]
                .as_str()
                .expect("ineligible policy id"),
            2,
            &production_benchmark,
        )
        .expect("benchmark ineligible candidate");
    assert!(ineligible_registry
        .list_rollouts()
        .expect("ineligible candidate has no automatic plan")
        .is_empty());

    let root = retained_temp_dir("policy");
    let registry = GenerationPolicyRegistry::open_with_clock_and_options(
        &root,
        fixed_clock,
        GenerationPolicyRegistryOptions {
            allow_harness_only_benchmarks: true,
        },
    )
    .expect("open explicit harness policy registry");
    let mut baseline =
        compile_generation_policy_at(&compiler_input("project_policy", 1, 1), Some(FIXED_NOW))
            .expect("compile baseline");
    baseline["status"] = Value::String("stable".to_string());
    registry
        .register_policy(&baseline)
        .expect("register stable baseline");
    registry
        .register_policy(&draft)
        .expect("register draft candidate");
    let benchmark = valid_benchmark("model_family_fast");
    assert_contract("benchmark_result", &benchmark);
    let benchmarked = registry
        .mark_benchmarked(
            draft["policyId"].as_str().expect("policy id"),
            2,
            &benchmark,
        )
        .expect("mark benchmarked");
    assert_eq!(benchmarked["status"], "benchmarked");
    let persisted_plan = registry
        .list_rollouts()
        .expect("list persisted harness plan")
        .into_iter()
        .next()
        .expect("explicit harness benchmark creates a test plan");
    assert_eq!(persisted_plan["status"], "planned");
    assert_eq!(persisted_plan["gates"]["benchmarkPassed"], true);
    assert_eq!(persisted_plan["baselineVersion"], 1);
    let rollout = create_policy_rollout_at(
        &json!({
            "candidatePolicy": benchmarked,
            "baselinePolicy": baseline,
            "benchmarkResult": benchmark,
            "rolloutId": "rollout_policy_v1",
            "arms": rollout_arms(0, json!({}))
        }),
        Some(FIXED_NOW),
    )
    .expect("create canary rollout");
    assert_contract("policy_rollout", &rollout);
    assert_eq!(rollout["status"], "canary");
    assert_eq!(rollout["canaryShareBps"], 1000);
    registry
        .start_canary_from_benchmark(draft["policyId"].as_str().expect("policy id"), 2, 1_000)
        .expect("start canary from benchmark plan");
    let active_plan = registry
        .list_rollouts()
        .expect("list active benchmark plan")
        .into_iter()
        .next()
        .expect("active benchmark plan");
    assert_eq!(active_plan["rolloutId"], persisted_plan["rolloutId"]);
    assert_eq!(active_plan["status"], "canary");

    let context = json!({
        "projectScopeToken": "project_policy",
        "taskScenarioToken": "contract_implementation",
        "modelFamilyToken": "model_family_fast",
        "target": "codex",
        "assignmentToken": "generation_001"
    });
    let canary = registry
        .select_generation_policy_assignment_with_bucket(&context, Some(999))
        .expect("select canary")
        .expect("policy assignment");
    assert_eq!(canary.arm, "canary");
    assert_eq!(canary.policy["version"], 2);
    let stable = registry
        .select_generation_policy_assignment_with_bucket(&context, Some(1000))
        .expect("select stable")
        .expect("policy assignment");
    assert_eq!(stable.arm, "stable");
    assert_eq!(stable.policy["version"], 1);

    let mut stable_v1 =
        compile_generation_policy_at(&compiler_input("project_policy", 1, 1), Some(FIXED_NOW))
            .expect("compile selector stable v1");
    stable_v1["status"] = json!("stable");
    let mut newer_stable_v2 =
        compile_generation_policy_at(&compiler_input("project_policy", 2, 1), Some(FIXED_NOW))
            .expect("compile selector stable v2");
    newer_stable_v2["status"] = json!("stable");
    let mut canary_v3 =
        compile_generation_policy_at(&compiler_input("project_policy", 3, 1), Some(FIXED_NOW))
            .expect("compile selector canary v3");
    canary_v3["status"] = json!("canary");
    for policy in [&stable_v1, &newer_stable_v2, &canary_v3] {
        assert_contract("generation_policy", policy);
    }
    let mut rollout_v3 = rollout.clone();
    rollout_v3["rolloutId"] = json!("rollout_selector_v3_against_v1");
    rollout_v3["policyVersion"] = json!(3);
    rollout_v3["baselineVersion"] = json!(1);
    assert_contract("policy_rollout", &rollout_v3);
    let selector_policies = vec![
        stable_v1.clone(),
        newer_stable_v2.clone(),
        canary_v3.clone(),
    ];

    let bound_stable = learning_policy::select_generation_policy_assignment_from_snapshot_for_test(
        &selector_policies,
        &[rollout_v3.clone()],
        false,
        &context,
        Some(9_999),
    )
    .expect("select rollout-bound stable arm")
    .expect("bound stable assignment");
    assert_eq!(bound_stable.arm, "stable");
    assert_eq!(
        bound_stable.policy["version"], 1,
        "stable arm uses rollout.baselineVersion rather than the newest stable"
    );

    let untracked_canary =
        learning_policy::select_generation_policy_assignment_from_snapshot_for_test(
            &selector_policies,
            &[],
            false,
            &context,
            Some(0),
        )
        .expect("select with no canary rollout")
        .expect("latest stable fallback");
    assert_eq!(untracked_canary.arm, "stable");
    assert_eq!(
        untracked_canary.policy["version"], 2,
        "an untracked canary cannot receive a canary bucket"
    );
    assert_eq!(untracked_canary.bucket, None);

    let mut mismatched_rollout = rollout_v3.clone();
    mismatched_rollout["baselineVersion"] = json!(2);
    assert_contract("policy_rollout", &mismatched_rollout);
    let mismatched_baseline =
        learning_policy::select_generation_policy_assignment_from_snapshot_for_test(
            &selector_policies,
            &[mismatched_rollout],
            false,
            &context,
            Some(0),
        )
        .expect("select with mismatched rollout baseline")
        .expect("latest stable fallback for mismatch");
    assert_eq!(mismatched_baseline.arm, "stable");
    assert_eq!(mismatched_baseline.policy["version"], 2);

    let mut canary_missing_baseline = canary_v3.clone();
    canary_missing_baseline["baselineVersion"] = json!(2);
    assert_contract("generation_policy", &canary_missing_baseline);
    let mut missing_baseline_rollout = rollout_v3.clone();
    missing_baseline_rollout["baselineVersion"] = json!(2);
    assert_contract("policy_rollout", &missing_baseline_rollout);
    let missing_baseline =
        learning_policy::select_generation_policy_assignment_from_snapshot_for_test(
            &[stable_v1.clone(), canary_missing_baseline],
            &[missing_baseline_rollout],
            false,
            &context,
            Some(0),
        )
        .expect("select with missing recorded stable baseline")
        .expect("available stable fallback");
    assert_eq!(missing_baseline.arm, "stable");
    assert_eq!(missing_baseline.policy["version"], 1);

    assert_eq!(
        learning_policy::deterministic_bucket("stable-assignment", 10_000),
        learning_policy::deterministic_bucket("stable-assignment", 10_000)
    );

    registry.pause_learning("manual").expect("pause learning");
    assert!(registry.is_learning_paused().expect("paused state"));
    assert_eq!(
        registry
            .select_generation_policy_assignment_with_bucket(&context, Some(0))
            .expect("select while paused")
            .expect("stable fallback")
            .policy["version"],
        1
    );
    assert_eq!(registry.list_rollouts().unwrap()[0]["status"], "paused");
    registry.resume_learning().expect("resume learning");
    assert_eq!(registry.list_rollouts().unwrap()[0]["status"], "collecting");

    let collecting = registry.list_rollouts().unwrap().remove(0);
    let insufficient = evaluate_policy_rollout_at(
        &collecting,
        &json!({ "arms": rollout_arms(9, json!({})), "confidence": 0.99 }),
        Some(FIXED_NOW),
    )
    .expect("evaluate insufficient rollout");
    assert_eq!(insufficient.action, "continue_canary");
    assert_eq!(insufficient.rollout["status"], "collecting");
    assert_eq!(insufficient.evidence["enoughSamples"], false);
    registry
        .apply_rollout_evaluation(&insufficient)
        .expect("persist collecting rollout");

    for (event, reason) in [
        (json!({ "safetyIncident": true }), "safety_incident"),
        (json!({ "miswriteIncident": true }), "miswrite_incident"),
        (json!({ "noAutoSubmit": false }), "auto_submit_incident"),
        (json!({ "privacyIncident": true }), "privacy_incident"),
        (json!({ "permissionIncident": true }), "permission_incident"),
    ] {
        let incident = evaluate_policy_rollout_at(
            &insufficient.rollout,
            &json!({
                "events": [event],
                "arms": rollout_arms(0, json!({})),
                "confidence": 0.0
            }),
            Some(FIXED_NOW),
        )
        .expect("evaluate immediate hard-gate incident");
        assert_eq!(incident.action, "rollback");
        assert_eq!(incident.reason_token, reason);
    }

    let quality_regression = evaluate_policy_rollout_at(
        &insufficient.rollout,
        &json!({
            "arms": rollout_arms(10, json!({ "successRate": 0.6, "averageTokens": 700.0 })),
            "confidence": 0.99
        }),
        Some(FIXED_NOW),
    )
    .expect("quality hard gate overrides token gain");
    assert_eq!(quality_regression.action, "rollback");
    assert_eq!(quality_regression.reason_token, "quality_regression");

    let promotable = evaluate_policy_rollout_at(
        &insufficient.rollout,
        &json!({ "arms": rollout_arms(10, json!({})), "confidence": 0.95 }),
        Some(FIXED_NOW),
    )
    .expect("evaluate promotable rollout");
    assert_eq!(promotable.action, "promote");
    assert_eq!(promotable.rollout["status"], "promoted");
    assert_eq!(promotable.rollout["gates"]["taskQualityNotDegraded"], true);
    assert_eq!(promotable.rollout["gates"]["efficiencyImproved"], true);
    assert_eq!(
        promotable.rollout["gates"]["statisticalRequirementMet"],
        true
    );
    registry
        .apply_rollout_evaluation(&promotable)
        .expect("promote candidate");
    let policies = registry
        .list_policies()
        .expect("list policies after promotion");
    assert_eq!(
        policies
            .iter()
            .filter(|policy| policy["status"] == "stable")
            .count(),
        1,
        "an exact scope has one stable policy"
    );
    assert_eq!(
        registry
            .select_generation_policy_assignment_with_bucket(&context, Some(9999))
            .expect("select promoted stable")
            .expect("stable assignment")
            .policy["version"],
        2
    );

    registry
        .rollback_policy(draft["policyId"].as_str().expect("policy id"), 2, "manual")
        .expect("manual rollback");
    assert_eq!(
        registry
            .get_policy(draft["policyId"].as_str().unwrap(), 2)
            .unwrap()
            .unwrap()["status"],
        "rolled_back"
    );
    assert_eq!(
        registry
            .select_generation_policy_assignment_with_bucket(&context, Some(0))
            .expect("select restored baseline")
            .expect("baseline assignment")
            .policy["version"],
        1
    );
    let restarted = GenerationPolicyRegistry::open_with_clock(&root, fixed_clock)
        .expect("restart persisted policy registry");
    assert_eq!(
        restarted
            .get_policy(draft["policyId"].as_str().unwrap(), 2)
            .unwrap()
            .unwrap()["status"],
        "rolled_back"
    );
    assert!(!restarted
        .is_learning_paused()
        .expect("persisted pause state"));
}

#[test]
fn rollout_arm_summary_uses_only_attributable_outcomes() {
    let summary = learning_policy::summarize_rollout_arm(&[
        json!({
            "attributable": true,
            "taskOutcomeToken": "completed",
            "retryCount": 0,
            "undoUsed": false,
            "totalTokens": 100,
            "latencyMs": 10
        }),
        json!({
            "attributable": true,
            "taskOutcomeToken": "not_completed",
            "retryCount": 1,
            "undoUsed": true,
            "totalTokens": 200,
            "latencyMs": 20
        }),
        json!({
            "attributable": false,
            "taskOutcomeToken": "completed",
            "totalTokens": 1
        }),
    ]);
    assert_eq!(summary["attributableOutcomes"], 2);
    assert_eq!(summary["successRate"], 0.5);
    assert_eq!(summary["retryRate"], 0.5);
    assert_eq!(summary["undoRate"], 0.5);
    assert_eq!(summary["averageTokens"], 150.0);
    assert_eq!(summary["averageLatencyMs"], 15.0);
    assert_eq!(summary["averageReworkCount"], 0.5);
}

#[test]
fn rollout_token_summary_avoids_subtotal_double_counting_and_unavailable_data() {
    let summary = learning_policy::summarize_rollout_arm(&[
        json!({
            "taskOutcomeToken": "completed",
            "tokenAccountingSource": "provider",
            "inputTokens": 100,
            "outputTokens": 50,
            "cachedTokens": 40,
            "reasoningTokens": 20
        }),
        json!({
            "taskOutcomeToken": "completed",
            "tokenAccountingSource": "unavailable",
            "inputTokens": 9_999,
            "outputTokens": 9_999
        }),
    ]);

    assert_eq!(summary["attributableOutcomes"], 2);
    assert_eq!(summary["averageTokens"], 150.0);
}

#[test]
fn rollout_confidence_is_computed_from_observations() {
    let mut observations = Vec::new();
    for arm in ["baseline", "candidate"] {
        for _ in 0..10 {
            observations.push(json!({
                "arm": arm,
                "taskOutcomeToken": "completed",
                "retryCount": 0,
                "undoUsed": false,
                "tokenAccountingSource": "provider",
                "inputTokens": if arm == "baseline" { 100 } else { 80 },
                "outputTokens": 0,
                "latencyMs": if arm == "baseline" { 100 } else { 80 },
                "reworkCount": 0
            }));
        }
    }

    let confidence = estimate_rollout_confidence(&observations, None);
    assert_eq!(confidence["enoughSamples"], true);
    assert_eq!(confidence["confidence"], 1.0);
    assert_eq!(confidence["dimensions"]["efficiency"], 1.0);
}
