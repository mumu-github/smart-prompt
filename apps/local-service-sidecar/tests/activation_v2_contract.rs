#[path = "../src/activation_v2.rs"]
mod activation_v2;

use activation_v2::{
    begin_codex_loop, complete, complete_codex_activation, get_status, initialize,
    initialize_from_phase3, mark_codex_loop_started, migrate_from_phase3, record_model_ready,
    record_model_ready_at, reset, set_progress, set_runtime_health, state_file, ActivationError,
    ACTIVATION_PROGRESS, CODEX_ACTIVATION_PROGRESS, CODEX_ACTIVATION_SCHEMA_VERSION,
    REQUIRED_NATIVE_BUILD_ID, RUNTIME_HEALTH,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

fn retained_temp_root() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock must follow the Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "smart-prompt-native-codex-activation-v2-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&root).expect("create retained contract-test root");
    root
}

fn data_dir(root: &Path, name: &str) -> PathBuf {
    let dir = root.join(name);
    fs::create_dir_all(&dir).expect("create contract-test data directory");
    dir
}

fn assert_error_code(result: Result<Value, ActivationError>, expected: &str) {
    let error = result.expect_err("operation should be rejected");
    assert_eq!(error.status, 400);
    assert_eq!(error.code, expected);
    assert!(!error.message.is_empty());
}

fn assert_no_raw_evidence(value: &Value) {
    let serialized = serde_json::to_string(value).expect("serialize public status");
    for forbidden in [
        "SECRET_PROMPT_BODY",
        "SECRET_API_KEY",
        "private\\\\project",
        "SECRET_WINDOW_TITLE",
        "rawEvidence",
        "lastEventId",
        "completionEventId",
        "completionSignature",
        "nativeBuildId",
    ] {
        assert!(
            !serialized.contains(forbidden),
            "public status leaked {forbidden}: {serialized}"
        );
    }
}

fn assert_finite_status(status: &Value) {
    let reasons = [
        "codex_activation_not_started",
        "provider_configuration_required",
        "model_ready_codex_verification_required",
        "codex_verification_required",
        "codex_activation_complete",
        "runtime_repairing",
        "runtime_needs_repair",
    ];
    let actions = [
        "configure_provider",
        "test_model",
        "start_codex_loop",
        "complete_codex_loop",
        "open_assistant",
        "wait_for_runtime",
        "repair_runtime",
    ];
    assert!(reasons.contains(&status["reason"].as_str().unwrap_or("")));
    assert!(actions.contains(&status["nextAction"].as_str().unwrap_or("")));
    assert_no_raw_evidence(status);
}

