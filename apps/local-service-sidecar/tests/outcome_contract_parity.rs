#[path = "../src/outcome_contracts.rs"]
mod outcome_contracts;

use outcome_contracts::{
    derive_edit_feature_summary, derive_learning_candidate_seed, infer_task_scenario,
    normalize_learning_candidate_seed, validate_contract, BUNDLE_VERSION, CONTRACT_VERSIONS,
    FIXTURE_SET_VERSION,
};
use serde::Deserialize;
use serde_json::Value;
use std::{collections::BTreeMap, fs, path::PathBuf};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureBundle {
    fixture_set_version: String,
    bundle_version: String,
    contract_versions: BTreeMap<String, String>,
    valid: Vec<Fixture>,
    invalid: Vec<InvalidFixture>,
}

#[derive(Debug, Deserialize)]
struct Fixture {
    id: String,
    contract: String,
    value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InvalidFixture {
    id: String,
    contract: String,
    expected_error_codes: Vec<String>,
    value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditSummaryFixtureBundle {
    schema_version: String,
    cases: Vec<EditSummaryFixture>,
}

#[derive(Debug, Deserialize)]
struct EditSummaryFixture {
    id: String,
    generated: String,
    inserted: String,
    expected: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LearningCandidateSeedFixtureBundle {
    schema_version: String,
    cases: Vec<LearningCandidateSeedFixture>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LearningCandidateSeedFixture {
    id: String,
    input: String,
    task_scenario_token: String,
    expected: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskScenarioInferenceFixtureBundle {
    schema_version: String,
    cases: Vec<TaskScenarioInferenceFixture>,
}

#[derive(Debug, Deserialize)]
struct TaskScenarioInferenceFixture {
    id: String,
    input: String,
    expected: String,
}

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/outcome-learning/contract-fixtures.json")
}

fn edit_summary_fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/outcome-learning/edit-feature-summary-fixtures.json")
}

fn learning_candidate_seed_fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/outcome-learning/learning-candidate-seed-fixtures.json")
}

fn task_scenario_inference_fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/outcome-learning/task-scenario-inference-fixtures.json")
}

#[test]
fn rust_validators_match_the_canonical_node_fixtures() {
    let fixture_path = fixture_path();
    let fixture_text = fs::read_to_string(&fixture_path)
        .unwrap_or_else(|error| panic!("read {}: {error}", fixture_path.display()));
    let fixtures: FixtureBundle = serde_json::from_str(&fixture_text)
        .unwrap_or_else(|error| panic!("parse {}: {error}", fixture_path.display()));

    assert_eq!(fixtures.fixture_set_version, FIXTURE_SET_VERSION);
    assert_eq!(fixtures.bundle_version, BUNDLE_VERSION);
    assert_eq!(fixtures.contract_versions.len(), CONTRACT_VERSIONS.len());
    for (contract, version) in CONTRACT_VERSIONS {
        assert_eq!(
            fixtures.contract_versions.get(contract).map(String::as_str),
            Some(version),
            "version drift for {contract}"
        );
    }

    let prompt_injection_fixture = fixtures
        .invalid
        .iter()
        .find(|fixture| fixture.id == "context-source-high-risk-injection-collected")
        .expect("canonical fixtures must retain the collected high-risk injection case");
    assert_eq!(prompt_injection_fixture.contract, "context_source");
    assert!(prompt_injection_fixture
        .expected_error_codes
        .iter()
        .any(|code| code == "prompt_injection_gate"));
    let prompt_injection_result = validate_contract(
        &prompt_injection_fixture.contract,
        &prompt_injection_fixture.value,
    )
    .expect("dispatch collected high-risk injection fixture");
    assert!(prompt_injection_result.errors.iter().any(|error| {
        error.code == "prompt_injection_gate" && error.path == "$.collectResult.promptInjectionRisk"
    }));

    for fixture in fixtures.valid {
        let result = validate_contract(&fixture.contract, &fixture.value)
            .unwrap_or_else(|error| panic!("{} dispatcher error: {error}", fixture.id));
        assert!(
            result.errors.is_empty(),
            "{} must have zero Rust validation errors: {:?}",
            fixture.id,
            result.errors
        );

        let version = fixtures
            .contract_versions
            .get(&fixture.contract)
            .expect("every fixture contract has a declared version");
        let version_result = validate_contract(version, &fixture.value)
            .unwrap_or_else(|error| panic!("{} version dispatcher error: {error}", fixture.id));
        assert!(
            version_result.is_valid(),
            "{} must also dispatch by contract version: {:?}",
            fixture.id,
            version_result.errors
        );
    }

    for fixture in fixtures.invalid {
        let result = validate_contract(&fixture.contract, &fixture.value)
            .unwrap_or_else(|error| panic!("{} dispatcher error: {error}", fixture.id));
        assert!(!result.is_valid(), "{} must be rejected", fixture.id);
        for expected_code in fixture.expected_error_codes {
            assert!(
                result
                    .errors
                    .iter()
                    .any(|error| error.code == expected_code),
                "{} missing {expected_code}: {:?}",
                fixture.id,
                result.errors
            );
        }
    }
}

#[test]
fn rust_edit_summaries_match_the_canonical_node_fixtures() {
    let fixture_path = edit_summary_fixture_path();
    let fixture_text = fs::read_to_string(&fixture_path)
        .unwrap_or_else(|error| panic!("read {}: {error}", fixture_path.display()));
    let fixtures: EditSummaryFixtureBundle = serde_json::from_str(&fixture_text)
        .unwrap_or_else(|error| panic!("parse {}: {error}", fixture_path.display()));
    assert_eq!(fixtures.schema_version, "edit-feature-summary-fixtures@1");
    for fixture in fixtures.cases {
        assert_eq!(
            derive_edit_feature_summary(&fixture.generated, &fixture.inserted),
            fixture.expected,
            "{}",
            fixture.id
        );
    }
}

#[test]
fn rust_learning_candidate_seeds_match_the_canonical_node_fixtures() {
    let fixture_path = learning_candidate_seed_fixture_path();
    let fixture_text = fs::read_to_string(&fixture_path)
        .unwrap_or_else(|error| panic!("read {}: {error}", fixture_path.display()));
    let fixtures: LearningCandidateSeedFixtureBundle = serde_json::from_str(&fixture_text)
        .unwrap_or_else(|error| panic!("parse {}: {error}", fixture_path.display()));
    assert_eq!(
        fixtures.schema_version,
        "learning-candidate-seed-fixtures@1"
    );
    for fixture in fixtures.cases {
        let actual = derive_learning_candidate_seed(&fixture.input, &fixture.task_scenario_token);
        assert_eq!(actual, fixture.expected, "{}", fixture.id);
        if let Some(seed) = actual {
            assert_eq!(
                normalize_learning_candidate_seed(&seed),
                Some(seed),
                "{}",
                fixture.id
            );
        }
    }
}

#[test]
fn rust_task_scenario_inference_matches_the_canonical_node_fixtures() {
    let fixture_path = task_scenario_inference_fixture_path();
    let fixture_text = fs::read_to_string(&fixture_path)
        .unwrap_or_else(|error| panic!("read {}: {error}", fixture_path.display()));
    let fixtures: TaskScenarioInferenceFixtureBundle = serde_json::from_str(&fixture_text)
        .unwrap_or_else(|error| panic!("parse {}: {error}", fixture_path.display()));
    assert_eq!(
        fixtures.schema_version,
        "task-scenario-inference-fixtures@1"
    );
    for fixture in fixtures.cases {
        assert_eq!(
            infer_task_scenario(&fixture.input),
            fixture.expected,
            "{}",
            fixture.id
        );
    }
}