#[test]
fn native_codex_activation_v2_matches_the_contract() {
    assert_eq!(CODEX_ACTIVATION_SCHEMA_VERSION, "codex-activation@2");
    assert_eq!(
        CODEX_ACTIVATION_PROGRESS,
        [
            "not_started",
            "configuring",
            "model_ready",
            "awaiting_codex_loop",
            "activated"
        ]
    );
    assert_eq!(ACTIVATION_PROGRESS, CODEX_ACTIVATION_PROGRESS);
    assert_eq!(RUNTIME_HEALTH, ["healthy", "repairing", "needs_repair"]);
    assert_eq!(
        REQUIRED_NATIVE_BUILD_ID,
        "phase3-native-sidecar-20260719-r18"
    );

    let root = retained_temp_root();
    println!("retained activation v2 test root: {}", root.display());

    let new_user_dir = data_dir(&root, "new-user");
    let phase3_file = new_user_dir.join("activation.json");
    let phase3_sentinel =
        "{\n  \"schemaVersion\": \"phase3-activation@1\",\n  \"marker\": \"untouched\"\n}\n";
    fs::write(&phase3_file, phase3_sentinel).expect("write phase 3 sentinel");

    let new_user = initialize(&new_user_dir, None).expect("initialize new user");
    assert_eq!(
        state_file(&new_user_dir),
        new_user_dir.join("activation-v2.json")
    );
    assert!(state_file(&new_user_dir).exists());
    assert_eq!(
        fs::read_to_string(&phase3_file).expect("read untouched phase 3 state"),
        phase3_sentinel
    );
    assert_eq!(
        new_user,
        json!({
            "schemaVersion": "codex-activation@2",
            "progress": "not_started",
            "runtimeHealth": "healthy",
            "provider": "",
            "modelTestedAt": "",
            "legacyActivated": false,
            "legacySummary": null,
            "codexVerified": false,
            "completedAt": "",
            "reason": "codex_activation_not_started",
            "nextAction": "configure_provider",
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
    );

    set_progress(
        &new_user_dir,
        "configuring",
        &json!({ "provider": "agnes" }),
    )
    .expect("enter provider configuration");
    assert_error_code(
        set_progress(&new_user_dir, "model_ready", &json!({})),
        "activation_model_test_required",
    );
    assert_error_code(
        record_model_ready_at(&new_user_dir, "agnes", "not-a-timestamp"),
        "invalid_activation_timestamp",
    );
    record_model_ready_at(&new_user_dir, "agnes", "2026-07-19T00:00:00.000Z")
        .expect("record successful model test");
    assert_eq!(
        get_status(&new_user_dir).unwrap()["progress"],
        "model_ready"
    );
    mark_codex_loop_started(&new_user_dir).expect("start Codex loop");
    assert_eq!(
        get_status(&new_user_dir).unwrap()["progress"],
        "awaiting_codex_loop"
    );
    assert_eq!(
        begin_codex_loop(&new_user_dir).unwrap()["progress"],
        "awaiting_codex_loop"
    );

    let migrated_dir = data_dir(&root, "legacy-activated");
    let migrated_phase3_file = migrated_dir.join("activation.json");
    fs::write(&migrated_phase3_file, phase3_sentinel).expect("write migration sentinel");
    let phase3_snapshot = json!({
        "schemaVersion": "phase3-activation@1",
        "progress": "activated",
        "runtimeHealth": "healthy",
        "provider": "custom-provider:tenant_7",
        "modelTestedAt": "2026-07-19T00:00:00.000Z",
        "completionKind": "verified_insert",
        "completionVerified": true,
        "completedAt": "2026-07-18T23:59:00.000Z",
        "lastEventId": "activation-verified_insert-1784419140000",
        "prompt": "SECRET_PROMPT_BODY",
        "apiKey": "SECRET_API_KEY",
        "projectPath": "C:\\Users\\private\\project",
        "rawTitle": "SECRET_WINDOW_TITLE",
        "rawEvidence": { "text": "SECRET_PROMPT_BODY" }
    });
    let migrated =
        initialize(&migrated_dir, Some(&phase3_snapshot)).expect("migrate phase 3 metadata");
    assert_eq!(migrated["schemaVersion"], "codex-activation@2");
    assert_eq!(migrated["progress"], "model_ready");
    assert_eq!(migrated["provider"], "custom-provider:tenant_7");
    assert_eq!(migrated["modelTestedAt"], "2026-07-19T00:00:00.000Z");
    assert_eq!(migrated["legacyActivated"], true);
    assert_eq!(migrated["codexVerified"], false);
    assert_eq!(
        migrated["legacySummary"],
        json!({
            "schemaVersion": "phase3-activation@1",
            "progress": "activated",
            "runtimeHealth": "healthy",
            "completionKind": "verified_insert",
            "completionVerified": true,
            "completedAt": "2026-07-18T23:59:00.000Z"
        })
    );
    assert_eq!(
        migrated["reason"],
        "model_ready_codex_verification_required"
    );
    assert_eq!(migrated["nextAction"], "start_codex_loop");
    assert_no_raw_evidence(&migrated);
    assert_eq!(
        fs::read_to_string(&migrated_phase3_file).unwrap(),
        phase3_sentinel
    );

    let migrated_raw_before = fs::read_to_string(state_file(&migrated_dir)).unwrap();
    let repeated_migration = migrate_from_phase3(
        &migrated_dir,
        &json!({
            "schemaVersion": "phase3-activation@1",
            "progress": "not_started",
            "provider": "openai-compatible"
        }),
    )
    .expect("repeat migration idempotently");
    assert_eq!(repeated_migration["provider"], "custom-provider:tenant_7");
    assert_eq!(repeated_migration["legacyActivated"], true);
    assert_eq!(
        fs::read_to_string(state_file(&migrated_dir)).unwrap(),
        migrated_raw_before
    );

    let unhealthy =
        set_runtime_health(&migrated_dir, "needs_repair").expect("record separate runtime health");
    assert_eq!(unhealthy["progress"], "model_ready");
    assert_eq!(unhealthy["legacyActivated"], true);
    assert_eq!(unhealthy["reason"], "runtime_needs_repair");
    assert_eq!(unhealthy["nextAction"], "repair_runtime");
    assert_no_raw_evidence(&unhealthy);
    set_runtime_health(&migrated_dir, "healthy").unwrap();
    mark_codex_loop_started(&migrated_dir).unwrap();

    let valid_completion = json!({
        "eventId": "activation-verified_insert-1784419201000",
        "target": "codex",
        "completionKind": "verified_insert",
        "targetKind": "codex-composer",
        "stableReadback": true,
        "verified": true,
        "noAutoSubmit": true,
        "nativeBuildId": REQUIRED_NATIVE_BUILD_ID,
        "prompt": "SECRET_PROMPT_BODY",
        "apiKey": "SECRET_API_KEY",
        "projectPath": "C:\\Users\\private\\project",
        "rawTitle": "SECRET_WINDOW_TITLE",
        "rawEvidence": { "text": "SECRET_PROMPT_BODY" }
    });

    let mut stale = valid_completion.clone();
    stale["eventId"] = json!("activation-verified_insert-1784419200000");
    assert_error_code(
        complete(&migrated_dir, &stale),
        "invalid_activation_event_id",
    );
    let mut copy_event = valid_completion.clone();
    copy_event["eventId"] = json!("activation-copy-1784419201000");
    assert_error_code(
        complete(&migrated_dir, &copy_event),
        "invalid_activation_event_id",
    );

    let invalid_mutations = [
        ("target", json!("chatgpt")),
        ("site", json!("chatgpt")),
        ("completionKind", json!("copy")),
        ("completionKind", json!("manual_confirmation")),
        ("targetKind", json!("chatgpt-composer")),
        ("stableReadback", json!(false)),
        ("verified", json!(false)),
        ("noAutoSubmit", json!(false)),
        ("nativeBuildId", json!("phase3-native-sidecar-stale")),
        ("nativeBuildId", json!("")),
    ];
    for (field, value) in invalid_mutations {
        let mut invalid = valid_completion.clone();
        invalid[field] = value;
        assert_error_code(
            complete(&migrated_dir, &invalid),
            "invalid_codex_activation_evidence",
        );
    }

    let completed = complete(&migrated_dir, &valid_completion)
        .expect("complete current-build verified Codex insertion");
    assert_eq!(completed["progress"], "activated");
    assert_eq!(completed["codexVerified"], true);
    assert_eq!(completed["legacyActivated"], true);
    assert_eq!(completed["reason"], "codex_activation_complete");
    assert_eq!(completed["nextAction"], "open_assistant");
    assert_no_raw_evidence(&completed);

    let persisted = fs::read_to_string(state_file(&migrated_dir)).unwrap();
    for forbidden in [
        "SECRET_PROMPT_BODY",
        "SECRET_API_KEY",
        "private\\\\project",
        "SECRET_WINDOW_TITLE",
        "rawEvidence",
    ] {
        assert!(
            !persisted.contains(forbidden),
            "persisted state leaked {forbidden}: {persisted}"
        );
    }

    set_runtime_health(&migrated_dir, "needs_repair").unwrap();
    let activated_unhealthy = get_status(&migrated_dir).unwrap();
    assert_eq!(activated_unhealthy["progress"], "activated");
    assert_eq!(activated_unhealthy["codexVerified"], true);
    assert_eq!(activated_unhealthy["runtimeHealth"], "needs_repair");

    let repeated_completion = complete_codex_activation(&migrated_dir, &valid_completion)
        .expect("replay exact completion idempotently");
    assert_eq!(repeated_completion, get_status(&migrated_dir).unwrap());
    assert_eq!(repeated_completion["runtimeHealth"], "needs_repair");

    let mut conflicting_flags = valid_completion.clone();
    conflicting_flags["noAutoSubmit"] = json!(false);
    assert_error_code(
        complete(&migrated_dir, &conflicting_flags),
        "activation_completion_conflict",
    );
    let mut conflicting_event = valid_completion.clone();
    conflicting_event["eventId"] = json!("activation-verified_insert-1784419202000");
    assert_error_code(
        complete(&migrated_dir, &conflicting_event),
        "activation_completion_conflict",
    );

    let restarted = initialize(
        &migrated_dir,
        Some(&json!({
            "schemaVersion": "phase3-activation@1",
            "progress": "activated",
            "provider": "gemini"
        })),
    )
    .expect("restart migrated store");
    assert_eq!(restarted, get_status(&migrated_dir).unwrap());
    assert_eq!(restarted["provider"], "custom-provider:tenant_7");
    assert_eq!(
        complete(&migrated_dir, &valid_completion).unwrap(),
        restarted
    );

    let reset_status = reset(&migrated_dir).expect("reset only Codex v2 progress");
    assert_eq!(reset_status["progress"], "not_started");
    assert_eq!(reset_status["codexVerified"], false);
    assert_eq!(reset_status["completedAt"], "");
    assert_eq!(reset_status["modelTestedAt"], "");
    assert_eq!(reset_status["provider"], "custom-provider:tenant_7");
    assert_eq!(reset_status["legacyActivated"], true);
    assert_eq!(reset_status["legacySummary"], migrated["legacySummary"]);
    assert_eq!(reset_status["runtimeHealth"], "needs_repair");
    assert_eq!(reset_status["reason"], "runtime_needs_repair");

    let after_reset_restart = initialize(&migrated_dir, Some(&phase3_snapshot)).unwrap();
    assert_eq!(after_reset_restart["progress"], "not_started");
    assert_eq!(after_reset_restart["provider"], "custom-provider:tenant_7");
    assert_eq!(after_reset_restart["legacyActivated"], true);
    assert_eq!(
        fs::read_to_string(&migrated_phase3_file).unwrap(),
        phase3_sentinel
    );

    let provider_only_dir = data_dir(&root, "provider-only");
    let provider_only = initialize_from_phase3(
        &provider_only_dir,
        &json!({
            "schemaVersion": "phase3-activation@1",
            "progress": "awaiting_first_loop",
            "runtimeHealth": "repairing",
            "provider": "openai-compatible"
        }),
    )
    .expect("migrate provider-only state");
    assert_eq!(provider_only["progress"], "configuring");
    assert_eq!(provider_only["provider"], "openai-compatible");
    assert_eq!(provider_only["legacyActivated"], false);
    assert_eq!(provider_only["runtimeHealth"], "repairing");
    assert_eq!(provider_only["reason"], "runtime_repairing");
    assert_eq!(provider_only["nextAction"], "wait_for_runtime");

    assert_error_code(
        initialize_from_phase3(
            &data_dir(&root, "bad-schema"),
            &json!({ "schemaVersion": "unsupported-activation@9" }),
        ),
        "invalid_phase3_activation_snapshot",
    );
    assert_error_code(
        set_runtime_health(&provider_only_dir, "offline"),
        "invalid_runtime_health",
    );

    let wrapper_api_dir = data_dir(&root, "wrapper-api");
    initialize(&wrapper_api_dir, None).unwrap();
    set_progress(
        &wrapper_api_dir,
        "configuring",
        &json!({ "provider": "agnes" }),
    )
    .unwrap();
    assert_eq!(
        record_model_ready(&wrapper_api_dir, "agnes").unwrap()["progress"],
        "model_ready"
    );

    for status in [new_user, migrated, completed, reset_status, provider_only] {
        assert_finite_status(&status);
    }
}
