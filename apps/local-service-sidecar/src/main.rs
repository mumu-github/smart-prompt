mod activation;
mod activation_v2;
mod credential_store;
mod learning_policy;
mod outcome_contracts;
mod pending_outcomes;
mod target_adapter;

use rand::{rngs::OsRng, RngCore};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

use learning_policy::{GenerationPolicyRegistry, LearningPolicyStore};
use target_adapter::{
    CodexTargetAdapter, PowerShellProbeRunner, ProbeRunner, TargetLease, VerifiedTransactionHandle,
};

const DEFAULT_PORT: u16 = 17371;
const SERVICE_NAME: &str = "smart-prompt-local-service";
const VERSION: &str = "0.5.0-native";
const RUNTIME_CONTRACT: &str = "phase3-native-runtime@1";
const BUILD_ID: &str = "phase3-native-sidecar-20260719-r18";
const EXTENSION_ORIGIN: &str = "chrome-extension://fnpfpobenlbgdkjadiaeopdpnodeegpj";
const GENERATION_BINDING_TTL_MS: i64 = 2 * 60 * 60 * 1_000;
const TARGET_ROUTE_LEASE_GRACE_MS: i64 = 10 * 1_000;

type ProductionTargetAdapter = CodexTargetAdapter<Box<dyn ProbeRunner + Send>>;

struct NativeRuntime {
    target: Mutex<TargetRuntime>,
    governance: Mutex<()>,
    learning: LearningPolicyStore,
    policies: GenerationPolicyRegistry,
}

struct TargetRuntime {
    adapter: ProductionTargetAdapter,
    state: TargetRouteState,
}

#[derive(Default)]
struct TargetRouteState {
    revision: u64,
    target_leases: HashMap<String, TargetLeaseBinding>,
    generation_bindings: HashMap<String, GenerationBinding>,
    insert_receipts: HashMap<String, InsertReceipt>,
    undo_bindings: HashMap<String, UndoBinding>,
    transaction_bindings: HashMap<String, TransactionBinding>,
}

#[derive(Clone)]
struct TargetLeaseBinding {
    draft_hash: String,
    project_scope_token: String,
    expires_at_ms: i64,
}

#[derive(Clone)]
struct GenerationBinding {
    generation_id: String,
    session_id: String,
    project_scope_token: String,
    strategy_id: String,
    strategy_version: String,
    model_family_token: String,
    task_scenario_token: String,
    mode_token: String,
    policy_id: Option<String>,
    policy_version: Option<u64>,
    learning_candidate_seed: Option<Value>,
    generated_prompt: String,
    edit_feature_summary: Option<Value>,
    expires_at_ms: i64,
}

#[derive(Clone)]
struct InsertReceipt {
    project_scope_token: String,
    expires_at_ms: i64,
    response: Value,
}

#[derive(Clone)]
struct UndoBinding {
    invalidated: bool,
    project_scope_token: String,
    generation: GenerationBinding,
    outcome_id: String,
}

#[derive(Clone)]
struct TransactionBinding {
    project_scope_token: String,
    expires_at_ms: i64,
    transaction: VerifiedTransactionHandle,
    outcome_id: String,
    generation_id: String,
}

impl NativeRuntime {
    fn production(data_dir: &Path) -> Result<Self, String> {
        let runner = PowerShellProbeRunner::from_environment().map_err(|error| error.code)?;
        Self::with_runner(data_dir, Box::new(runner))
    }

    fn with_runner(data_dir: &Path, runner: Box<dyn ProbeRunner + Send>) -> Result<Self, String> {
        pending_outcomes::initialize(data_dir).map_err(|error| error.to_string())?;
        let learning_root = data_dir.join("outcome-learning-v1");
        let learning =
            LearningPolicyStore::open(&learning_root).map_err(|error| error.to_string())?;
        let policies =
            GenerationPolicyRegistry::open(&learning_root).map_err(|error| error.to_string())?;
        Ok(Self {
            target: Mutex::new(TargetRuntime {
                adapter: CodexTargetAdapter::new(runner),
                state: TargetRouteState::default(),
            }),
            governance: Mutex::new(()),
            learning,
            policies,
        })
    }
}

#[derive(Debug)]
struct ProviderFailure {
    code: &'static str,
    message: &'static str,
}

impl ProviderFailure {
    fn credential_invalid() -> Self {
        Self {
            code: "credential_invalid",
            message: "Provider credentials were rejected.",
        }
    }

    fn model_unavailable() -> Self {
        Self {
            code: "model_unavailable",
            message: "The selected model is unavailable for this provider.",
        }
    }

    fn network_unavailable() -> Self {
        Self {
            code: "network_unavailable",
            message: "The provider could not be reached.",
        }
    }

    fn provider_error() -> Self {
        Self {
            code: "provider_error",
            message: "The provider returned an unexpected error.",
        }
    }

    fn from_ureq(error: ureq::Error) -> Self {
        match error {
            ureq::Error::Status(status, response) => {
                let body = response.into_string().unwrap_or_default();
                classify_provider_failure(status, &body)
            }
            ureq::Error::Transport(_) => Self::network_unavailable(),
        }
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let data_dir = data_dir()?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let _ = private_settings(&data_dir)?;
    initialize_activation(&data_dir)?;
    let runtime = Arc::new(NativeRuntime::production(&data_dir)?);
    let requested_port = env::var("SMART_PROMPT_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    let (server, port, port_recovered) = bind_server(requested_port)?;
    write_json(
        &data_dir.join("sidecar-port.json"),
        &json!({
            "requestedPort": requested_port,
            "port": port,
            "portRecovery": port_recovered,
            "updatedAt": now()
        }),
    )?;
    log_event(
        &data_dir,
        "sidecar_started",
        json!({
            "requestedPort": requested_port,
            "port": port,
            "portRecovery": port_recovered
        }),
    );

    for request in server.incoming_requests() {
        let data_dir = data_dir.clone();
        let runtime = Arc::clone(&runtime);
        thread::spawn(move || {
            handle_request(request, &data_dir, port, &runtime);
        });
    }
    Ok(())
}

fn bind_server(requested_port: u16) -> Result<(Server, u16, bool), String> {
    let address = format!("127.0.0.1:{requested_port}");
    Server::http(&address)
        .map(|server| (server, requested_port, false))
        .map_err(|_| format!("Smart Prompt local-service port {requested_port} is unavailable."))
}

fn handle_request(mut request: Request, data_dir: &Path, port: u16, runtime: &NativeRuntime) {
    let method = request.method().clone();
    let url = request.url().to_string();
    let path = url.split('?').next().unwrap_or("/");

    if request_origin(&request).is_some_and(|origin| !is_trusted_origin(origin)) {
        send_json(
            request,
            403,
            json!({
                "ok": false,
                "error": {
                    "code": "origin_not_allowed",
                    "message": "Origin is not allowed for Smart Prompt local service."
                }
            }),
        );
        return;
    }

    if path == "/auth/bootstrap" && !is_bootstrap_origin_allowed(request_origin(&request)) {
        send_json_without_cors_origin(
            request,
            403,
            json!({
                "ok": false,
                "error": {
                    "code": "bootstrap_origin_not_allowed",
                    "message": "This browser origin cannot bootstrap Smart Prompt local service authentication."
                }
            }),
        );
        return;
    }

    if method == Method::Options {
        send_json(request, 200, json!({ "ok": true }));
        return;
    }

    if is_activation_event_route(&method, path)
        && request_origin(&request) != Some(EXTENSION_ORIGIN)
    {
        send_json(
            request,
            403,
            json!({
                "ok": false,
                "error": {
                    "code": "activation_extension_origin_required",
                    "message": "Activation evidence must come from the Smart Prompt extension."
                }
            }),
        );
        return;
    }

    if !is_public(&method, path) && !is_authorized(&request, data_dir) {
        send_json(
            request,
            401,
            json!({
                "ok": false,
                "error": {
                    "code": "auth_required",
                    "message": "Smart Prompt local service auth token is required."
                }
            }),
        );
        return;
    }

    let body = if method == Method::Post || method == Method::Put {
        let mut text = String::new();
        if let Err(error) = request.as_reader().read_to_string(&mut text) {
            eprintln!("failed to read request body for {path}: {error}");
            send_json(
                request,
                400,
                json!({
                    "ok": false,
                    "error": {
                        "code": "invalid_request_body",
                        "message": "Failed to read request body."
                    }
                }),
            );
            return;
        }
        if text.trim().is_empty() {
            json!({})
        } else {
            match serde_json::from_str(&text) {
                Ok(value) => value,
                Err(error) => {
                    eprintln!("failed to parse request JSON for {path}: {error}");
                    send_json(
                        request,
                        400,
                        json!({
                            "ok": false,
                            "error": {
                                "code": "invalid_json",
                                "message": "Request body must be valid JSON."
                            }
                        }),
                    );
                    return;
                }
            }
        }
    } else {
        json!({})
    };

    let result = route(method, path, &url, body, data_dir, port, runtime);
    match result {
        Ok((status, value)) => send_json(request, status, value),
        Err(error) => send_json(
            request,
            500,
            json!({
                "ok": false,
                "error": {
                    "code": "sidecar_error",
                    "message": error
                }
            }),
        ),
    }
}

fn route(
    method: Method,
    path: &str,
    url: &str,
    body: Value,
    data_dir: &Path,
    port: u16,
    runtime: &NativeRuntime,
) -> Result<(u16, Value), String> {
    if let Some(result) = route_outcome_learning(&method, path, url, &body, data_dir, runtime) {
        return result;
    }
    match (method, path) {
        (Method::Get, "/health") => Ok((
            200,
            json!({
                "ok": true,
                "service": SERVICE_NAME,
                "version": VERSION,
                "sidecar": "native",
                "runtimeContract": RUNTIME_CONTRACT,
                "buildId": BUILD_ID,
                "authRequired": true,
                "activationContract": activation::SCHEMA_VERSION,
                "activationContracts": {
                    "legacy": activation::SCHEMA_VERSION,
                    "codex": activation_v2::SCHEMA_VERSION
                },
                "outcomeLearningContract": outcome_contracts::CONTRACT_VERSIONS
                    .iter()
                    .find(|(name, _)| *name == "pending_outcome")
                    .map(|(_, version)| *version)
                    .unwrap_or("pending-outcome@1"),
                "codexTargetAdapter": {
                    "available": true,
                    "contractVersion": target_adapter::ADAPTER_VERSION,
                    "driverContractVersion": target_adapter::DRIVER_SCHEMA_VERSION
                },
                "port": port
            }),
        )),
        (Method::Get, "/auth/bootstrap") => Ok((
            200,
            json!({
                "ok": true,
                "auth": {
                    "scheme": "Bearer",
                    "header": "Authorization",
                    "tokenHeader": "X-Smart-Prompt-Token",
                    "token": get_auth_token(data_dir)?
                }
            }),
        )),
        (Method::Get, "/settings") => Ok((
            200,
            json!({
                "ok": true,
                "settings": public_settings(data_dir)?
            }),
        )),
        (Method::Put, "/settings") => {
            let settings = body.get("settings").cloned().unwrap_or(body);
            if let Err(error) = save_settings(data_dir, settings) {
                if let Some(response) = settings_validation_response(&error) {
                    return Ok(response);
                }
                return Err(error);
            }
            Ok((
                200,
                json!({ "ok": true, "settings": public_settings(data_dir)? }),
            ))
        }
        (Method::Get, "/llm/providers") => Ok((200, provider_status(data_dir)?)),
        (Method::Post, "/llm/test") => {
            let mode = body.get("mode").and_then(Value::as_str).unwrap_or("idea");
            let candidate = body
                .get("settings")
                .filter(|value| value.is_object())
                .cloned();
            let persist_on_success = candidate.is_some()
                && body.get("persistOnSuccess").and_then(Value::as_bool) == Some(true);
            let settings = if let Some(next) = candidate {
                match prepare_settings(data_dir, next) {
                    Ok(settings) => settings,
                    Err(error) => {
                        if let Some(response) = settings_validation_response(&error) {
                            return Ok(response);
                        }
                        return Err(error);
                    }
                }
            } else {
                private_settings(data_dir)?
            };
            let effective = effective_provider_settings(&settings);
            let prompt = match generate_with_provider(
                &effective,
                "Generate a short Smart Prompt provider connectivity check.",
                mode,
                &[],
                0,
                None,
            ) {
                Ok(prompt) => prompt,
                Err(error) => return Ok(provider_failure_response(error, "llm_test")),
            };
            if persist_on_success {
                persist_settings(data_dir, &settings)?;
            }
            if body.get("settings").is_none() || persist_on_success {
                activation::record_model_ready(
                    data_dir,
                    effective
                        .get("provider")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                )
                .map_err(|_| "activation_state_update_failed".to_string())?;
                record_codex_activation_model_ready(
                    data_dir,
                    effective
                        .get("provider")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                )?;
            }
            Ok((
                200,
                json!({
                    "ok": true,
                    "provider": effective["provider"],
                    "model": effective["model"],
                    "mode": mode,
                    "generatedBy": "llm",
                    "promptLength": prompt.len(),
                    "skillCount": 0,
                    "uploadWholePage": false,
                    "autoSubmit": false,
                    "settingsPersisted": persist_on_success,
                    "testedAt": now()
                }),
            ))
        }
        (Method::Get, "/activation/status") => {
            Ok(activation_response(activation::get_status(data_dir)))
        }
        (Method::Post, "/activation/browser-seen") => {
            if body.get("contractVersion").and_then(Value::as_str)
                != Some(activation::SCHEMA_VERSION)
            {
                return Ok((
                    400,
                    json!({
                        "ok": false,
                        "error": {
                            "code": "activation_contract_mismatch",
                            "message": "Activation contract version is not supported."
                        }
                    }),
                ));
            }
            Ok(activation_response(activation::mark_browser_seen(
                data_dir,
                body.get("site")
                    .and_then(Value::as_str)
                    .unwrap_or("chatgpt"),
                body.get("seenAt").and_then(Value::as_str).unwrap_or(""),
            )))
        }
        (Method::Post, "/activation/complete") => {
            if body.get("contractVersion").and_then(Value::as_str)
                != Some(activation::SCHEMA_VERSION)
            {
                return Ok((
                    400,
                    json!({
                        "ok": false,
                        "error": {
                            "code": "activation_contract_mismatch",
                            "message": "Activation contract version is not supported."
                        }
                    }),
                ));
            }
            Ok(activation_response(activation::complete(
                data_dir,
                body.get("eventId").and_then(Value::as_str).unwrap_or(""),
                body.get("site")
                    .and_then(Value::as_str)
                    .unwrap_or("chatgpt"),
                body.get("completionKind")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                body.get("targetKind").and_then(Value::as_str).unwrap_or(""),
                body.get("stableReadback")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                body.get("extensionBuildId")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                body.get("verified")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                body.get("copied").and_then(Value::as_bool).unwrap_or(false),
            )))
        }
        (Method::Post, "/activation/reset") => Ok(activation_response(activation::reset(data_dir))),
        (Method::Post, "/activation/runtime-health") => {
            let runtime_health = body
                .get("runtimeHealth")
                .and_then(Value::as_str)
                .unwrap_or("");
            let legacy = activation::set_runtime_health(
                data_dir,
                runtime_health,
                body.get("errorCode").and_then(Value::as_str).unwrap_or(""),
            );
            let _ = activation_v2::set_runtime_health(data_dir, runtime_health);
            Ok(activation_response(legacy))
        }
        (Method::Get, "/activation/codex/status") => Ok(codex_activation_response(
            activation_v2::get_status(data_dir),
        )),
        (Method::Post, "/activation/codex/loop-start") => {
            if body.get("contractVersion").and_then(Value::as_str)
                != Some(activation_v2::SCHEMA_VERSION)
            {
                return Ok(codex_activation_contract_mismatch());
            }
            Ok(codex_activation_response(
                activation_v2::mark_codex_loop_started(data_dir),
            ))
        }
        (Method::Post, "/activation/codex/complete") => {
            complete_codex_activation_from_transaction(data_dir, runtime, &body)
        }
        (Method::Post, "/activation/codex/reset") => {
            if body.get("contractVersion").and_then(Value::as_str)
                != Some(activation_v2::SCHEMA_VERSION)
            {
                return Ok(codex_activation_contract_mismatch());
            }
            Ok(codex_activation_response(activation_v2::reset(data_dir)))
        }
        (Method::Post, "/activation/codex/runtime-health") => {
            if body.get("contractVersion").and_then(Value::as_str)
                != Some(activation_v2::SCHEMA_VERSION)
            {
                return Ok(codex_activation_contract_mismatch());
            }
            Ok(codex_activation_response(
                activation_v2::set_runtime_health(
                    data_dir,
                    body.get("runtimeHealth")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                ),
            ))
        }
        (Method::Get, "/skills") => Ok((
            200,
            json!({ "ok": true, "skills": read_array(data_dir, "skills.json")? }),
        )),
        (Method::Post, "/skills/import-folder") => {
            let imported =
                import_skill_folder(body.get("path").and_then(Value::as_str).unwrap_or(""))?;
            let mut skills = read_array(data_dir, "skills.json")?;
            for skill in imported.iter().rev() {
                let id = skill.get("id").and_then(Value::as_str).unwrap_or("");
                skills.retain(|item| item.get("id").and_then(Value::as_str).unwrap_or("") != id);
                skills.insert(0, skill.clone());
            }
            write_json(&data_dir.join("skills.json"), &Value::Array(skills.clone()))?;
            Ok((
                200,
                json!({ "ok": true, "imported": imported, "skills": skills }),
            ))
        }
        (Method::Delete, _) if path.starts_with("/skills/") => {
            let id = decode_path_id(path.trim_start_matches("/skills/"));
            let mut skills = read_array(data_dir, "skills.json")?;
            let before = skills.len();
            skills.retain(|item| item.get("id").and_then(Value::as_str).unwrap_or("") != id);
            write_json(&data_dir.join("skills.json"), &Value::Array(skills.clone()))?;
            if skills.len() == before {
                Ok((
                    404,
                    json!({ "ok": false, "error": { "code": "skill_not_found", "message": "Skill not found." } }),
                ))
            } else {
                Ok((200, json!({ "ok": true, "skills": skills })))
            }
        }
        (Method::Post, "/skills/recommend") => {
            let input = body.get("input").and_then(Value::as_str).unwrap_or("");
            let skills = recommend_skills(input, &read_array(data_dir, "skills.json")?);
            Ok((200, json!({ "ok": true, "skills": skills })))
        }
        (Method::Get, "/prompts") => Ok((
            200,
            json!({ "ok": true, "prompts": read_array(data_dir, "prompts.json")? }),
        )),
        (Method::Post, "/prompts") => {
            let prompts = add_prompt(data_dir, body)?;
            Ok((
                200,
                json!({ "ok": true, "prompt": prompts.first().cloned().unwrap_or(json!({})), "prompts": prompts }),
            ))
        }
        (Method::Delete, _) if path.starts_with("/prompts/") => {
            let id = decode_path_id(path.trim_start_matches("/prompts/"));
            let mut prompts = read_array(data_dir, "prompts.json")?;
            let before = prompts.len();
            prompts.retain(|item| item.get("id").and_then(Value::as_str).unwrap_or("") != id);
            write_json(
                &data_dir.join("prompts.json"),
                &Value::Array(prompts.clone()),
            )?;
            if prompts.len() == before {
                Ok((
                    404,
                    json!({ "ok": false, "error": { "code": "prompt_not_found", "message": "Prompt not found." } }),
                ))
            } else {
                Ok((200, json!({ "ok": true, "prompts": prompts })))
            }
        }
        (Method::Get, "/search") => search(data_dir, url),
        (Method::Get, "/data/backup") => {
            Ok((200, json!({ "ok": true, "backup": export_data(data_dir)? })))
        }
        (Method::Post, "/data/restore") => {
            let restored = restore_data(data_dir, body.get("backup").cloned().unwrap_or(body))?;
            Ok((200, json!({ "ok": true, "restored": restored })))
        }
        (Method::Delete, "/data/all") => {
            let reset = clear_all_local_data(data_dir, port)?;
            Ok((
                200,
                json!({ "ok": true, "reset": reset, "clearAllLocalData": true }),
            ))
        }
        (Method::Get, "/metrics") => Ok((
            200,
            json!({ "ok": true, "metrics": metrics_summary(data_dir)? }),
        )),
        (Method::Post, "/metrics") => {
            let metrics = record_metric(data_dir, body.get("event").cloned().unwrap_or(body))?;
            Ok((
                200,
                json!({ "ok": true, "metric": metrics.first().cloned().unwrap_or(json!({})), "metrics": metrics_summary(data_dir)? }),
            ))
        }
        (Method::Post, "/generate") => generate_response(data_dir, runtime, &body),
        (Method::Get, "/diagnostics/export") => Ok((
            200,
            json!({
                "ok": true,
                "diagnostics": export_diagnostics(data_dir, port)?
            }),
        )),
        (Method::Get, "/desktop/input-snapshot") => Ok((
            200,
            json!({
                "ok": true,
                "snapshot": desktop_input_snapshot(url)?
            }),
        )),
        (Method::Post, "/desktop/fill") => {
            let fill = desktop_input_fill(url, &body)?;
            write_json(
                &data_dir.join("desktop-fill-latest.json"),
                &json!({
                    "schemaVersion": "m3-desktop-fill-latest@1",
                    "recordedAt": now(),
                    "fill": sanitize_desktop_fill_evidence(&fill)
                }),
            )?;
            Ok((
                200,
                json!({
                    "ok": true,
                    "fill": fill
                }),
            ))
        }
        (Method::Get, "/desktop/fill/latest") => Ok((
            200,
            json!({
                "ok": true,
                "desktopFill": read_json(&data_dir.join("desktop-fill-latest.json"), Value::Null)?
            }),
        )),
        (Method::Post, "/desktop/prompt-state") => {
            let prompt_state = sanitize_desktop_prompt_state(&body);
            write_json(
                &data_dir.join("desktop-prompt-state-latest.json"),
                &prompt_state,
            )?;
            Ok((
                200,
                json!({
                    "ok": true,
                    "desktopPrompt": prompt_state
                }),
            ))
        }
        (Method::Get, "/desktop/prompt-state") => Ok((
            200,
            json!({
                "ok": true,
                "desktopPrompt": read_json(&data_dir.join("desktop-prompt-state-latest.json"), Value::Null)?
            }),
        )),
        _ => Ok((
            404,
            json!({ "ok": false, "error": { "code": "not_found", "message": format!("{path}") } }),
        )),
    }
}

fn route_outcome_learning(
    method: &Method,
    path: &str,
    url: &str,
    body: &Value,
    data_dir: &Path,
    runtime: &NativeRuntime,
) -> Option<Result<(u16, Value), String>> {
    if method == &Method::Get && path == "/outcomes/v2" {
        let filters = query_object(url, &["target", "projectScopeToken", "status"]);
        return Some(Ok(pending_response(
            "outcomes",
            pending_outcomes::list_outcomes(data_dir, &filters),
        )));
    }
    if method == &Method::Get && path == "/outcomes/v2/signals" {
        let filters = query_object(url, &["target", "projectScopeToken", "outcomeId"]);
        return Some(Ok(pending_response(
            "signals",
            pending_outcomes::list_implicit_signals(data_dir, &filters),
        )));
    }
    if method == &Method::Post && path == "/outcomes/v2/events" {
        let event = body.get("event").unwrap_or(body);
        if event.get("policyId").is_some_and(|value| !value.is_null())
            || event
                .get("policyVersion")
                .is_some_and(|value| !value.is_null())
        {
            return Some(Ok(target_error_response(
                400,
                "untrusted_policy_attribution",
                "Policy attribution is assigned only by the verified Codex transaction path.",
            )));
        }
        if event.get("eventType").and_then(Value::as_str) == Some("verified_insert") {
            return Some(Ok(target_error_response(
                400,
                "verified_insert_server_transaction_required",
                "Verified insert outcomes are created only by the server-owned Codex transaction path.",
            )));
        }
        if event.get("eventType").and_then(Value::as_str) != Some("verified_insert") {
            if let Some(outcome_id) = event.get("outcomeId").and_then(Value::as_str) {
                match pending_outcomes::get_outcome(data_dir, outcome_id) {
                    Ok(outcome)
                        if !outcome["policyId"].is_null()
                            || !outcome["policyVersion"].is_null() =>
                    {
                        return Some(Ok(target_error_response(
                            400,
                            "untrusted_policy_signal",
                            "Policy rollout signals are recorded only by verified server transactions.",
                        )));
                    }
                    Ok(_) => {}
                    Err(error) => return Some(Ok(pending_response("result", Err(error)))),
                }
            }
        }
        return Some(Ok(pending_response(
            "result",
            pending_outcomes::record_event(data_dir, event),
        )));
    }
    if method == &Method::Post && path == "/outcomes/v2/claim" {
        return Some(Ok(pending_response(
            "result",
            pending_outcomes::claim_next_feedback(data_dir, body),
        )));
    }
    if method == &Method::Post && path == "/outcomes/v2/feedback" {
        return Some(Ok(submit_outcome_feedback_route(data_dir, runtime, body)));
    }

    if method == &Method::Get && path == "/learning/v1/observations" {
        let scope = query_first(url, "projectScopeToken");
        let observations =
            runtime
                .learning
                .list_observations(scope.as_deref())
                .map(|observations| {
                    observations
                        .iter()
                        .map(public_learning_observation)
                        .collect::<Vec<_>>()
                });
        return Some(Ok(learning_response("observations", observations)));
    }
    if method == &Method::Get && path == "/learning/v1/artifacts" {
        let scope = query_first(url, "projectScopeToken");
        let status = query_first(url, "status");
        let artifact_type = query_first(url, "artifactType");
        return Some(Ok(learning_response(
            "artifacts",
            runtime.learning.list_artifacts(
                scope.as_deref(),
                status.as_deref(),
                artifact_type.as_deref(),
            ),
        )));
    }
    if method == &Method::Get && path == "/learning/v1/candidate" {
        let artifact_id = query_first(url, "artifactId").unwrap_or_default();
        return Some(Ok(learning_response(
            "candidate",
            runtime.learning.get_candidate_detail(&artifact_id),
        )));
    }
    if method == &Method::Get && path == "/learning/v1/reminder" {
        let scope = query_first(url, "projectScopeToken").unwrap_or_default();
        let features = query_values(url, "featureToken");
        return Some(Ok(learning_response(
            "reminder",
            runtime.learning.get_card_reminder(&scope, &features),
        )));
    }
    if method == &Method::Post && path == "/learning/v1/reminder/resolve" {
        if !only_fields(
            body,
            &[
                "projectScopeToken",
                "input",
                "taskScenarioToken",
                "modeToken",
            ],
        ) {
            return Some(Ok(target_error_response(
                400,
                "unexpected_learning_reminder_field",
                "Learning reminder matching accepts only transient task features.",
            )));
        }
        let project_scope_token = body
            .get("projectScopeToken")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !valid_opaque_token(project_scope_token, 180) {
            return Some(Ok(target_error_response(
                400,
                "invalid_project_scope_token",
                "A private project scope token is required.",
            )));
        }
        let input = body
            .get("input")
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .take(20_000)
            .collect::<String>();
        let task_scenario_token = bounded_token(
            body.get("taskScenarioToken")
                .and_then(Value::as_str)
                .unwrap_or_else(|| outcome_contracts::infer_task_scenario(&input)),
            "general",
            120,
        );
        let mode_token = bounded_token(
            body.get("modeToken")
                .and_then(Value::as_str)
                .unwrap_or_else(|| detect_mode(&input)),
            "standard",
            80,
        );
        let settings = match private_settings(data_dir) {
            Ok(settings) => effective_provider_settings(&settings),
            Err(error) => return Some(Err(error)),
        };
        let model_family_token = bounded_token(
            settings
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or("configured_model"),
            "configured_model",
            120,
        );
        let learning_candidate_seed =
            outcome_contracts::derive_learning_candidate_seed(&input, &task_scenario_token);
        let mut feature_tokens = vec![
            format!("scenario:{task_scenario_token}"),
            format!("mode:{mode_token}"),
            format!("model:{model_family_token}"),
            "target:codex".to_string(),
        ];
        if let Some(pattern) = learning_candidate_seed
            .as_ref()
            .and_then(|seed| seed["patternToken"].as_str())
        {
            feature_tokens.push(format!("learning:{pattern}"));
        }
        return Some(Ok(
            match runtime
                .learning
                .get_card_reminder(project_scope_token, &feature_tokens)
            {
                Ok(reminder) => (
                    200,
                    json!({ "ok": true, "reminder": reminder, "featureTokens": feature_tokens }),
                ),
                Err(error) => learning_error_response(error),
            },
        ));
    }
    if method == &Method::Post && path == "/learning/v1/candidates/ignore" {
        let artifact_id = body.get("artifactId").and_then(Value::as_str).unwrap_or("");
        return Some(Ok(learning_response(
            "candidate",
            runtime.learning.ignore_candidate(artifact_id),
        )));
    }
    if method == &Method::Post && path == "/learning/v1/candidates/review" {
        let artifact_id = body.get("artifactId").and_then(Value::as_str).unwrap_or("");
        let decision = body.get("decision").unwrap_or(body);
        return Some(Ok(review_learning_candidate_route(
            runtime,
            artifact_id,
            decision,
        )));
    }
    if method == &Method::Post && path == "/learning/v1/candidates/skill-gates" {
        let artifact_id = body.get("artifactId").and_then(Value::as_str).unwrap_or("");
        return Some(Ok(learning_response(
            "candidate",
            runtime
                .learning
                .set_skill_gates(artifact_id, body.get("gates").unwrap_or(&json!({}))),
        )));
    }
    if method == &Method::Post && path == "/learning/v1/promotion-evidence" {
        return Some(Ok(target_error_response(
            400,
            "promotion_evidence_server_derivation_required",
            "Global promotion evidence is derived only from verified stored outcomes.",
        )));
    }
    if method == &Method::Get && path == "/learning/v1/global-proposals" {
        return Some(Ok(learning_response(
            "proposals",
            runtime.learning.list_global_proposals(),
        )));
    }
    if method == &Method::Post && path == "/learning/v1/global-proposals/confirm" {
        let proposal_id = body.get("proposalId").and_then(Value::as_str).unwrap_or("");
        let confirmed = body.get("confirmed").and_then(Value::as_bool) == Some(true);
        return Some(Ok(learning_response(
            "artifact",
            runtime
                .learning
                .confirm_global_proposal(proposal_id, confirmed),
        )));
    }
    if method == &Method::Post && path == "/privacy/v1/projects/clear" {
        let scope = body
            .get("projectScopeToken")
            .and_then(Value::as_str)
            .unwrap_or("");
        return Some(Ok(clear_project_route(data_dir, runtime, scope)));
    }

    if method == &Method::Get && path == "/policies/v1" {
        return Some(Ok(list_policies_route(url, runtime)));
    }
    if method == &Method::Get && path == "/policies/v1/rollouts" {
        return Some(Ok(list_rollouts_route(url, runtime)));
    }
    if method == &Method::Post && path == "/policies/v1/compile" {
        return Some(Ok(compile_policy_route(runtime, body)));
    }
    if method == &Method::Post && path == "/policies/v1/benchmarked" {
        return Some(Ok(target_error_response(
            400,
            "policy_benchmark_server_evidence_required",
            "Benchmark evidence must be recorded by the authorized server-side benchmark harness.",
        )));
    }
    if method == &Method::Post && path == "/policies/v1/canary" {
        if !only_fields(body, &["policyId", "version", "canaryShareBps"]) {
            return Some(Ok(target_error_response(
                400,
                "unexpected_policy_canary_field",
                "Canary startup only accepts a policy identity and share; rollout evidence is server-recorded.",
            )));
        }
        let policy_id = body.get("policyId").and_then(Value::as_str).unwrap_or("");
        let version = body.get("version").and_then(Value::as_u64).unwrap_or(0);
        if policy_id.trim().is_empty() || version == 0 {
            return Some(Ok(target_error_response(
                400,
                "invalid_policy_canary_request",
                "Canary startup requires a policyId and an explicit positive version.",
            )));
        }
        let canary_share_bps = match body.get("canaryShareBps") {
            None => learning_policy::DEFAULT_CANARY_SHARE_BPS as u64,
            Some(value) => match value.as_u64() {
                Some(value @ 1..=10_000) => value,
                _ => {
                    return Some(Ok(target_error_response(
                        400,
                        "invalid_policy_canary_share",
                        "canaryShareBps must be an integer between 1 and 10000.",
                    )))
                }
            },
        };
        return Some(Ok(learning_response(
            "policy",
            runtime
                .policies
                .start_canary_from_benchmark(policy_id, version, canary_share_bps),
        )));
    }
    if method == &Method::Post && path == "/policies/v1/evaluate" {
        return Some(Ok(evaluate_policy_route(data_dir, runtime, body)));
    }
    if method == &Method::Post && path == "/policies/v1/rollback" {
        if !only_fields(body, &["policyId", "version", "reason"]) {
            return Some(Ok(target_error_response(
                400,
                "unexpected_policy_rollback_field",
                "Rollback only accepts a policyId, version, and optional reason.",
            )));
        }
        let policy_id = body.get("policyId").and_then(Value::as_str).unwrap_or("");
        let version = body.get("version").and_then(Value::as_u64).unwrap_or(0);
        let reason = match body.get("reason") {
            None => "manual",
            Some(value) => match value.as_str() {
                Some(value) => value,
                None => {
                    return Some(Ok(target_error_response(
                        400,
                        "invalid_policy_rollback_request",
                        "Rollback reason must be a string.",
                    )))
                }
            },
        };
        if policy_id.trim().is_empty() || version == 0 {
            return Some(Ok(target_error_response(
                400,
                "invalid_policy_rollback_request",
                "Rollback requires a policyId and an explicit positive version.",
            )));
        }
        return Some(Ok(learning_response(
            "policy",
            runtime.policies.rollback_policy(policy_id, version, reason),
        )));
    }
    if method == &Method::Post && path == "/policies/v1/pause" {
        if !only_fields(body, &["reason"])
            || body.get("reason").and_then(Value::as_str) != Some("manual")
        {
            return Some(Ok(target_error_response(
                400,
                "invalid_policy_pause_request",
                "Global learning pause requires exactly { reason: 'manual' }.",
            )));
        }
        return Some(Ok(learning_response(
            "state",
            runtime.policies.pause_learning("manual"),
        )));
    }
    if method == &Method::Post && path == "/policies/v1/resume" {
        if !only_fields(body, &[]) {
            return Some(Ok(target_error_response(
                400,
                "invalid_policy_resume_request",
                "Global learning resume requires an empty request object.",
            )));
        }
        return Some(Ok(learning_response(
            "state",
            runtime.policies.resume_learning(),
        )));
    }

    if method == &Method::Post && path == "/target/codex/inspect" {
        return Some(Ok(target_inspect_route(runtime, body)));
    }
    if method == &Method::Post && path == "/target/codex/read" {
        return Some(Ok(target_read_route(runtime, body)));
    }
    if method == &Method::Post && path == "/target/codex/insert" {
        return Some(Ok(target_insert_route(data_dir, runtime, body)));
    }
    if method == &Method::Post && path == "/target/codex/undo" {
        return Some(Ok(target_undo_route(data_dir, runtime, body)));
    }
    None
}

fn pending_response(
    field: &str,
    result: Result<Value, pending_outcomes::PendingOutcomeError>,
) -> (u16, Value) {
    match result {
        Ok(value) => {
            let mut payload = json!({ "ok": true });
            payload[field] = value;
            (200, payload)
        }
        Err(error) => (
            error.status,
            json!({
                "ok": false,
                "error": {
                    "code": error.code,
                    "message": error.message,
                    "details": error.details
                }
            }),
        ),
    }
}

fn learning_response<T: serde::Serialize>(
    field: &str,
    result: Result<T, learning_policy::LearningPolicyError>,
) -> (u16, Value) {
    match result {
        Ok(value) => {
            let mut payload = json!({ "ok": true });
            payload[field] = serde_json::to_value(value).unwrap_or(Value::Null);
            (200, payload)
        }
        Err(error) => learning_error_response(error),
    }
}

fn public_learning_observation(observation: &Value) -> Value {
    let fingerprint = observation
        .get("semanticFingerprint")
        .and_then(Value::as_object);
    let fingerprint_string = |field: &str, fallback: &str| {
        fingerprint
            .and_then(|value| value.get(field))
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .unwrap_or(fallback)
            .to_string()
    };
    let fingerprint_bool = |field: &str| {
        fingerprint
            .and_then(|value| value.get(field))
            .and_then(Value::as_bool)
            == Some(true)
    };
    let mut public = observation.as_object().cloned().unwrap_or_default();
    public.insert(
        "semanticFingerprint".to_string(),
        json!({
            "kind": fingerprint_string("kind", "keyed_feature_hash"),
            "projectScoped": fingerprint
                .and_then(|value| value.get("projectScoped"))
                .and_then(Value::as_bool)
                != Some(false),
            "encryptedAtRest": fingerprint_bool("encryptedAtRest"),
            "exportable": false,
            "absoluteIrreversibilityClaimed": false,
            "inversionRiskTested": fingerprint_bool("inversionRiskTested"),
            "membershipInferenceRiskTested": fingerprint_bool("membershipInferenceRiskTested"),
            "residualRisk": fingerprint_string("residualRisk", "unknown")
        }),
    );
    Value::Object(public)
}

fn learning_error_response(error: learning_policy::LearningPolicyError) -> (u16, Value) {
    let status = if error.code.contains("not_found") || error.code.ends_with("_missing") {
        404
    } else if error.code.contains("conflict")
        || error.code.contains("not_pending")
        || error.code.contains("threshold_not_met")
    {
        409
    } else if error.code.contains("storage") || error.code.contains("corrupt") {
        500
    } else {
        400
    };
    let details = error
        .validation_errors
        .iter()
        .map(|detail| {
            json!({
                "code": detail.code,
                "path": detail.path,
                "message": detail.message
            })
        })
        .collect::<Vec<_>>();
    (
        status,
        json!({
            "ok": false,
            "error": {
                "code": error.code,
                "message": error.message,
                "details": details
            }
        }),
    )
}

fn query_object(url: &str, keys: &[&str]) -> Value {
    let mut value = serde_json::Map::new();
    for key in keys {
        if let Some(item) = query_first(url, key) {
            if !item.is_empty() {
                value.insert((*key).to_string(), Value::String(item));
            }
        }
    }
    Value::Object(value)
}

fn query_first(url: &str, key: &str) -> Option<String> {
    query_values(url, key).into_iter().next()
}

fn query_values(url: &str, key: &str) -> Vec<String> {
    url.split_once('?')
        .map(|(_, query)| {
            query
                .split('&')
                .filter_map(|pair| {
                    let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
                    (percent_decode(name) == key).then(|| percent_decode(value))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = (bytes[index + 1] as char).to_digit(16);
            let low = (bytes[index + 2] as char).to_digit(16);
            if let (Some(high), Some(low)) = (high, low) {
                decoded.push(((high << 4) | low) as u8);
                index += 3;
                continue;
            }
        }
        decoded.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn submit_outcome_feedback_route(
    data_dir: &Path,
    runtime: &NativeRuntime,
    body: &Value,
) -> (u16, Value) {
    let mut feedback = serde_json::Map::new();
    for key in [
        "feedbackId",
        "requestId",
        "eventId",
        "outcomeId",
        "taskOutcomeToken",
        "outcome",
        "reasonToken",
        "failureReasonToken",
    ] {
        if let Some(value) = body.get(key) {
            feedback.insert(key.to_string(), value.clone());
        }
    }
    if let Some(outcome_id) = feedback.get("outcomeId").and_then(Value::as_str) {
        match pending_outcomes::get_outcome(data_dir, outcome_id) {
            Ok(outcome) if outcome["status"] == "invalidated" => {
                return target_error_response(
                    409,
                    "pending_outcome_invalidated",
                    "Invalidated outcomes cannot accept feedback.",
                )
            }
            Ok(_) => {}
            Err(error) => return pending_response("result", Err(error)),
        }
    }
    let result = match pending_outcomes::submit_outcome_feedback(data_dir, &Value::Object(feedback))
    {
        Ok(result) => result,
        Err(error) => return pending_response("result", Err(error)),
    };
    let status = result
        .pointer("/outcome/status")
        .and_then(Value::as_str)
        .unwrap_or("");
    let (learning, policy_evaluation) = if matches!(status, "succeeded" | "failed") {
        let trusted_binding =
            match trusted_generation_binding_for_outcome(data_dir, runtime, &result["outcome"]) {
                Ok(binding) => binding,
                Err(response) => return response,
            };
        let implicit_signals = match pending_outcomes::list_implicit_signals(
            data_dir,
            &json!({ "outcomeId": result["outcome"]["outcomeId"] }),
        ) {
            Ok(signals) => signals.as_array().cloned().unwrap_or_default(),
            Err(error) => return pending_response("result", Err(error)),
        };
        let _guard = match runtime.governance.lock() {
            Ok(guard) => guard,
            Err(_) => {
                return (
                    500,
                    json!({ "ok": false, "error": { "code": "learning_storage_error", "message": "Learning coordination lock is unavailable." } }),
                )
            }
        };
        let trusted_policy_binding = trusted_binding.as_ref().filter(|binding| {
            binding.policy_id.is_some()
                && binding.policy_id.as_deref() == result["outcome"]["policyId"].as_str()
                && binding.policy_version == result["outcome"]["policyVersion"].as_u64()
        });
        let baseline_policy = if let Some(binding) = trusted_policy_binding {
            let scope = json!({
                "kind": "project",
                "target": "codex",
                "projectScopeToken": binding.project_scope_token,
                "taskScenarioToken": binding.task_scenario_token,
                "modelFamilyToken": binding.model_family_token
            });
            match ensure_baseline_generation_policy(runtime, &scope) {
                Ok(policy) => Some(policy),
                Err(error) => return learning_error_response(error),
            }
        } else {
            None
        };
        let observation = observation_from_stored_feedback(
            &result["outcome"],
            trusted_binding.as_ref(),
            &implicit_signals,
            baseline_policy.as_ref(),
        );
        match runtime.learning.record_observation(&observation) {
            Ok(value) => {
                let learning = serde_json::to_value(value).unwrap_or(Value::Null);
                let policy_evaluation =
                    match evaluate_active_policy_rollout(data_dir, runtime, &result["outcome"]) {
                        Ok(value) => value.unwrap_or(Value::Null),
                        Err(response) => return response,
                    };
                (learning, policy_evaluation)
            }
            Err(error) => return learning_error_response(error),
        }
    } else {
        (Value::Null, Value::Null)
    };
    (
        200,
        json!({
            "ok": true,
            "result": result,
            "learning": learning,
            "policyEvaluation": policy_evaluation
        }),
    )
}

fn trusted_generation_binding_for_outcome(
    data_dir: &Path,
    runtime: &NativeRuntime,
    outcome: &Value,
) -> Result<Option<GenerationBinding>, (u16, Value)> {
    let Some(generation_id) = outcome.get("generationId").and_then(Value::as_str) else {
        return Ok(None);
    };
    let target = runtime.target.lock().map_err(|_| {
        target_error_response(
            500,
            "codex_target_state_unavailable",
            "Codex target state is unavailable.",
        )
    })?;
    let binding = target.state.generation_bindings.get(generation_id).cloned();
    let memory_binding = binding.filter(|binding| {
        binding.generation_id == generation_id
            && binding.session_id == outcome["sessionId"].as_str().unwrap_or_default()
            && binding.project_scope_token
                == outcome["projectScopeToken"].as_str().unwrap_or_default()
            && binding.expires_at_ms >= unix_timestamp_millis()
            && binding.edit_feature_summary.is_some()
    });
    drop(target);
    if memory_binding.is_some() {
        return Ok(memory_binding);
    }
    let history = read_array(data_dir, "prompt-history.json").map_err(|_| {
        target_error_response(
            500,
            "generation_history_unavailable",
            "Verified generation history is unavailable.",
        )
    })?;
    let entry = history.iter().find(|entry| {
        entry.get("generationId").and_then(Value::as_str) == Some(generation_id)
            && entry.get("sessionId").and_then(Value::as_str)
                == outcome.get("sessionId").and_then(Value::as_str)
            && entry.get("projectScopeToken").and_then(Value::as_str)
                == outcome.get("projectScopeToken").and_then(Value::as_str)
            && entry.get("verifiedInsertEvidence").and_then(Value::as_bool) == Some(true)
            && entry
                .get("editFeatureSummary")
                .is_some_and(Value::is_object)
    });
    Ok(entry.map(|entry| GenerationBinding {
        generation_id: generation_id.to_string(),
        session_id: entry["sessionId"].as_str().unwrap_or_default().to_string(),
        project_scope_token: entry["projectScopeToken"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        strategy_id: bounded_token(
            entry["strategyId"].as_str().unwrap_or("baseline"),
            "baseline",
            180,
        ),
        strategy_version: bounded_token(
            entry["strategyVersion"].as_str().unwrap_or("v1"),
            "v1",
            80,
        ),
        model_family_token: bounded_token(
            entry["modelFamilyToken"]
                .as_str()
                .unwrap_or("unknown_model"),
            "unknown_model",
            120,
        ),
        task_scenario_token: bounded_token(
            entry["taskScenarioToken"]
                .as_str()
                .unwrap_or("unknown_scenario"),
            "unknown_scenario",
            120,
        ),
        mode_token: bounded_token(entry["mode"].as_str().unwrap_or("standard"), "standard", 80),
        policy_id: entry["policyId"].as_str().map(str::to_string),
        policy_version: entry["policyVersion"].as_u64(),
        learning_candidate_seed: entry
            .get("learningCandidateSeed")
            .and_then(outcome_contracts::normalize_learning_candidate_seed),
        generated_prompt: String::new(),
        edit_feature_summary: entry.get("editFeatureSummary").cloned(),
        expires_at_ms: i64::MAX,
    }))
}

fn observation_from_stored_feedback(
    outcome: &Value,
    trusted_binding: Option<&GenerationBinding>,
    implicit_signals: &[Value],
    baseline_policy: Option<&Value>,
) -> Value {
    let scenario = trusted_binding
        .map(|binding| binding.task_scenario_token.as_str())
        .unwrap_or("unknown_scenario");
    let mode = trusted_binding
        .map(|binding| binding.mode_token.as_str())
        .unwrap_or("standard");
    let strategy = trusted_binding
        .map(|binding| binding.strategy_id.as_str())
        .unwrap_or("baseline");
    let strategy_version = trusted_binding
        .map(|binding| binding.strategy_version.as_str())
        .unwrap_or("v1");
    let model = trusted_binding
        .map(|binding| binding.model_family_token.as_str())
        .unwrap_or("unknown_model");
    let retry_count = implicit_signals
        .iter()
        .filter(|signal| {
            matches!(
                signal.get("eventType").and_then(Value::as_str),
                Some("retry" | "regenerated")
            )
        })
        .count();
    let undo_used = implicit_signals
        .iter()
        .any(|signal| signal.get("eventType").and_then(Value::as_str) == Some("undo"));
    let edit_feature_summary = trusted_binding
        .and_then(|binding| binding.edit_feature_summary.clone())
        .unwrap_or_else(|| {
            json!({
                "userEdited": false,
                "lengthDeltaBucket": "none",
                "structureChanged": false
            })
        });
    let learning_candidate_seed = trusted_binding
        .and_then(|binding| binding.learning_candidate_seed.as_ref())
        .and_then(outcome_contracts::normalize_learning_candidate_seed);
    let mut feature_tokens = vec![
        format!("scenario:{scenario}"),
        format!("mode:{mode}"),
        format!("model:{model}"),
        "target:codex".to_string(),
    ];
    if let Some(pattern) = learning_candidate_seed
        .as_ref()
        .and_then(|seed| seed["patternToken"].as_str())
    {
        feature_tokens.push(format!("learning:{pattern}"));
    }
    let rollout_eligible = baseline_policy.is_some();
    let candidate = learning_candidate_seed
        .as_ref()
        .map(|seed| {
            json!({
                "artifactType": seed["artifactType"],
                "payload": seed["payload"]
            })
        })
        .or_else(|| {
            baseline_policy.map(|policy| {
                json!({
                    "artifactType": "generation_policy",
                    "payload": {
                        "policyId": policy["policyId"],
                        "policyVersion": policy["version"].as_u64().unwrap_or_default() + 1
                    }
                })
            })
        })
        .unwrap_or(Value::Null);
    json!({
        "projectScopeToken": outcome["projectScopeToken"],
        "sessionId": outcome["sessionId"],
        "outcomeId": outcome["outcomeId"],
        "featureTokens": feature_tokens,
        "taskScenarioToken": scenario,
        "modeToken": mode,
        "strategyId": strategy,
        "strategyVersion": strategy_version,
        "modelFamilyToken": model,
        "contextSourceTokens": [],
        "editFeatureSummary": edit_feature_summary,
        "insertVerified": true,
        "retryCount": retry_count,
        "undoUsed": undo_used,
        "outcomeStatus": outcome["status"],
        "failureReasonTokens": outcome["failureReasonTokens"],
        "explicitNegativeFeedback": outcome["status"] == "failed",
        "inputTokens": null,
        "outputTokens": null,
        "cachedTokens": null,
        "reasoningTokens": null,
        "insertedPromptTokenEstimate": null,
        "latencyMs": 0,
        "tokenAccountingSource": "unavailable",
        "rolloutEligible": rollout_eligible,
        "candidate": candidate
    })
}

fn review_learning_candidate_route(
    runtime: &NativeRuntime,
    artifact_id: &str,
    decision: &Value,
) -> (u16, Value) {
    let _guard = match runtime.governance.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return (
                500,
                json!({ "ok": false, "error": { "code": "learning_storage_error", "message": "Learning coordination lock is unavailable." } }),
            )
        }
    };
    let action = decision.get("action").and_then(Value::as_str).unwrap_or("");
    let mut registered_policy: Option<(String, u64)> = None;
    if action == "accept" {
        let detail = match runtime.learning.get_candidate_detail(artifact_id) {
            Ok(detail) => detail,
            Err(error) => return learning_error_response(error),
        };
        if detail.artifact["artifactType"] == "generation_policy" {
            match compile_candidate_policy(runtime, &detail.artifact) {
                Ok(policy) => match runtime.policies.register_policy(&policy) {
                    Ok(registered) => {
                        registered_policy = Some((
                            registered["policyId"].as_str().unwrap_or("").to_string(),
                            registered["version"].as_u64().unwrap_or(0),
                        ));
                    }
                    Err(error) => return learning_error_response(error),
                },
                Err(error) => return learning_error_response(error),
            }
        }
    }
    match runtime.learning.review_candidate(artifact_id, decision) {
        Ok(candidate) => (200, json!({ "ok": true, "candidate": candidate })),
        Err(error) => {
            if let Some((policy_id, version)) = registered_policy {
                let _ = runtime
                    .policies
                    .rollback_policy(&policy_id, version, "manual");
            }
            learning_error_response(error)
        }
    }
}

fn compile_candidate_policy(
    runtime: &NativeRuntime,
    artifact: &Value,
) -> Result<Value, learning_policy::LearningPolicyError> {
    let mut input = artifact
        .get("payload")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));
    let project_scope_token = artifact
        .pointer("/scope/projectScopeToken")
        .and_then(Value::as_str)
        .unwrap_or("");
    let task_scenario_token = input
        .pointer("/scope/taskScenarioToken")
        .and_then(Value::as_str)
        .unwrap_or("general")
        .to_string();
    let model_family_token = input
        .pointer("/scope/modelFamilyToken")
        .and_then(Value::as_str)
        .unwrap_or("configured_model")
        .to_string();
    let scope = json!({
        "kind": "project",
        "target": "codex",
        "projectScopeToken": project_scope_token,
        "taskScenarioToken": task_scenario_token,
        "modelFamilyToken": model_family_token
    });
    let baseline = ensure_baseline_generation_policy(runtime, &scope)?;
    input["scope"] = scope;
    input["policyId"] = baseline["policyId"].clone();
    input["baselineVersion"] = baseline["version"].clone();
    input["version"] = json!(baseline["version"].as_u64().unwrap_or(0) + 1);
    input["automaticRolloutEligible"] = Value::Bool(true);
    learning_policy::compile_generation_policy(&input)
}

fn clear_project_route(
    data_dir: &Path,
    runtime: &NativeRuntime,
    project_scope_token: &str,
) -> (u16, Value) {
    let _guard = match runtime.governance.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return (
                500,
                json!({ "ok": false, "error": { "code": "learning_storage_error", "message": "Learning coordination lock is unavailable." } }),
            )
        }
    };
    let mut target = match runtime.target.lock() {
        Ok(target) => target,
        Err(_) => {
            return target_error_response(
                500,
                "codex_target_state_unavailable",
                "Codex target state is unavailable; project data was not cleared.",
            )
        }
    };
    let learning = match runtime.learning.clear_project_data(project_scope_token) {
        Ok(result) => result,
        Err(error) => return learning_error_response(error),
    };
    let prompt_history = match archive_and_clear_project_prompt_history(
        data_dir,
        &learning.archive_dir,
        project_scope_token,
    ) {
        Ok(count) => count,
        Err(_) => {
            return target_error_response(
                500,
                "generation_history_clear_failed",
                "Project generation history could not be archived and invalidated.",
            )
        }
    };
    let pending = match pending_outcomes::invalidate_project(data_dir, project_scope_token) {
        Ok(result) => result,
        Err(error) => return pending_response("result", Err(error)),
    };
    let target_transactions = invalidate_target_project(&mut target, project_scope_token);
    let mut counts = serde_json::to_value(&learning.counts).unwrap_or_else(|_| json!({}));
    counts["pendingOutcomes"] = pending["invalidatedCount"].clone();
    counts["promptHistory"] = json!(prompt_history);
    counts["targetTransactions"] = json!(target_transactions);
    (
        200,
        json!({
            "ok": true,
            "result": {
                "projectScopeToken": learning.project_scope_token,
                "archiveToken": learning.archive_token,
                "invalidatedAt": learning.invalidated_at,
                "keyArchived": learning.key_archived,
                "counts": counts
            }
        }),
    )
}

fn list_policies_route(url: &str, runtime: &NativeRuntime) -> (u16, Value) {
    let policies = match runtime.policies.list_policies() {
        Ok(policies) => policies,
        Err(error) => return learning_error_response(error),
    };
    let filters = [
        ("status", "/status"),
        ("policyId", "/policyId"),
        ("projectScopeToken", "/scope/projectScopeToken"),
        ("taskScenarioToken", "/scope/taskScenarioToken"),
        ("modelFamilyToken", "/scope/modelFamilyToken"),
        ("target", "/scope/target"),
    ];
    let filtered = policies
        .into_iter()
        .filter(|policy| {
            filters.iter().all(|(query, pointer)| {
                query_first(url, query).is_none_or(|expected| {
                    policy.pointer(pointer).and_then(Value::as_str) == Some(expected.as_str())
                })
            })
        })
        .collect::<Vec<_>>();
    match runtime.policies.is_learning_paused() {
        Ok(paused) => (
            200,
            json!({ "ok": true, "learningPaused": paused, "policies": filtered }),
        ),
        Err(error) => learning_error_response(error),
    }
}

fn list_rollouts_route(url: &str, runtime: &NativeRuntime) -> (u16, Value) {
    let rollouts = match runtime.policies.list_rollouts() {
        Ok(rollouts) => rollouts,
        Err(error) => return learning_error_response(error),
    };
    let status = query_first(url, "status");
    let policy_id = query_first(url, "policyId");
    let policy_version =
        query_first(url, "policyVersion").and_then(|value| value.parse::<u64>().ok());
    let filtered = rollouts
        .into_iter()
        .filter(|rollout| {
            status
                .as_deref()
                .is_none_or(|value| rollout["status"].as_str() == Some(value))
                && policy_id
                    .as_deref()
                    .is_none_or(|value| rollout["policyId"].as_str() == Some(value))
                && policy_version
                    .is_none_or(|value| rollout["policyVersion"].as_u64() == Some(value))
        })
        .collect::<Vec<_>>();
    (200, json!({ "ok": true, "rollouts": filtered }))
}

fn compile_policy_route(runtime: &NativeRuntime, body: &Value) -> (u16, Value) {
    let _guard = match runtime.governance.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return (
                500,
                json!({ "ok": false, "error": { "code": "policy_registry_storage_error", "message": "Policy coordination lock is unavailable." } }),
            )
        }
    };
    let input = body.get("policy").unwrap_or(body);
    let policy = match learning_policy::compile_generation_policy(input) {
        Ok(policy) => policy,
        Err(error) => return learning_error_response(error),
    };
    if body.get("register").and_then(Value::as_bool) == Some(false) {
        (200, json!({ "ok": true, "policy": policy }))
    } else {
        learning_response("policy", runtime.policies.register_policy(&policy))
    }
}

fn policy_rollout_samples(
    data_dir: &Path,
    runtime: &NativeRuntime,
    rollout: &Value,
) -> Result<Vec<Value>, (u16, Value)> {
    let project_scope_token = rollout["projectScopeToken"].as_str().unwrap_or_default();
    let outcomes = match pending_outcomes::list_outcomes(
        data_dir,
        &json!({ "projectScopeToken": project_scope_token }),
    ) {
        Ok(Value::Array(outcomes)) => outcomes,
        Ok(_) => Vec::new(),
        Err(error) => return Err(pending_response("outcomes", Err(error))),
    };
    let outcome_by_id = outcomes
        .into_iter()
        .filter_map(|outcome| {
            let outcome_id = outcome["outcomeId"].as_str()?.to_string();
            Some((outcome_id, outcome))
        })
        .collect::<HashMap<_, _>>();
    let records = runtime
        .learning
        .list_observation_records(Some(project_scope_token))
        .map_err(learning_error_response)?;
    let mut samples = Vec::new();
    for record in records {
        if record.get("rolloutEligible").and_then(Value::as_bool) != Some(true) {
            continue;
        }
        let Some(outcome_id) = record["outcomeId"].as_str() else {
            continue;
        };
        let Some(outcome) = outcome_by_id.get(outcome_id) else {
            continue;
        };
        let Some(policy_version) = outcome["policyVersion"].as_u64() else {
            continue;
        };
        if outcome["policyId"] != rollout["policyId"]
            || ![
                rollout["baselineVersion"].as_u64(),
                rollout["policyVersion"].as_u64(),
            ]
            .contains(&Some(policy_version))
            || !matches!(outcome["status"].as_str(), Some("succeeded" | "failed"))
        {
            continue;
        }
        let observation = &record["observation"];
        let edit_rework = usize::from(
            observation
                .pointer("/editFeatureSummary/userEdited")
                .and_then(Value::as_bool)
                == Some(true),
        );
        let retry_count = observation["retryCount"].as_u64().unwrap_or_default();
        samples.push(json!({
            "arm": if policy_version == rollout["policyVersion"].as_u64().unwrap_or_default() {
                "candidate"
            } else {
                "baseline"
            },
            "taskOutcomeToken": observation["taskOutcomeToken"],
            "retryCount": retry_count,
            "undoUsed": observation["undoUsed"],
            "inputTokens": observation["inputTokens"],
            "outputTokens": observation["outputTokens"],
            "insertedPromptTokenEstimate": observation["insertedPromptTokenEstimate"],
            "tokenAccountingSource": observation["tokenAccountingSource"],
            "latencyMs": observation["latencyMs"],
            "reworkCount": retry_count.saturating_add(edit_rework as u64)
        }));
    }
    Ok(samples)
}

fn evaluate_stored_policy_rollout(
    data_dir: &Path,
    runtime: &NativeRuntime,
    rollout: &Value,
) -> Result<(learning_policy::RolloutEvaluation, Value, Value), (u16, Value)> {
    let observations = policy_rollout_samples(data_dir, runtime, rollout)?;
    let confidence =
        learning_policy::estimate_rollout_confidence(&observations, rollout.get("minimums"));
    let evaluation = learning_policy::evaluate_policy_rollout(
        rollout,
        &json!({
            "observations": observations,
            "confidence": confidence["confidence"]
        }),
    )
    .map_err(learning_error_response)?;
    let policy = runtime
        .policies
        .apply_rollout_evaluation(&evaluation)
        .map_err(learning_error_response)?;
    Ok((evaluation, policy, confidence))
}

fn evaluate_active_policy_rollout(
    data_dir: &Path,
    runtime: &NativeRuntime,
    outcome: &Value,
) -> Result<Option<Value>, (u16, Value)> {
    let (Some(policy_id), Some(policy_version), Some(project_scope_token)) = (
        outcome["policyId"].as_str(),
        outcome["policyVersion"].as_u64(),
        outcome["projectScopeToken"].as_str(),
    ) else {
        return Ok(None);
    };
    let rollout = runtime
        .policies
        .list_rollouts()
        .map_err(learning_error_response)?
        .into_iter()
        .filter(|rollout| {
            matches!(rollout["status"].as_str(), Some("canary" | "collecting"))
                && rollout["policyId"].as_str() == Some(policy_id)
                && rollout["projectScopeToken"].as_str() == Some(project_scope_token)
                && [
                    rollout["baselineVersion"].as_u64(),
                    rollout["policyVersion"].as_u64(),
                ]
                .contains(&Some(policy_version))
        })
        .max_by(|left, right| {
            left["startedAt"]
                .as_str()
                .unwrap_or_default()
                .cmp(right["startedAt"].as_str().unwrap_or_default())
        });
    let Some(rollout) = rollout else {
        return Ok(None);
    };
    let (evaluation, _, confidence) = evaluate_stored_policy_rollout(data_dir, runtime, &rollout)?;
    Ok(Some(json!({
        "action": evaluation.action,
        "reasonToken": evaluation.reason_token,
        "rolloutId": evaluation.rollout["rolloutId"],
        "policyStatus": evaluation.policy_status,
        "confidence": confidence["confidence"],
        "enoughSamples": confidence["enoughSamples"]
    })))
}

fn evaluate_policy_route(data_dir: &Path, runtime: &NativeRuntime, body: &Value) -> (u16, Value) {
    if !only_fields(body, &["rolloutId"]) {
        return target_error_response(
            400,
            "unexpected_policy_evaluate_field",
            "Rollout evaluation only accepts a rolloutId; evidence is read from server storage.",
        );
    }
    let rollout_id = body.get("rolloutId").and_then(Value::as_str).unwrap_or("");
    if !valid_opaque_token(rollout_id, 180) {
        return target_error_response(
            400,
            "invalid_policy_rollout_id",
            "A valid rolloutId is required.",
        );
    }
    let _guard = match runtime.governance.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return (
                500,
                json!({ "ok": false, "error": { "code": "policy_registry_storage_error", "message": "Policy coordination lock is unavailable." } }),
            )
        }
    };
    let rollout = match runtime.policies.list_rollouts() {
        Ok(rollouts) => match rollouts
            .into_iter()
            .find(|item| item["rolloutId"].as_str() == Some(rollout_id))
        {
            Some(rollout) => rollout,
            None => {
                return target_error_response(
                    404,
                    "policy_rollout_not_found",
                    "Policy rollout was not found.",
                )
            }
        },
        Err(error) => return learning_error_response(error),
    };
    if !matches!(rollout["status"].as_str(), Some("canary" | "collecting")) {
        return target_error_response(
            409,
            "policy_rollout_not_active",
            "Only an active canary rollout can be evaluated.",
        );
    }
    match evaluate_stored_policy_rollout(data_dir, runtime, &rollout) {
        Ok((evaluation, policy, confidence)) => (
            200,
            json!({
                "ok": true,
                "evaluation": evaluation,
                "policy": policy,
                "confidence": confidence
            }),
        ),
        Err(response) => response,
    }
}

fn generation_task_scenario_text(body: &Value, input: &str, mode: &str) -> String {
    let mut parts = vec![input.to_string(), mode.to_string()];
    if let Some(context) = body.get("context") {
        for field in ["intent", "tool", "host", "inputKind"] {
            if let Some(value) = context.get(field).and_then(Value::as_str) {
                parts.push(value.to_string());
            }
        }
        if let Some(value) = context
            .get("adapterId")
            .or_else(|| context.get("adapter_id"))
            .or_else(|| context.get("siteAdapterId"))
            .and_then(Value::as_str)
        {
            parts.push(value.to_string());
        }
        if let Some(skills) = context.get("skills").and_then(Value::as_array) {
            for skill in skills {
                if let Some(value) = skill.as_str() {
                    parts.push(value.to_string());
                    continue;
                }
                if let Some(name) = skill.get("name").and_then(Value::as_str) {
                    parts.push(name.to_string());
                }
                if let Some(tags) = skill.get("tags").and_then(Value::as_array) {
                    parts.extend(tags.iter().filter_map(Value::as_str).map(str::to_string));
                }
            }
        }
    }
    parts.join(" ")
}

fn generation_task_scenario_token(body: &Value, input: &str, mode: &str) -> String {
    let explicit = body
        .pointer("/context/taskScenario")
        .or_else(|| body.pointer("/context/task_scenario"))
        .or_else(|| body.pointer("/context/scenario"))
        .or_else(|| body.get("taskScenarioToken"))
        .or_else(|| body.get("taskScenario"))
        .and_then(Value::as_str);
    match explicit {
        Some(value) => bounded_token(value, "general", 120),
        None => bounded_token(
            outcome_contracts::infer_task_scenario(&generation_task_scenario_text(
                body, input, mode,
            )),
            "general",
            120,
        ),
    }
}

fn generate_response(
    data_dir: &Path,
    runtime: &NativeRuntime,
    body: &Value,
) -> Result<(u16, Value), String> {
    let input = body.get("input").and_then(Value::as_str).unwrap_or("");
    let mode = body
        .get("mode")
        .and_then(Value::as_str)
        .or_else(|| body.pointer("/context/mode").and_then(Value::as_str))
        .unwrap_or_else(|| detect_mode(input));
    let variant = body
        .get("variantIndex")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let skills = recommend_skills(input, &read_array(data_dir, "skills.json")?);
    let settings = private_settings(data_dir)?;
    let effective = effective_provider_settings(&settings);
    let target = bounded_token(
        body.get("target")
            .or_else(|| body.pointer("/context/target"))
            .or_else(|| body.pointer("/context/tool"))
            .and_then(Value::as_str)
            .unwrap_or(""),
        "",
        40,
    );
    let project_scope_token = body
        .get("projectScopeToken")
        .or_else(|| body.pointer("/context/projectScopeToken"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let task_scenario_token = generation_task_scenario_token(body, input, mode);
    let model_family_token = bounded_token(
        effective
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("configured_model"),
        "configured_model",
        120,
    );
    let learning_candidate_seed = if target == "codex" {
        outcome_contracts::derive_learning_candidate_seed(input, &task_scenario_token)
    } else {
        None
    };
    let generation_id = format!("generation-{}", &generate_token()[..24]);
    let session_id = body
        .get("sessionId")
        .and_then(Value::as_str)
        .filter(|value| valid_opaque_token(value, 120))
        .map(str::to_string)
        .unwrap_or_else(|| format!("session-{}", &generate_token()[..24]));

    let mut target_revision = None;
    let mut history_binding = None;
    if target == "codex" {
        if !valid_opaque_token(&project_scope_token, 180) {
            return Ok(target_error_response(
                400,
                "generation_policy_scope_required",
                "A verified private Codex project scope is required.",
            ));
        }
        let mut target_runtime = runtime
            .target
            .lock()
            .map_err(|_| "codex_target_state_unavailable".to_string())?;
        prune_target_state(&mut target_runtime.state, unix_timestamp_millis());
        if !target_runtime
            .state
            .target_leases
            .values()
            .any(|lease| lease.project_scope_token == project_scope_token)
        {
            return Ok(target_error_response(
                409,
                "target_generation_scope_unverified",
                "The generation scope is not bound to a current Codex target inspection.",
            ));
        }
        target_revision = Some(target_runtime.state.revision);
    }

    let policy_assignment = if target == "codex" {
        let _guard = runtime
            .governance
            .lock()
            .map_err(|_| "policy_registry_storage_error".to_string())?;
        let scope = json!({
            "kind": "project",
            "target": "codex",
            "projectScopeToken": project_scope_token,
            "taskScenarioToken": task_scenario_token,
            "modelFamilyToken": model_family_token
        });
        ensure_baseline_generation_policy(runtime, &scope).map_err(|error| error.to_string())?;
        runtime
            .policies
            .select_generation_policy_assignment(&json!({
                "target": "codex",
                "projectScopeToken": project_scope_token,
                "taskScenarioToken": task_scenario_token,
                "modelFamilyToken": model_family_token,
                "generationId": generation_id
            }))
            .map_err(|error| error.to_string())?
    } else {
        None
    };
    if target == "codex" && policy_assignment.is_none() {
        return Err("stable_generation_policy_missing".to_string());
    }
    let compact_policy = policy_assignment
        .as_ref()
        .map(|assignment| compact_generation_policy(&assignment.policy));
    let (prompt, generated_by) = match generate_with_provider(
        &effective,
        input,
        mode,
        &skills,
        variant,
        compact_policy.as_deref(),
    ) {
        Ok(value) => (value, "llm"),
        Err(error) if body.get("allowTemplateFallback").and_then(Value::as_bool) == Some(true) => {
            log_event(data_dir, "llm_fallback", json!({ "errorCode": error.code }));
            (
                build_prompt(input, mode, &skills, variant, compact_policy.as_deref()),
                "template-fallback",
            )
        }
        Err(error) => return Ok(provider_failure_response(error, "generate")),
    };

    let strategy_id = policy_assignment
        .as_ref()
        .and_then(|assignment| assignment.policy.pointer("/selectedStrategy/strategyId"))
        .and_then(Value::as_str)
        .unwrap_or("baseline")
        .to_string();
    let strategy_version = policy_assignment
        .as_ref()
        .and_then(|assignment| {
            assignment
                .policy
                .pointer("/selectedStrategy/strategyVersion")
        })
        .and_then(Value::as_str)
        .unwrap_or("v1")
        .to_string();
    if target == "codex" {
        let assignment = policy_assignment
            .as_ref()
            .expect("Codex generation has one selected policy");
        let mut target_runtime = runtime
            .target
            .lock()
            .map_err(|_| "codex_target_state_unavailable".to_string())?;
        if target_revision != Some(target_runtime.state.revision) {
            return Ok(target_error_response(
                409,
                "target_generation_scope_invalidated",
                "The Codex project scope was cleared while the prompt was generated.",
            ));
        }
        for binding in target_runtime.state.undo_bindings.values_mut() {
            if binding.project_scope_token == project_scope_token {
                binding.invalidated = true;
            }
        }
        target_runtime.adapter.invalidate_undo();
        let binding = GenerationBinding {
            generation_id: generation_id.clone(),
            session_id: session_id.clone(),
            project_scope_token: project_scope_token.clone(),
            strategy_id: strategy_id.clone(),
            strategy_version: strategy_version.clone(),
            model_family_token: model_family_token.clone(),
            task_scenario_token: task_scenario_token.clone(),
            mode_token: bounded_token(mode, "standard", 80),
            policy_id: assignment.policy["policyId"].as_str().map(str::to_string),
            policy_version: assignment.policy["version"].as_u64(),
            learning_candidate_seed: learning_candidate_seed.clone(),
            generated_prompt: prompt.clone(),
            edit_feature_summary: None,
            expires_at_ms: unix_timestamp_millis() + GENERATION_BINDING_TTL_MS,
        };
        history_binding = Some(binding.clone());
        target_runtime
            .state
            .generation_bindings
            .insert(generation_id.clone(), binding);
    }

    record_prompt_history(data_dir, mode, "native-sidecar", history_binding.as_ref())?;
    let policy_metadata = policy_assignment.as_ref().map(|assignment| {
        json!({
            "policyId": assignment.policy["policyId"],
            "version": assignment.policy["version"],
            "arm": assignment.arm,
            "rolloutId": assignment.rollout_id
        })
    });
    Ok((
        200,
        json!({
            "ok": true,
            "card": {
                "generationId": generation_id,
                "sessionId": session_id,
                "mode": mode,
                "modeLabel": mode_label(mode),
                "tool": "Smart Prompt",
                "target": if target.is_empty() { Value::Null } else { json!(target) },
                "projectScopeToken": if project_scope_token.is_empty() { Value::Null } else { json!(project_scope_token) },
                "taskScenario": task_scenario_token,
                "strategyId": strategy_id,
                "strategyVersion": strategy_version,
                "modelFamilyToken": model_family_token,
                "learningPatternToken": learning_candidate_seed
                    .as_ref()
                    .and_then(|seed| seed["patternToken"].as_str()),
                "prompt": prompt,
                "skills": skills,
                "generatedBy": generated_by,
                "provider": effective["provider"],
                "model": effective["model"],
                "generationPolicy": policy_metadata
            }
        }),
    ))
}

fn ensure_baseline_generation_policy(
    runtime: &NativeRuntime,
    scope: &Value,
) -> Result<Value, learning_policy::LearningPolicyError> {
    let policies = runtime.policies.list_policies()?;
    if let Some(stable) = policies
        .iter()
        .find(|policy| policy["status"] == "stable" && policy["scope"] == *scope)
    {
        return Ok(stable.clone());
    }
    let next_version = policies
        .iter()
        .filter(|policy| policy["scope"] == *scope)
        .filter_map(|policy| policy["version"].as_u64())
        .max()
        .unwrap_or(0)
        + 1;
    let scope_json = serde_json::to_string(scope).unwrap_or_default();
    let digest = target_adapter::sha256_hex(&scope_json);
    let input = json!({
        "policyId": format!("policy_baseline_{}", &digest[..20]),
        "version": next_version,
        "baselineVersion": next_version,
        "scope": scope,
        "automaticRolloutEligible": false,
        "signals": {}
    });
    let mut policy = learning_policy::compile_generation_policy(&input)?;
    policy["status"] = Value::String("stable".to_string());
    policy["automaticRolloutEligible"] = Value::Bool(false);
    runtime.policies.register_policy(&policy)
}

fn compact_generation_policy(policy: &Value) -> String {
    let mut directives = policy["directives"]
        .as_array()
        .map(|items| items.iter().take(5).cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    loop {
        let compact = serde_json::to_string(&json!({
            "contractVersion": policy["contractVersion"],
            "policyId": policy["policyId"],
            "version": policy["version"],
            "selectedStrategy": policy["selectedStrategy"],
            "directives": directives,
            "contextBudget": policy["contextBudget"]
        }))
        .unwrap_or_default();
        if compact.len() <= 1_600 || directives.is_empty() {
            return compact;
        }
        directives.pop();
    }
}

fn target_inspect_route(runtime: &NativeRuntime, body: &Value) -> (u16, Value) {
    if body.as_object().is_none_or(|object| !object.is_empty()) {
        return target_error_response(
            400,
            "unexpected_target_inspect_field",
            "Codex target inspection does not accept client evidence.",
        );
    }
    let mut target = match runtime.target.lock() {
        Ok(target) => target,
        Err(_) => {
            return target_error_response(
                500,
                "codex_target_state_unavailable",
                "Codex target state is unavailable.",
            )
        }
    };
    prune_target_state(&mut target.state, unix_timestamp_millis());
    let response = target.adapter.inspect();
    if let Some(lease) = response.lease.as_ref() {
        remember_target_lease(&mut target.state, lease);
    }
    serialized_ok(&response)
}

fn target_read_route(runtime: &NativeRuntime, body: &Value) -> (u16, Value) {
    if !only_fields(body, &["leaseId"]) {
        return target_error_response(
            400,
            "unexpected_target_read_field",
            "The target read request contains unsupported fields.",
        );
    }
    let lease_id = body.get("leaseId").and_then(Value::as_str).unwrap_or("");
    let mut target = match runtime.target.lock() {
        Ok(target) => target,
        Err(_) => {
            return target_error_response(
                500,
                "codex_target_state_unavailable",
                "Codex target state is unavailable.",
            )
        }
    };
    prune_target_state(&mut target.state, unix_timestamp_millis());
    let response = target.adapter.read_draft(lease_id);
    serialized_ok(&response)
}

fn target_insert_route(data_dir: &Path, runtime: &NativeRuntime, body: &Value) -> (u16, Value) {
    if !only_fields(
        body,
        &[
            "leaseId",
            "text",
            "expectedDraftHash",
            "generationId",
            "requestId",
            "allowClipboardFallback",
        ],
    ) {
        return target_error_response(
            400,
            "unexpected_target_insert_field",
            "The target insert request contains unsupported fields.",
        );
    }
    let lease_id = body.get("leaseId").and_then(Value::as_str).unwrap_or("");
    let text = body.get("text").and_then(Value::as_str).unwrap_or("");
    let expected_draft_hash = body
        .get("expectedDraftHash")
        .and_then(Value::as_str)
        .unwrap_or("");
    let generation_id = body
        .get("generationId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let request_id = body
        .get("requestId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            bounded_token(&format!("insert-{generation_id}"), "insert-generated", 180)
        });
    let allow_clipboard_fallback =
        body.get("allowClipboardFallback").and_then(Value::as_bool) == Some(true);
    if !valid_opaque_token(lease_id, 180)
        || !valid_opaque_token(generation_id, 180)
        || !valid_opaque_token(&request_id, 180)
        || !valid_sha256(expected_draft_hash)
        || text.is_empty()
    {
        return target_error_response(
            400,
            "invalid_target_insert_request",
            "A fresh lease, generation, request id, draft hash, and prompt are required.",
        );
    }
    let mut target = match runtime.target.lock() {
        Ok(target) => target,
        Err(_) => {
            return target_error_response(
                500,
                "codex_target_state_unavailable",
                "Codex target state is unavailable.",
            )
        }
    };
    prune_target_state(&mut target.state, unix_timestamp_millis());
    if let Some(receipt) = target.state.insert_receipts.get(&request_id) {
        return (200, receipt.response.clone());
    }
    let lease = match target.state.target_leases.get(lease_id).cloned() {
        Some(lease) => lease,
        None => {
            return target_error_response(
                409,
                "target_transaction_binding_missing",
                "A fresh target lease and generated card are required.",
            )
        }
    };
    let mut generation = match target.state.generation_bindings.get(generation_id).cloned() {
        Some(binding) => binding,
        None => {
            return target_error_response(
                409,
                "target_transaction_binding_missing",
                "A fresh target lease and generated card are required.",
            )
        }
    };
    if lease.draft_hash != expected_draft_hash {
        return target_error_response(
            409,
            "draft_changed",
            "The Codex draft changed after the card was opened.",
        );
    }
    if lease.project_scope_token != generation.project_scope_token {
        return target_error_response(
            409,
            "transaction_scope_conflict",
            "The generated prompt belongs to another target scope.",
        );
    }
    let inserted = target
        .adapter
        .insert(lease_id, text, allow_clipboard_fallback);
    target.state.target_leases.remove(lease_id);
    drop(target);

    let mut response = serialized_ok_value(&inserted);
    let incident_type = classify_codex_insert_policy_incident(
        &inserted.result.reason_token,
        inserted.result.no_auto_submit,
    );
    let policy_evaluation = if let Some(incident_type) = incident_type {
        let _guard = match runtime.governance.lock() {
            Ok(guard) => guard,
            Err(_) => {
                return target_error_response(
                    500,
                    "policy_registry_storage_error",
                    "Policy coordination lock is unavailable.",
                )
            }
        };
        match record_generation_policy_incident(runtime, &generation, incident_type) {
            Ok(evaluation) => evaluation,
            Err(error) => return learning_error_response(error),
        }
    } else {
        None
    };
    if inserted.result.status != "ready"
        || !inserted.result.verified
        || inserted.result.verification != "machine"
        || !inserted.result.no_auto_submit
        || inserted.transaction.is_none()
    {
        response["pendingOutcome"] = Value::Null;
        response["policyEvaluation"] = policy_evaluation.unwrap_or(Value::Null);
        return (200, response);
    }

    let mut target = match runtime.target.lock() {
        Ok(target) => target,
        Err(_) => {
            return target_error_response(
                500,
                "codex_target_state_unavailable",
                "Codex target state is unavailable.",
            )
        }
    };
    prune_target_state(&mut target.state, unix_timestamp_millis());
    let binding_still_current = target
        .state
        .generation_bindings
        .get(generation_id)
        .is_some_and(|current| {
            current.session_id == generation.session_id
                && current.project_scope_token == generation.project_scope_token
        });
    if !binding_still_current {
        return target_error_response(
            409,
            "target_generation_scope_invalidated",
            "The Codex project scope was cleared while the prompt was inserted.",
        );
    }
    let edit_feature_summary =
        outcome_contracts::derive_edit_feature_summary(&generation.generated_prompt, text);
    generation.edit_feature_summary = Some(edit_feature_summary.clone());
    if let Err(error) =
        record_verified_generation_edit_summary(data_dir, &generation, &edit_feature_summary)
    {
        log_event(
            data_dir,
            "learning_evidence_unavailable",
            json!({ "errorCode": bounded_token(&error, "storage_error", 80) }),
        );
        generation.policy_id = None;
        generation.policy_version = None;
        generation.edit_feature_summary = None;
    }
    if let Some(current) = target.state.generation_bindings.get_mut(generation_id) {
        *current = generation.clone();
    }
    let transaction = inserted
        .transaction
        .as_ref()
        .expect("verified insert returns a transaction")
        .clone();
    let claim = target
        .adapter
        .claim_verified_transaction(&transaction.transaction_id, "pending_outcome");
    let receipt = match claim.receipt.as_ref() {
        Some(receipt)
            if claim.status == "ready"
                && receipt.project_scope_token == generation.project_scope_token =>
        {
            receipt
        }
        _ => {
            return target_error_response(
                409,
                &claim.reason_token,
                "The verified insert cannot be bound to an outcome.",
            )
        }
    };
    let event = prompt_session_event_from_transaction(&generation, receipt, &transaction);
    let pending = match pending_outcomes::record_verified_insert(data_dir, &event) {
        Ok(value) => value,
        Err(error) => return pending_response("result", Err(error)),
    };
    let outcome_id = event["outcomeId"].as_str().unwrap_or("").to_string();
    response["pendingOutcome"] = pending["outcome"].clone();
    response["promptSessionEvent"] = json!({
        "eventId": event["eventId"],
        "eventType": event["eventType"],
        "outcomeId": event["outcomeId"]
    });
    let expires_at_ms = parse_iso_ms(&transaction.expires_at)
        .unwrap_or_else(|| unix_timestamp_millis() + 5 * 60 * 1_000);
    target.state.insert_receipts.insert(
        request_id,
        InsertReceipt {
            project_scope_token: generation.project_scope_token.clone(),
            expires_at_ms,
            response: response.clone(),
        },
    );
    if let Some(undo_token) = inserted.undo_token.as_ref() {
        target.state.undo_bindings.insert(
            undo_token.clone(),
            UndoBinding {
                invalidated: false,
                project_scope_token: generation.project_scope_token.clone(),
                generation: generation.clone(),
                outcome_id: outcome_id.clone(),
            },
        );
    }
    target.state.transaction_bindings.insert(
        transaction.transaction_id.clone(),
        TransactionBinding {
            project_scope_token: generation.project_scope_token,
            expires_at_ms,
            transaction,
            outcome_id,
            generation_id: generation.generation_id,
        },
    );
    (200, response)
}

fn classify_codex_insert_policy_incident(
    reason_token: &str,
    no_auto_submit: bool,
) -> Option<&'static str> {
    let reason_token = reason_token.trim().to_ascii_lowercase();
    if !no_auto_submit || reason_token == "safety_auto_submit_signal" {
        return Some("auto_submit_incident");
    }
    if matches!(
        reason_token.as_str(),
        "after_write_mismatch" | "target_changed_written_draft"
    ) {
        return Some("miswrite_incident");
    }
    if reason_token == "write_failed_clipboard_restore" {
        return Some("privacy_incident");
    }
    if matches!(
        reason_token.as_str(),
        "safety_atomic_guard_bypassed" | "safety_direct_write_bypassed"
    ) {
        return Some("safety_incident");
    }
    None
}

fn record_generation_policy_incident(
    runtime: &NativeRuntime,
    generation: &GenerationBinding,
    incident_type: &str,
) -> Result<Option<Value>, learning_policy::LearningPolicyError> {
    let (Some(policy_id), Some(policy_version)) =
        (generation.policy_id.as_deref(), generation.policy_version)
    else {
        return Ok(None);
    };
    let rollout = runtime
        .policies
        .list_rollouts()?
        .into_iter()
        .filter(|rollout| {
            matches!(rollout["status"].as_str(), Some("canary" | "collecting"))
                && rollout["policyId"].as_str() == Some(policy_id)
                && rollout["policyVersion"].as_u64() == Some(policy_version)
                && rollout["projectScopeToken"].as_str()
                    == Some(generation.project_scope_token.as_str())
        })
        .max_by(|left, right| {
            left["startedAt"]
                .as_str()
                .unwrap_or_default()
                .cmp(right["startedAt"].as_str().unwrap_or_default())
        });
    let Some(rollout) = rollout else {
        return Ok(None);
    };
    let evaluation = learning_policy::evaluate_policy_rollout(
        &rollout,
        &json!({
            "events": [{ "eventType": incident_type }],
            "confidence": 0.0
        }),
    )?;
    runtime.policies.apply_rollout_evaluation(&evaluation)?;
    Ok(Some(json!({
        "action": evaluation.action,
        "reasonToken": evaluation.reason_token,
        "rolloutId": evaluation.rollout["rolloutId"],
        "policyStatus": evaluation.policy_status
    })))
}

fn target_undo_route(data_dir: &Path, runtime: &NativeRuntime, body: &Value) -> (u16, Value) {
    if !only_fields(body, &["undoToken", "allowClipboardFallback"]) {
        return target_error_response(
            400,
            "unexpected_target_undo_field",
            "The target undo request contains unsupported fields.",
        );
    }
    let undo_token = body.get("undoToken").and_then(Value::as_str).unwrap_or("");
    let allow_clipboard_fallback =
        body.get("allowClipboardFallback").and_then(Value::as_bool) == Some(true);
    let mut target = match runtime.target.lock() {
        Ok(target) => target,
        Err(_) => {
            return target_error_response(
                500,
                "codex_target_state_unavailable",
                "Codex target state is unavailable.",
            )
        }
    };
    let binding = match target.state.undo_bindings.get(undo_token).cloned() {
        Some(binding) if !binding.invalidated => binding,
        _ => {
            return target_error_response(
                409,
                "undo_invalidated",
                "Undo is no longer available for this insertion.",
            )
        }
    };
    let undone = target.adapter.undo(undo_token, allow_clipboard_fallback);
    if undone.result.status == "ready" {
        if let Some(stored) = target.state.undo_bindings.get_mut(undo_token) {
            stored.invalidated = true;
        }
        let event = prompt_session_undo_event(&binding);
        if let Err(error) = pending_outcomes::record_implicit_signal(data_dir, &event) {
            return pending_response("result", Err(error));
        }
    }
    serialized_ok(&undone)
}

fn complete_codex_activation_from_transaction(
    data_dir: &Path,
    runtime: &NativeRuntime,
    body: &Value,
) -> Result<(u16, Value), String> {
    if body.get("contractVersion").and_then(Value::as_str) != Some(activation_v2::SCHEMA_VERSION) {
        return Ok(codex_activation_contract_mismatch());
    }
    if !only_fields(body, &["contractVersion", "transactionId"]) {
        return Ok(target_error_response(
            400,
            "activation_self_reported_evidence_rejected",
            "Activation accepts only a server-recorded verified transaction id.",
        ));
    }
    let transaction_id = body
        .get("transactionId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let mut target = runtime
        .target
        .lock()
        .map_err(|_| "codex_target_state_unavailable".to_string())?;
    prune_target_state(&mut target.state, unix_timestamp_millis());
    let binding = match target
        .state
        .transaction_bindings
        .get(transaction_id)
        .cloned()
    {
        Some(binding) => binding,
        None => {
            return Ok(target_error_response(
                409,
                "verified_transaction_missing",
                "A verified insert transaction is required.",
            ))
        }
    };
    let claim = target
        .adapter
        .claim_verified_transaction(transaction_id, "activation");
    let receipt = match claim.receipt {
        Some(receipt)
            if claim.status == "ready"
                && receipt.insert_verified
                && receipt.no_auto_submit
                && receipt.verification == "machine"
                && receipt.project_scope_token == binding.project_scope_token =>
        {
            receipt
        }
        _ => {
            return Ok(target_error_response(
                409,
                &claim.reason_token,
                "Verified insertion evidence is unavailable.",
            ))
        }
    };
    drop(target);
    let transaction_ms = parse_iso_ms(&binding.transaction.issued_at)
        .ok_or_else(|| "verified_transaction_invalid".to_string())?;
    let activation = activation_v2::get_status(data_dir).map_err(|error| error.code)?;
    let model_test_ms = activation
        .get("modelTestedAt")
        .and_then(Value::as_str)
        .and_then(parse_iso_ms)
        .ok_or_else(|| "activation_model_test_missing".to_string())?;
    let event_ms = transaction_ms.max(model_test_ms.saturating_add(1));
    let evidence = json!({
        "eventId": format!("activation-verified_insert-{event_ms}"),
        "target": "codex",
        "site": "codex",
        "completionKind": "verified_insert",
        "targetKind": "codex-composer",
        "stableReadback": true,
        "verified": true,
        "noAutoSubmit": true,
        "nativeBuildId": activation_v2::REQUIRED_NATIVE_BUILD_ID
    });
    let activation = activation_v2::complete(data_dir, &evidence);
    let response = codex_activation_response(activation);
    if response.0 == 200 {
        let mut payload = response.1;
        payload["claim"] = serde_json::to_value(receipt).unwrap_or(Value::Null);
        Ok((200, payload))
    } else {
        Ok(response)
    }
}

fn prompt_session_event_from_transaction(
    generation: &GenerationBinding,
    claim: &target_adapter::TransactionClaimReceipt,
    transaction: &VerifiedTransactionHandle,
) -> Value {
    let digest = target_adapter::sha256_hex(&format!(
        "{}\n{}",
        generation.generation_id, transaction.transaction_id
    ));
    json!({
        "contractVersion": "prompt-session@2",
        "eventId": format!("verified-insert-{}", &digest[..32]),
        "eventType": "verified_insert",
        "occurredAt": transaction.issued_at,
        "sessionId": generation.session_id,
        "generationId": generation.generation_id,
        "target": "codex",
        "projectScopeToken": claim.project_scope_token,
        "strategyId": generation.strategy_id,
        "strategyVersion": generation.strategy_version,
        "modelFamilyToken": generation.model_family_token,
        "outcomeId": format!("outcome-{}", &digest[..32]),
        "policyId": generation.policy_id,
        "policyVersion": generation.policy_version,
        "taskOutcomeToken": "unknown",
        "insertVerified": true,
        "noAutoSubmit": true,
        "failureReasonTokens": [],
        "privacyFlags": outcome_privacy_flags()
    })
}

fn prompt_session_undo_event(binding: &UndoBinding) -> Value {
    json!({
        "contractVersion": "prompt-session@2",
        "eventId": format!("undo-{}", &generate_token()[..32]),
        "eventType": "undo",
        "occurredAt": chrono::Utc::now()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "sessionId": binding.generation.session_id,
        "generationId": binding.generation.generation_id,
        "target": "codex",
        "projectScopeToken": binding.project_scope_token,
        "strategyId": binding.generation.strategy_id,
        "strategyVersion": binding.generation.strategy_version,
        "modelFamilyToken": binding.generation.model_family_token,
        "outcomeId": binding.outcome_id,
        "policyId": binding.generation.policy_id,
        "policyVersion": binding.generation.policy_version,
        "taskOutcomeToken": "unknown",
        "insertVerified": false,
        "noAutoSubmit": true,
        "failureReasonTokens": [],
        "privacyFlags": outcome_privacy_flags()
    })
}

fn outcome_privacy_flags() -> Value {
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

fn prune_target_state(state: &mut TargetRouteState, at_ms: i64) {
    state
        .target_leases
        .retain(|_, lease| lease.expires_at_ms + TARGET_ROUTE_LEASE_GRACE_MS >= at_ms);
    state
        .generation_bindings
        .retain(|_, binding| binding.expires_at_ms >= at_ms);
    state
        .insert_receipts
        .retain(|_, receipt| receipt.expires_at_ms >= at_ms);
    state
        .transaction_bindings
        .retain(|_, binding| binding.expires_at_ms >= at_ms);
}

fn remember_target_lease(state: &mut TargetRouteState, lease: &TargetLease) {
    state.target_leases.insert(
        lease.lease_id.clone(),
        TargetLeaseBinding {
            draft_hash: lease.draft_hash.clone(),
            project_scope_token: lease.project_scope_token.clone(),
            expires_at_ms: parse_iso_ms(&lease.expires_at).unwrap_or_else(unix_timestamp_millis),
        },
    );
}

fn invalidate_target_project(target: &mut TargetRuntime, project_scope_token: &str) -> usize {
    let mut invalidated = target.adapter.invalidate_project_scope(project_scope_token);
    invalidated += retain_other_project(
        &mut target.state.target_leases,
        |value| &value.project_scope_token,
        project_scope_token,
    );
    invalidated += retain_other_project(
        &mut target.state.generation_bindings,
        |value| &value.project_scope_token,
        project_scope_token,
    );
    invalidated += retain_other_project(
        &mut target.state.insert_receipts,
        |value| &value.project_scope_token,
        project_scope_token,
    );
    invalidated += retain_other_project(
        &mut target.state.undo_bindings,
        |value| &value.project_scope_token,
        project_scope_token,
    );
    invalidated += retain_other_project(
        &mut target.state.transaction_bindings,
        |value| &value.project_scope_token,
        project_scope_token,
    );
    target.state.revision = target.state.revision.wrapping_add(1);
    invalidated
}

fn retain_other_project<T, F>(
    records: &mut HashMap<String, T>,
    project: F,
    project_scope_token: &str,
) -> usize
where
    F: Fn(&T) -> &String,
{
    let before = records.len();
    records.retain(|_, value| project(value) != project_scope_token);
    before - records.len()
}

fn serialized_ok<T: serde::Serialize>(value: &T) -> (u16, Value) {
    (200, serialized_ok_value(value))
}

fn serialized_ok_value<T: serde::Serialize>(value: &T) -> Value {
    let mut serialized = serde_json::to_value(value).unwrap_or_else(|_| json!({}));
    if !serialized.is_object() {
        serialized = json!({ "result": serialized });
    }
    serialized["ok"] = Value::Bool(true);
    serialized
}

fn target_error_response(status: u16, code: &str, message: &str) -> (u16, Value) {
    (
        status,
        json!({ "ok": false, "error": { "code": code, "message": message } }),
    )
}

fn only_fields(value: &Value, allowed: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.keys().all(|key| allowed.contains(&key.as_str())))
}

fn valid_opaque_token(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.:+-".contains(&byte))
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn bounded_token(value: &str, fallback: &str, max_len: usize) -> String {
    let token = sanitize_token(value, fallback);
    token.chars().take(max_len).collect()
}

fn parse_iso_ms(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.timestamp_millis())
}

fn unix_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn data_dir() -> Result<PathBuf, String> {
    if let Some(value) = env::var_os("SMART_PROMPT_DATA_DIR") {
        return Ok(PathBuf::from(value));
    }
    env::current_dir()
        .map(|dir| dir.join(".smart-prompt-data"))
        .map_err(|error| error.to_string())
}

fn request_origin(request: &Request) -> Option<&str> {
    request
        .headers()
        .iter()
        .find(|header| {
            header
                .field
                .as_str()
                .to_string()
                .eq_ignore_ascii_case("Origin")
        })
        .map(|header| header.value.as_str())
}

fn is_loopback_http_origin(origin: &str, host: &str) -> bool {
    let Some(remainder) = origin.strip_prefix(&format!("http://{host}")) else {
        return false;
    };
    remainder.is_empty()
        || remainder.strip_prefix(':').is_some_and(|port| {
            !port.is_empty() && port.chars().all(|character| character.is_ascii_digit())
        })
}

fn is_trusted_origin(origin: &str) -> bool {
    matches!(
        origin,
        EXTENSION_ORIGIN
            | "tauri://localhost"
            | "http://tauri.localhost"
            | "https://tauri.localhost"
    ) || is_loopback_http_origin(origin, "127.0.0.1")
        || is_loopback_http_origin(origin, "localhost")
}

fn is_bootstrap_origin_allowed(origin: Option<&str>) -> bool {
    match origin {
        None => true,
        Some(
            EXTENSION_ORIGIN
            | "tauri://localhost"
            | "http://tauri.localhost"
            | "https://tauri.localhost",
        ) => true,
        Some(origin) => {
            env::var("SMART_PROMPT_ALLOW_DEV_BOOTSTRAP").ok().as_deref() == Some("1")
                && (is_loopback_http_origin(origin, "127.0.0.1")
                    || is_loopback_http_origin(origin, "localhost"))
        }
    }
}

fn is_activation_event_route(method: &Method, path: &str) -> bool {
    method == &Method::Post && matches!(path, "/activation/browser-seen" | "/activation/complete")
}

fn activation_response(result: Result<Value, activation::ActivationError>) -> (u16, Value) {
    match result {
        Ok(status) => (200, json!({ "ok": true, "activation": status })),
        Err(error) => (
            error.status,
            json!({
                "ok": false,
                "error": {
                    "code": error.code,
                    "message": error.message
                }
            }),
        ),
    }
}

fn codex_activation_response(
    result: Result<Value, activation_v2::ActivationError>,
) -> (u16, Value) {
    match result {
        Ok(status) => (200, json!({ "ok": true, "activation": status })),
        Err(error) => (
            error.status,
            json!({
                "ok": false,
                "error": {
                    "code": error.code,
                    "message": error.message
                }
            }),
        ),
    }
}

fn codex_activation_contract_mismatch() -> (u16, Value) {
    (
        400,
        json!({
            "ok": false,
            "error": {
                "code": "codex_activation_contract_mismatch",
                "message": "Codex activation contract version is not supported."
            }
        }),
    )
}

fn initialize_activation(data_dir: &Path) -> Result<(), String> {
    let legacy_data_present = [
        "settings.json",
        "provider-keys-sidecar.json",
        "metrics.json",
    ]
    .iter()
    .any(|name| data_dir.join(name).exists());
    let settings = private_settings(data_dir)?;
    let has_provider =
        credential_store::has_any_key(&credential_store::load_provider_keys(data_dir)?);
    let historical_events = read_array(data_dir, "metrics.json")?;
    activation::initialize(
        data_dir,
        legacy_data_present,
        has_provider,
        settings
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or(""),
        &historical_events,
    )
    .map_err(|_| "activation_state_initialization_failed".to_string())?;
    let phase3_status = activation::get_status(data_dir)
        .map_err(|_| "activation_state_initialization_failed".to_string())?;
    activation_v2::initialize(data_dir, Some(&phase3_status))
        .map(|_| ())
        .map_err(|_| "codex_activation_state_initialization_failed".to_string())
}

fn ensure_codex_activation_configuring(data_dir: &Path, provider: &str) -> Result<(), String> {
    let status = activation_v2::get_status(data_dir)
        .map_err(|_| "codex_activation_state_update_failed".to_string())?;
    if status.get("progress").and_then(Value::as_str) == Some("not_started") {
        activation_v2::set_progress(data_dir, "configuring", &json!({ "provider": provider }))
            .map_err(|_| "codex_activation_state_update_failed".to_string())?;
    }
    Ok(())
}

fn record_codex_activation_model_ready(data_dir: &Path, provider: &str) -> Result<(), String> {
    ensure_codex_activation_configuring(data_dir, provider)?;
    activation_v2::record_model_ready(data_dir, provider)
        .map(|_| ())
        .map_err(|_| "codex_activation_state_update_failed".to_string())
}

fn now() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{seconds}")
}

fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn get_auth_token(data_dir: &Path) -> Result<String, String> {
    let file = data_dir.join("security.json");
    let current = read_json(&file, json!({}))?;
    if let Some(token) = current.get("authToken").and_then(Value::as_str) {
        if !token.is_empty() {
            return Ok(token.to_string());
        }
    }
    let token = generate_token();
    write_json(&file, &json!({ "authToken": token, "created_at": now() }))?;
    Ok(token)
}

fn is_public(method: &Method, path: &str) -> bool {
    matches!(
        (method, path),
        (Method::Get, "/health") | (Method::Get, "/auth/bootstrap")
    )
}

fn is_authorized(request: &Request, data_dir: &Path) -> bool {
    let expected = match get_auth_token(data_dir) {
        Ok(value) => value,
        Err(_) => return false,
    };
    for header in request.headers() {
        let name = header.field.as_str().to_ascii_lowercase();
        let value = header.value.as_str();
        if name == "x-smart-prompt-token" && value == expected {
            return true;
        }
        if name == "authorization" {
            let prefix = "bearer ";
            let lower = value.to_ascii_lowercase();
            if lower.starts_with(prefix) && value[prefix.len()..].trim() == expected {
                return true;
            }
        }
    }
    false
}

fn read_json(file: &Path, fallback: Value) -> Result<Value, String> {
    match fs::read_to_string(file) {
        Ok(text) => serde_json::from_str(&text).map_err(|error| error.to_string()),
        Err(_) => Ok(fallback),
    }
}

fn write_json(file: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(
        file,
        format!(
            "{}\n",
            serde_json::to_string_pretty(value).map_err(|error| error.to_string())?
        ),
    )
    .map_err(|error| error.to_string())
}

fn read_array(data_dir: &Path, name: &str) -> Result<Vec<Value>, String> {
    Ok(read_json(&data_dir.join(name), json!([]))?
        .as_array()
        .cloned()
        .unwrap_or_default())
}

fn default_settings() -> Value {
    json!({
        "provider": "auto",
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
        "temperature": 0.35,
        "apiKey": "",
        "customProvider": {
            "name": "",
            "protocol": "openai-compatible",
            "baseUrl": "",
            "model": ""
        },
        "providerKeys": {
            "agnes": "",
            "openai-compatible": "",
            "anthropic": "",
            "gemini": "",
            "custom": ""
        },
        "uploadWholePage": false,
        "autoSubmit": false
    })
}

fn migrate_legacy_settings_credentials(
    data_dir: &Path,
    mut persisted: Value,
) -> Result<(Value, credential_store::ProviderKeys), String> {
    if !persisted.is_object() {
        persisted = json!({});
    }
    let mut keys = credential_store::load_provider_keys(data_dir)?;
    let mut contains_legacy_credentials = false;

    if let Some(incoming) = persisted.get("providerKeys").and_then(Value::as_object) {
        for (provider, value) in incoming {
            let legacy_key = value.as_str().unwrap_or("");
            if legacy_key.is_empty() || !keys.contains_key(provider) {
                continue;
            }
            contains_legacy_credentials = true;
            if keys.get(provider).is_none_or(|current| current.is_empty()) {
                keys.insert(provider.clone(), legacy_key.to_string());
            }
        }
    }

    let legacy_api_key = persisted
        .get("apiKey")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !legacy_api_key.is_empty() {
        contains_legacy_credentials = true;
        let configured_provider = persisted
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or("auto");
        let target_provider =
            if configured_provider == "auto" || !keys.contains_key(configured_provider) {
                "openai-compatible"
            } else {
                configured_provider
            };
        if keys
            .get(target_provider)
            .is_none_or(|current| current.is_empty())
        {
            keys.insert(target_provider.to_string(), legacy_api_key.to_string());
        }
    }

    if contains_legacy_credentials {
        credential_store::save_provider_keys(data_dir, &keys)?;
        persisted["apiKey"] = json!("");
        persisted["providerKeys"] = serde_json::to_value(credential_store::empty_provider_keys())
            .map_err(|error| error.to_string())?;
        persisted["uploadWholePage"] = json!(false);
        persisted["autoSubmit"] = json!(false);
        write_json(
            &data_dir.join("settings-credential-migration-recovery.json"),
            &persisted,
        )?;
        write_json(&data_dir.join("settings.json"), &persisted)?;
        write_json(
            &data_dir.join("key-migration.json"),
            &json!({
                "migrateProviderKeys": true,
                "migratedAt": now(),
                "storage": credential_store::storage_summary()["storage"],
                "source": "legacy-settings"
            }),
        )?;
    }

    Ok((persisted, keys))
}

fn private_settings(data_dir: &Path) -> Result<Value, String> {
    let persisted = read_json(&data_dir.join("settings.json"), json!({}))?;
    let (persisted, keys) = migrate_legacy_settings_credentials(data_dir, persisted)?;
    let mut settings = merge(default_settings(), persisted);
    settings["customProvider"] = merge(
        default_settings()["customProvider"].clone(),
        settings["customProvider"].clone(),
    );
    settings["providerKeys"] = serde_json::to_value(keys).map_err(|error| error.to_string())?;
    settings["apiKey"] = json!("");
    settings["uploadWholePage"] = json!(false);
    settings["autoSubmit"] = json!(false);
    Ok(settings)
}

fn public_settings(data_dir: &Path) -> Result<Value, String> {
    let mut settings = private_settings(data_dir)?;
    let mut redacted = serde_json::Map::new();
    if let Some(keys) = settings.get("providerKeys").and_then(Value::as_object) {
        for (provider, value) in keys {
            redacted.insert(
                provider.clone(),
                json!(redact_key(value.as_str().unwrap_or(""))),
            );
        }
    }
    settings["apiKey"] = json!("");
    settings["providerKeys"] = Value::Object(redacted);
    settings["credentialStorage"] = credential_store::storage_summary();
    Ok(settings)
}

fn normalize_model_id(value: &str) -> Result<String, &'static str> {
    let model = value.trim();
    if model.is_empty() || model.chars().count() > 200 || model.chars().any(char::is_whitespace) {
        return Err("model_invalid");
    }
    Ok(model.to_string())
}

fn settings_validation_response(error: &str) -> Option<(u16, Value)> {
    let message = match error {
        "model_invalid" => "Model ID is invalid.",
        "custom_provider_name_invalid" => "Custom provider name is invalid.",
        "custom_provider_protocol_invalid" => "Custom provider protocol is invalid.",
        "custom_provider_base_url_invalid" => "Custom provider Base URL is invalid.",
        _ => return None,
    };
    Some((
        400,
        json!({
            "ok": false,
            "error": {
                "code": error,
                "message": message
            }
        }),
    ))
}

fn normalize_provider_id(value: &str, fallback: &str) -> String {
    match value {
        "auto" | "agnes" | "openai-compatible" | "anthropic" | "gemini" | "custom" => {
            value.to_string()
        }
        _ => fallback.to_string(),
    }
}

fn normalize_custom_provider_name(value: &str) -> Result<String, &'static str> {
    let name = value.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err("custom_provider_name_invalid");
    }
    Ok(name.to_string())
}

fn normalize_custom_provider_protocol(value: &str) -> Result<String, &'static str> {
    let protocol = value.trim().to_ascii_lowercase();
    match protocol.as_str() {
        "openai-compatible" | "anthropic" | "gemini" => Ok(protocol),
        _ => Err("custom_provider_protocol_invalid"),
    }
}

fn normalize_provider_base_url(value: &str) -> Result<String, &'static str> {
    let base_url = value.trim();
    if base_url.is_empty()
        || base_url.chars().count() > 2048
        || base_url.chars().any(char::is_whitespace)
    {
        return Err("custom_provider_base_url_invalid");
    }
    let authority = base_url
        .strip_prefix("https://")
        .or_else(|| base_url.strip_prefix("http://"))
        .and_then(|rest| rest.split(['/', '?', '#']).next())
        .unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return Err("custom_provider_base_url_invalid");
    }
    Ok(base_url.trim_end_matches('/').to_string())
}

fn prepare_custom_provider(current: &Value, next: &Value, provider: &str) -> Result<Value, String> {
    let incoming = next.get("customProvider").filter(|value| value.is_object());
    let mut candidate = merge(
        default_settings()["customProvider"].clone(),
        current
            .get("customProvider")
            .cloned()
            .unwrap_or_else(|| json!({})),
    );
    if let Some(value) = incoming {
        candidate = merge(candidate, value.clone());
    }
    if provider == "custom" {
        let incoming_has_base_url = incoming
            .and_then(Value::as_object)
            .is_some_and(|value| value.contains_key("baseUrl"));
        let incoming_has_model = incoming
            .and_then(Value::as_object)
            .is_some_and(|value| value.contains_key("model"));
        if !incoming_has_base_url && next.get("baseUrl").is_some() {
            candidate["baseUrl"] = next["baseUrl"].clone();
        }
        if !incoming_has_model && next.get("model").is_some() {
            candidate["model"] = next["model"].clone();
        }
    }
    if provider == "custom" || incoming.is_some() {
        return Ok(json!({
            "name": normalize_custom_provider_name(candidate["name"].as_str().unwrap_or(""))
                .map_err(str::to_string)?,
            "protocol": normalize_custom_provider_protocol(candidate["protocol"].as_str().unwrap_or(""))
                .map_err(str::to_string)?,
            "baseUrl": normalize_provider_base_url(candidate["baseUrl"].as_str().unwrap_or(""))
                .map_err(str::to_string)?,
            "model": normalize_model_id(candidate["model"].as_str().unwrap_or(""))
                .map_err(str::to_string)?
        }));
    }
    Ok(candidate)
}

fn prepare_settings(data_dir: &Path, mut next: Value) -> Result<Value, String> {
    if !next.is_object() {
        next = json!({});
    }
    let current = private_settings(data_dir)?;
    let current_provider = current
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("auto");
    let provider = normalize_provider_id(
        next.get("provider")
            .and_then(Value::as_str)
            .unwrap_or(current_provider),
        current_provider,
    );
    let custom_provider = prepare_custom_provider(&current, &next, &provider)?;
    let model_source = if provider == "custom" {
        custom_provider.get("model").and_then(Value::as_str)
    } else if next.get("model").is_some() {
        next.get("model").and_then(Value::as_str)
    } else {
        current.get("model").and_then(Value::as_str)
    }
    .ok_or_else(|| "model_invalid".to_string())?;
    let model = normalize_model_id(model_source).map_err(str::to_string)?;
    let mut keys = credential_store::load_provider_keys(data_dir)?;
    if let Some(incoming) = next.get("providerKeys").and_then(Value::as_object) {
        for (name, value) in incoming {
            let key = value.as_str().unwrap_or("");
            if key.is_empty() || !keys.contains_key(name) {
                continue;
            }
            keys.insert(name.clone(), key.to_string());
        }
    }
    if let Some(api_key) = next.get("apiKey").and_then(Value::as_str) {
        if !api_key.is_empty() {
            let target = if provider == "auto" {
                "openai-compatible"
            } else {
                provider.as_str()
            };
            keys.insert(target.to_string(), api_key.to_string());
        }
    }
    let mut prepared = merge(current, next);
    prepared["provider"] = json!(provider);
    prepared["customProvider"] = custom_provider.clone();
    if prepared["provider"] == "custom" {
        prepared["baseUrl"] = custom_provider["baseUrl"].clone();
    }
    prepared["model"] = json!(model);
    prepared["apiKey"] = json!("");
    prepared["providerKeys"] = serde_json::to_value(keys).map_err(|error| error.to_string())?;
    prepared["uploadWholePage"] = json!(false);
    prepared["autoSubmit"] = json!(false);
    Ok(prepared)
}

fn persist_settings(data_dir: &Path, prepared: &Value) -> Result<(), String> {
    let keys: credential_store::ProviderKeys = serde_json::from_value(
        prepared
            .get("providerKeys")
            .cloned()
            .unwrap_or_else(|| default_settings()["providerKeys"].clone()),
    )
    .map_err(|error| error.to_string())?;
    credential_store::save_provider_keys(data_dir, &keys)?;
    let mut persisted = prepared.clone();
    persisted["apiKey"] = json!("");
    persisted["providerKeys"] = default_settings()["providerKeys"].clone();
    persisted["uploadWholePage"] = json!(false);
    persisted["autoSubmit"] = json!(false);
    write_json(&data_dir.join("settings.json"), &persisted)?;
    write_json(
        &data_dir.join("key-migration.json"),
        &json!({
            "migrateProviderKeys": true,
            "migratedAt": now(),
            "storage": credential_store::storage_summary()["storage"]
        }),
    )?;
    activation::record_settings_saved(
        data_dir,
        prepared
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or(""),
    )
    .map_err(|_| "activation_state_update_failed".to_string())?;
    ensure_codex_activation_configuring(
        data_dir,
        prepared
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or(""),
    )?;
    Ok(())
}

fn save_settings(data_dir: &Path, next: Value) -> Result<(), String> {
    let prepared = prepare_settings(data_dir, next)?;
    persist_settings(data_dir, &prepared)
}

fn merge(mut base: Value, next: Value) -> Value {
    if let (Some(base_obj), Some(next_obj)) = (base.as_object_mut(), next.as_object()) {
        for (key, value) in next_obj {
            base_obj.insert(key.clone(), value.clone());
        }
    }
    base
}

fn redact_key(value: &str) -> String {
    if value.is_empty() {
        String::new()
    } else {
        "configured".to_string()
    }
}

fn provider_status(data_dir: &Path) -> Result<Value, String> {
    let settings = private_settings(data_dir)?;
    let keys = settings
        .get("providerKeys")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let custom = settings
        .get("customProvider")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let providers = vec![
        (
            "agnes".to_string(),
            "Agnes".to_string(),
            "https://apihub.agnes-ai.com/v1".to_string(),
            "agnes-2.0-flash".to_string(),
        ),
        (
            "openai-compatible".to_string(),
            "OpenAI-compatible".to_string(),
            "https://api.openai.com/v1".to_string(),
            "gpt-4o-mini".to_string(),
        ),
        (
            "anthropic".to_string(),
            "Anthropic".to_string(),
            "https://api.anthropic.com/v1".to_string(),
            "claude-sonnet-4-20250514".to_string(),
        ),
        (
            "gemini".to_string(),
            "Gemini".to_string(),
            "https://generativelanguage.googleapis.com/v1beta".to_string(),
            "gemini-2.5-flash".to_string(),
        ),
        (
            "custom".to_string(),
            custom
                .get("name")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .unwrap_or("Custom Provider")
                .to_string(),
            custom
                .get("baseUrl")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            custom
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        ),
    ];
    let selected = settings
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("auto");
    let auto = selected_provider(&merge(settings.clone(), json!({ "provider": "auto" })));
    Ok(json!({
        "ok": true,
        "selected": selected,
        "auto": { "provider": auto },
        "providers": providers.iter().map(|(provider, label, base_url, model)| json!({
            "provider": provider,
            "label": label,
            "baseUrl": base_url,
            "model": model,
            "selected": provider == selected,
            "keyAvailable": keys.get(provider).and_then(Value::as_str).unwrap_or("").len() > 0,
            "keySource": if keys.get(provider).and_then(Value::as_str).unwrap_or("").is_empty() { "" } else { "native-sidecar" },
            "usesStoredKey": keys.get(provider).and_then(Value::as_str).unwrap_or("").len() > 0
        })).collect::<Vec<_>>()
    }))
}

const PROVIDER_ORDER: [&str; 4] = ["agnes", "anthropic", "gemini", "openai-compatible"];

fn provider_defaults(provider: &str) -> (&'static str, &'static str) {
    match provider {
        "agnes" => ("https://apihub.agnes-ai.com/v1", "agnes-2.0-flash"),
        "anthropic" => ("https://api.anthropic.com/v1", "claude-sonnet-4-20250514"),
        "gemini" => (
            "https://generativelanguage.googleapis.com/v1beta",
            "gemini-2.5-flash",
        ),
        _ => ("https://api.openai.com/v1", "gpt-4o-mini"),
    }
}

fn selected_provider_key(settings: &Value) -> String {
    let keys = settings
        .get("providerKeys")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let selected = settings
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("auto");
    if selected != "auto" {
        return keys
            .get(selected)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
    }
    for provider in PROVIDER_ORDER {
        let key = keys.get(provider).and_then(Value::as_str).unwrap_or("");
        if !key.is_empty() {
            return key.to_string();
        }
    }
    String::new()
}

fn selected_provider(settings: &Value) -> String {
    let selected = settings
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("auto");
    if selected != "auto" {
        return normalize_provider_id(selected, "openai-compatible");
    }
    let keys = settings
        .get("providerKeys")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for provider in PROVIDER_ORDER {
        if !keys
            .get(provider)
            .and_then(Value::as_str)
            .unwrap_or("")
            .is_empty()
        {
            return provider.to_string();
        }
    }
    "openai-compatible".to_string()
}

fn effective_provider_settings(settings: &Value) -> Value {
    let requested = settings
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("auto");
    if requested != "auto" {
        return settings.clone();
    }
    let provider = selected_provider(settings);
    let (base_url, model) = provider_defaults(&provider);
    let mut effective = settings.clone();
    effective["provider"] = json!(provider);
    effective["baseUrl"] = json!(base_url);
    effective["model"] = json!(model);
    effective
}

fn generate_with_provider(
    settings: &Value,
    input: &str,
    mode: &str,
    skills: &[Value],
    variant: usize,
    generation_policy: Option<&str>,
) -> Result<String, ProviderFailure> {
    let effective = effective_provider_settings(settings);
    let key = selected_provider_key(&effective);
    if key.is_empty() {
        return Err(ProviderFailure::credential_invalid());
    }
    let provider = selected_provider(&effective);
    let prompt = build_prompt(input, mode, skills, variant, generation_policy);
    let protocol = if provider == "custom" {
        effective
            .pointer("/customProvider/protocol")
            .and_then(Value::as_str)
            .unwrap_or("openai-compatible")
    } else {
        provider.as_str()
    };
    match protocol {
        "gemini" => call_gemini(&effective, &key, &prompt),
        "anthropic" => call_anthropic(&effective, &key, &prompt),
        _ => call_openai_compatible(&effective, &key, &prompt),
    }
}

fn call_openai_compatible(
    settings: &Value,
    key: &str,
    prompt: &str,
) -> Result<String, ProviderFailure> {
    let base = settings
        .get("baseUrl")
        .and_then(Value::as_str)
        .unwrap_or("https://api.openai.com/v1")
        .trim_end_matches('/');
    let model = settings
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("gpt-4o-mini");
    let url = format!("{base}/chat/completions");
    let response = ureq::post(&url)
        .set("Authorization", &format!("Bearer {key}"))
        .set("Content-Type", "application/json")
        .send_json(json!({
            "model": model,
            "messages": [
                { "role": "system", "content": "Return only a polished prompt for the user's AI tool." },
                { "role": "user", "content": prompt }
            ],
            "temperature": 0.35
        }));
    let response = read_provider_json(response)?;
    response
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .ok_or_else(ProviderFailure::provider_error)
}

fn call_anthropic(settings: &Value, key: &str, prompt: &str) -> Result<String, ProviderFailure> {
    let base = settings
        .get("baseUrl")
        .and_then(Value::as_str)
        .unwrap_or("https://api.anthropic.com/v1")
        .trim_end_matches('/');
    let model = settings
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("claude-sonnet-4-20250514");
    let response = ureq::post(&format!("{base}/messages"))
        .set("x-api-key", key)
        .set("anthropic-version", "2023-06-01")
        .set("Content-Type", "application/json")
        .send_json(json!({
            "model": model,
            "max_tokens": 900,
            "messages": [{ "role": "user", "content": prompt }]
        }));
    let response = read_provider_json(response)?;
    response
        .pointer("/content/0/text")
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .ok_or_else(ProviderFailure::provider_error)
}

fn call_gemini(settings: &Value, key: &str, prompt: &str) -> Result<String, ProviderFailure> {
    let base = settings
        .get("baseUrl")
        .and_then(Value::as_str)
        .unwrap_or("https://generativelanguage.googleapis.com/v1beta")
        .trim_end_matches('/');
    let model = settings
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("gemini-2.5-flash");
    let model_path = gemini_model_path(model);
    let response = ureq::post(&format!("{base}/{model_path}:generateContent?key={key}"))
        .set("Content-Type", "application/json")
        .send_json(json!({
            "contents": [{ "parts": [{ "text": prompt }] }]
        }));
    let response = read_provider_json(response)?;
    response
        .pointer("/candidates/0/content/parts/0/text")
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .ok_or_else(ProviderFailure::provider_error)
}

fn gemini_model_path(model: &str) -> String {
    let model = model.trim();
    if model.starts_with("models/") {
        model.to_string()
    } else {
        format!("models/{model}")
    }
}

fn read_provider_json(
    response: Result<ureq::Response, ureq::Error>,
) -> Result<Value, ProviderFailure> {
    response
        .map_err(ProviderFailure::from_ureq)?
        .into_json()
        .map_err(|_| ProviderFailure::provider_error())
}

fn classify_provider_failure(status: u16, body: &str) -> ProviderFailure {
    let signal = body.to_ascii_lowercase();
    if status == 401
        || status == 403
        || [
            "credential",
            "api key",
            "api_key",
            "unauthorized",
            "permission",
        ]
        .iter()
        .any(|needle| signal.contains(needle))
    {
        return ProviderFailure::credential_invalid();
    }
    let mentions_model = signal.contains("model") || signal.contains("deployment");
    let unavailable = [
        "not found",
        "does not exist",
        "unsupported",
        "unavailable",
        "invalid model",
        "missing",
    ]
    .iter()
    .any(|needle| signal.contains(needle));
    if mentions_model && unavailable {
        return ProviderFailure::model_unavailable();
    }
    if matches!(status, 408 | 504) {
        return ProviderFailure::network_unavailable();
    }
    ProviderFailure::provider_error()
}

fn provider_failure_response(error: ProviderFailure, operation: &str) -> (u16, Value) {
    (
        502,
        json!({
            "ok": false,
            "error": {
                "code": error.code,
                "message": error.message,
                "operation": operation
            }
        }),
    )
}

fn detect_mode(input: &str) -> &'static str {
    let lower = input.to_ascii_lowercase();
    if lower.contains("polish") || lower.contains("rewrite") || lower.contains("优化") {
        "polish"
    } else if lower.len() > 120 {
        "continue"
    } else {
        "idea"
    }
}

fn mode_label(mode: &str) -> &'static str {
    match mode {
        "continue" => "Continue",
        "polish" => "Polish",
        _ => "Idea",
    }
}

fn build_prompt(
    input: &str,
    mode: &str,
    skills: &[Value],
    variant: usize,
    generation_policy: Option<&str>,
) -> String {
    let skill_names = skills
        .iter()
        .take(3)
        .filter_map(|skill| skill.get("name").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(", ");
    let policy = generation_policy
        .filter(|value| !value.is_empty())
        .map(|value| {
            format!(
                "\nApply exactly this one versioned local Generation Policy. Treat its tokens as private aggregate guidance and never expose them in the generated prompt:\n{value}\n"
            )
        })
        .unwrap_or_default();
    format!(
        "Mode: {}\nVariant: {}\nRelevant skills: {}\n{}\nTurn the user's draft into a concise, actionable prompt with clear context, constraints, acceptance criteria, and privacy-safe boundaries. Never submit, press Enter, or expand permissions.\n\nUser draft:\n{}",
        mode_label(mode),
        variant + 1,
        if skill_names.is_empty() { "none" } else { &skill_names },
        policy,
        input
    )
}

fn recommend_skills(input: &str, skills: &[Value]) -> Vec<Value> {
    let lower = input.to_ascii_lowercase();
    skills
        .iter()
        .filter(|skill| {
            let name = skill
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_ascii_lowercase();
            let description = skill
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_ascii_lowercase();
            lower.is_empty()
                || lower
                    .split_whitespace()
                    .any(|token| name.contains(token) || description.contains(token))
        })
        .take(3)
        .cloned()
        .collect()
}

fn import_skill_folder(folder: &str) -> Result<Vec<Value>, String> {
    let root = PathBuf::from(folder);
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    visit_skill_files(&root, &mut out)?;
    Ok(out)
}

fn visit_skill_files(dir: &Path, out: &mut Vec<Value>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            visit_skill_files(&path, out)?;
        } else if path.file_name().and_then(|name| name.to_str()) == Some("SKILL.md") {
            let text = fs::read_to_string(&path).unwrap_or_default();
            let name = text
                .lines()
                .find(|line| line.starts_with("name:"))
                .map(|line| line.trim_start_matches("name:").trim().to_string())
                .unwrap_or_else(|| {
                    path.parent()
                        .and_then(|p| p.file_name())
                        .and_then(|n| n.to_str())
                        .unwrap_or("skill")
                        .to_string()
                });
            out.push(json!({
                "id": format!("skill-{}", out.len() + 1),
                "name": name,
                "description": text.lines().find(|line| line.starts_with("description:")).map(|line| line.trim_start_matches("description:").trim()).unwrap_or("Imported local skill"),
                "path": path.to_string_lossy()
            }));
        }
    }
    Ok(())
}

fn add_prompt(data_dir: &Path, body: Value) -> Result<Vec<Value>, String> {
    let mut prompts = read_array(data_dir, "prompts.json")?;
    let prompt_body = body
        .get("body")
        .or_else(|| body.get("prompt"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let title = body
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Untitled prompt");
    let id = body
        .get("id")
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .unwrap_or_else(|| format!("prompt-{}", now()));
    prompts.retain(|item| item.get("id").and_then(Value::as_str).unwrap_or("") != id);
    prompts.insert(
        0,
        json!({
            "id": id,
            "title": title,
            "body": prompt_body,
            "bodyHash": format!("{}", prompt_body.len()),
            "mode": body.get("mode").and_then(Value::as_str).unwrap_or("custom"),
            "tags": body.get("tags").cloned().unwrap_or(json!([])),
            "context": body.get("context").cloned().unwrap_or(json!({})),
            "created_at": now(),
            "updated_at": now(),
            "source": body.get("source").and_then(Value::as_str).unwrap_or("native-sidecar")
        }),
    );
    prompts.truncate(200);
    write_json(
        &data_dir.join("prompts.json"),
        &Value::Array(prompts.clone()),
    )?;
    Ok(prompts)
}

fn search(data_dir: &Path, url: &str) -> Result<(u16, Value), String> {
    let query = url.split('?').nth(1).unwrap_or("");
    let needle = query
        .split('&')
        .find_map(|part| part.strip_prefix("q="))
        .map(decode_path_id)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let prompts = read_array(data_dir, "prompts.json")?
        .into_iter()
        .filter(|prompt| prompt.to_string().to_ascii_lowercase().contains(&needle))
        .collect::<Vec<_>>();
    let skills = read_array(data_dir, "skills.json")?
        .into_iter()
        .filter(|skill| skill.to_string().to_ascii_lowercase().contains(&needle))
        .collect::<Vec<_>>();
    Ok((
        200,
        json!({ "ok": true, "queryLength": needle.len(), "prompts": prompts, "skills": skills }),
    ))
}

fn export_data(data_dir: &Path) -> Result<Value, String> {
    Ok(json!({
        "schemaVersion": 1,
        "exported_at": now(),
        "settings": public_settings(data_dir)?,
        "skills": read_array(data_dir, "skills.json")?,
        "prompts": read_array(data_dir, "prompts.json")?,
        "promptHistory": read_array(data_dir, "prompt-history.json")?,
        "metrics": read_array(data_dir, "metrics.json")?
    }))
}

fn restore_data(data_dir: &Path, bundle: Value) -> Result<Value, String> {
    for (key, file) in [
        ("skills", "skills.json"),
        ("prompts", "prompts.json"),
        ("promptHistory", "prompt-history.json"),
        ("metrics", "metrics.json"),
    ] {
        if let Some(value) = bundle.get(key) {
            if key == "promptHistory" {
                let mut entries = value.as_array().cloned().unwrap_or_default();
                entries.truncate(100);
                for entry in &mut entries {
                    if let Some(object) = entry.as_object_mut() {
                        object.insert("verifiedInsertEvidence".to_string(), Value::Bool(false));
                        object.insert("editFeatureSummary".to_string(), Value::Null);
                        object.remove("verifiedSessionId");
                        object.remove("learningCandidateSeed");
                    }
                }
                write_json(&data_dir.join(file), &Value::Array(entries))?;
            } else {
                write_json(&data_dir.join(file), value)?;
            }
        }
    }
    Ok(json!({
        "schemaVersion": 1,
        "skills": read_array(data_dir, "skills.json")?.len(),
        "prompts": read_array(data_dir, "prompts.json")?.len(),
        "promptHistory": read_array(data_dir, "prompt-history.json")?.len(),
        "metrics": read_array(data_dir, "metrics.json")?.len()
    }))
}

fn clear_all_local_data(data_dir: &Path, port: u16) -> Result<Value, String> {
    let recovery_root = data_dir.join(".recovery");
    fs::create_dir_all(&recovery_root).map_err(|_| "recoverable_reset_init_failed".to_string())?;
    let recovery_id = format!("reset-{}-{}", now(), &generate_token()[..12]);
    let recovery_dir = recovery_root.join(&recovery_id);
    fs::create_dir(&recovery_dir).map_err(|_| "recoverable_reset_init_failed".to_string())?;

    let entries = fs::read_dir(data_dir)
        .map_err(|_| "recoverable_reset_read_failed".to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name() != ".recovery")
        .collect::<Vec<_>>();
    let mut moved = Vec::new();
    for entry in entries {
        let name = entry.file_name();
        let source = entry.path();
        let target = recovery_dir.join(&name);
        if fs::rename(&source, &target).is_err() {
            for (original, retained) in moved.iter().rev() {
                let _ = fs::rename(retained, original);
            }
            return Err("recoverable_reset_move_failed".to_string());
        }
        moved.push((source, target));
    }

    let moved_names = moved
        .iter()
        .filter_map(|(_, retained)| retained.file_name())
        .map(|name| name.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    let reset_at = now();
    write_json(
        &recovery_dir.join("recovery-manifest.json"),
        &json!({
            "schemaVersion": "recoverable-local-data-reset@1",
            "recoveryId": recovery_id,
            "resetAt": reset_at,
            "moved": moved_names
        }),
    )?;

    let _ = get_auth_token(data_dir)?;
    initialize_activation(data_dir)?;
    write_json(
        &data_dir.join("sidecar-port.json"),
        &json!({
            "requestedPort": port,
            "port": port,
            "portRecovery": false,
            "updatedAt": now()
        }),
    )?;
    log_event(
        data_dir,
        "clear_all_local_data",
        json!({
            "clearAllLocalData": true,
            "resetMode": "recoverable",
            "recoveryId": recovery_id
        }),
    );
    Ok(json!({
        "schemaVersion": "recoverable-local-data-reset@1",
        "resetMode": "recoverable",
        "recoveryId": recovery_id,
        "recoveryDirectory": recovery_dir.to_string_lossy(),
        "moved": moved_names
    }))
}

fn value_bool(value: &Value, path: &str) -> bool {
    value
        .pointer(path)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn value_i64(value: &Value, path: &str, fallback: i64) -> i64 {
    value
        .pointer(path)
        .and_then(Value::as_i64)
        .unwrap_or(fallback)
}

fn value_str(value: &Value, path: &str) -> String {
    value
        .pointer(path)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn privacy_bool(value: &Value, path: &str) -> bool {
    value.pointer(path).and_then(Value::as_bool).unwrap_or(true)
}

fn prompt_state_text(body: &Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(value) = body.get(*key).and_then(Value::as_str) {
            return value.trim().to_string();
        }
    }
    String::new()
}

fn prompt_state_hash(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    let digest = Sha256::digest(value.as_bytes());
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn sanitize_token(value: &str, fallback: &str) -> String {
    let mut token = String::new();
    let mut last_dash = false;
    for character in value.to_ascii_lowercase().chars() {
        let allowed =
            character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | ':' | '-');
        if allowed {
            token.push(character);
            last_dash = false;
        } else if !last_dash {
            token.push('-');
            last_dash = true;
        }
    }
    let token = token.trim_matches('-').to_string();
    if token.is_empty() {
        fallback.to_string()
    } else {
        token
    }
}

fn prompt_state_readiness_str(body: &Value, field: &str, fallback: &str) -> String {
    body.pointer(&format!("/readiness/{field}"))
        .or_else(|| body.get(field))
        .and_then(Value::as_str)
        .map(|value| sanitize_token(value, fallback))
        .unwrap_or_else(|| fallback.to_string())
}

fn prompt_state_readiness_bool(body: &Value, field: &str) -> bool {
    body.pointer(&format!("/readiness/{field}"))
        .or_else(|| body.get(field))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn prompt_state_readiness_i64(body: &Value, field: &str, fallback: i64) -> i64 {
    body.pointer(&format!("/readiness/{field}"))
        .or_else(|| body.get(field))
        .and_then(Value::as_i64)
        .unwrap_or(fallback)
}

fn sanitize_desktop_prompt_state(body: &Value) -> Value {
    let draft = prompt_state_text(body, &["draft", "draftText"]);
    let generated = prompt_state_text(body, &["prompt", "generatedPrompt", "text"]);
    let (active_text_kind, active_text) = if !generated.is_empty() {
        ("generated", generated.as_str())
    } else if !draft.is_empty() {
        ("draft", draft.as_str())
    } else {
        ("none", "")
    };
    let no_auto_submit = body
        .get("noAutoSubmit")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    json!({
        "schemaVersion": "p25-desktop-prompt-state@1",
        "recordedAt": now(),
        "source": sanitize_token(body.get("source").and_then(Value::as_str).unwrap_or("desktop-shell"), "desktop-shell"),
        "prepared": !active_text.is_empty(),
        "activeTextKind": active_text_kind,
        "generatedBy": sanitize_token(body.get("generatedBy").or_else(|| body.get("generator")).and_then(Value::as_str).unwrap_or("unknown"), "unknown"),
        "draftLength": draft.len(),
        "draftHash": prompt_state_hash(&draft),
        "generatedLength": generated.len(),
        "generatedHash": prompt_state_hash(&generated),
        "activeTextLength": active_text.len(),
        "activeTextHash": prompt_state_hash(active_text),
        "readiness": {
            "profile": prompt_state_readiness_str(body, "profile", "unknown"),
            "titleHash": body.pointer("/readiness/titleHash").or_else(|| body.get("titleHash")).and_then(Value::as_str).unwrap_or("").chars().take(64).collect::<String>(),
            "candidateIndex": prompt_state_readiness_i64(body, "candidateIndex", -1),
            "ready": prompt_state_readiness_bool(body, "ready"),
            "overlayReady": prompt_state_readiness_bool(body, "overlayReady"),
            "readinessReason": prompt_state_readiness_str(body, "readinessReason", "unknown"),
            "overlayReadinessReason": prompt_state_readiness_str(body, "overlayReadinessReason", "unknown"),
            "noAutoSubmit": no_auto_submit
        },
        "privacy": {
            "promptTextNotStored": true,
            "draftTextNotStored": true,
            "onlyLengthAndHash": true,
            "targetTitleRedacted": true,
            "targetInputsNotStored": true,
            "noAutoSubmitRequired": true
        }
    })
}

fn sanitize_desktop_fill_evidence(fill: &Value) -> Value {
    json!({
        "schemaVersion": value_str(fill, "/schemaVersion"),
        "createdAt": value_str(fill, "/createdAt"),
        "pass": value_bool(fill, "/pass"),
        "reason": value_str(fill, "/reason"),
        "writeAttempted": value_bool(fill, "/writeAttempted"),
        "verified": value_bool(fill, "/verified"),
        "strategy": value_str(fill, "/strategy"),
        "selfTest": value_bool(fill, "/selfTest"),
        "confirmForeground": value_bool(fill, "/confirmForeground"),
        "allowClipboardFallback": value_bool(fill, "/allowClipboardFallback"),
        "allowTextPatternVerification": value_bool(fill, "/allowTextPatternVerification"),
        "clipboardFallbackTried": value_bool(fill, "/clipboardFallbackTried"),
        "clipboardRestored": value_bool(fill, "/clipboardRestored"),
        "foreground": {
            "detectedToolProfile": value_str(fill, "/foreground/detectedToolProfile"),
            "titleHash": value_str(fill, "/foreground/titleHash"),
            "titleLength": value_i64(fill, "/foreground/titleLength", 0),
            "expectedTitleHashMatched": value_bool(fill, "/foreground/expectedTitleHashMatched"),
            "expectedToolProfileMatched": value_bool(fill, "/foreground/expectedToolProfileMatched")
        },
        "target": {
            "index": value_i64(fill, "/target/index", -1),
            "controlType": value_str(fill, "/target/controlType"),
            "titleHash": value_str(fill, "/target/titleHash"),
            "titleLength": value_i64(fill, "/target/titleLength", 0),
            "hasNativeWindowHandle": value_bool(fill, "/target/hasNativeWindowHandle"),
            "hasValuePattern": value_bool(fill, "/target/hasValuePattern"),
            "hasTextPattern": value_bool(fill, "/target/hasTextPattern"),
            "inputSignals": {
                "score": value_i64(fill, "/target/inputSignals/score", 0),
                "hasKeyboardFocus": value_bool(fill, "/target/inputSignals/hasKeyboardFocus"),
                "focusedElementMatch": value_bool(fill, "/target/inputSignals/focusedElementMatch"),
                "caretWithinBounds": value_bool(fill, "/target/inputSignals/caretWithinBounds"),
                "caretWindowMatch": value_bool(fill, "/target/inputSignals/caretWindowMatch"),
                "cursorWithinBounds": value_bool(fill, "/target/inputSignals/cursorWithinBounds"),
                "nearWindowBottom": value_bool(fill, "/target/inputSignals/nearWindowBottom"),
                "broadDocument": value_bool(fill, "/target/inputSignals/broadDocument"),
                "semanticComposerHint": value_bool(fill, "/target/inputSignals/semanticComposerHint"),
                "profileComposerCandidate": value_bool(fill, "/target/inputSignals/profileComposerCandidate")
            }
        },
        "summary": {
            "candidateCount": value_i64(fill, "/summary/candidateCount", 0),
            "safeCandidateCount": value_i64(fill, "/summary/safeCandidateCount", 0),
            "focusedCandidateCount": value_i64(fill, "/summary/focusedCandidateCount", 0),
            "caretCandidateCount": value_i64(fill, "/summary/caretCandidateCount", 0),
            "semanticCandidateCount": value_i64(fill, "/summary/semanticCandidateCount", 0),
            "bestCandidateIndex": value_i64(fill, "/summary/bestCandidateIndex", -1),
            "bestCandidateScore": value_i64(fill, "/summary/bestCandidateScore", 0),
            "requestedTextLength": value_i64(fill, "/summary/requestedTextLength", 0),
            "requestedTextHash": value_str(fill, "/summary/requestedTextHash"),
            "verifiedTextLength": value_i64(fill, "/summary/verifiedTextLength", 0),
            "verifiedTextHash": value_str(fill, "/summary/verifiedTextHash"),
            "autoSubmit": value_bool(fill, "/summary/autoSubmit"),
            "submitSignalCount": value_i64(fill, "/summary/submitSignalCount", 0)
        },
        "privacy": {
            "titleRedacted": privacy_bool(fill, "/privacy/titleRedacted"),
            "elementNamesHashed": privacy_bool(fill, "/privacy/elementNamesHashed"),
            "elementValuesNotReadBeforeWrite": privacy_bool(fill, "/privacy/elementValuesNotReadBeforeWrite"),
            "writtenTextNotStored": privacy_bool(fill, "/privacy/writtenTextNotStored"),
            "clipboardTextNotStored": privacy_bool(fill, "/privacy/clipboardTextNotStored"),
            "fallbackRequiresExplicitAllow": privacy_bool(fill, "/privacy/fallbackRequiresExplicitAllow"),
            "verificationUsesLengthAndHash": privacy_bool(fill, "/privacy/verificationUsesLengthAndHash"),
            "promptTextNotRead": privacy_bool(fill, "/privacy/promptTextNotRead"),
            "autoSubmit": value_bool(fill, "/privacy/autoSubmit")
        }
    })
}

fn parse_probe_json(stdout: &[u8], label: &str, expected_schema: &str) -> Result<Value, String> {
    let text = String::from_utf8_lossy(stdout);
    let text = text.trim_start_matches('\u{feff}').trim();

    for (offset, character) in text.char_indices() {
        if character != '{' {
            continue;
        }
        let candidate = &text[offset..];
        let mut values = serde_json::Deserializer::from_str(candidate).into_iter::<Value>();
        let Some(Ok(value)) = values.next() else {
            continue;
        };
        if value.get("schemaVersion").and_then(Value::as_str) == Some(expected_schema)
            && value.get("pass").and_then(Value::as_bool).is_some()
            && value.get("privacy").and_then(Value::as_object).is_some()
        {
            return Ok(value);
        }
    }

    Err(format!(
        "Invalid {label} JSON: no matching {expected_schema} object found"
    ))
}

fn desktop_input_snapshot(url: &str) -> Result<Value, String> {
    if !cfg!(target_os = "windows") {
        return Ok(json!({
            "schemaVersion": "m3-desktop-input@1",
            "createdAt": now(),
            "platform": std::env::consts::OS,
            "selfTest": url.contains("selfTest=1"),
            "probeOk": false,
            "pass": false,
            "reason": "macos_ax_pending_or_unsupported_platform",
            "supportedToolProfiles": ["codex", "claude-code", "hermes", "workbuddy", "trae"],
            "candidates": [],
            "privacy": desktop_input_privacy()
        }));
    }

    let script = find_m3_script("check-m3-desktop-input.ps1").ok_or_else(|| {
        "M3 desktop input probe script not found near native sidecar.".to_string()
    })?;
    let mut command = Command::new("powershell");
    command
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(script)
        .arg("-JsonOnly");
    if url.contains("selfTest=1") {
        command.arg("-SelfTest");
    }
    let output = command.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "M3 desktop input probe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let mut value = parse_probe_json(&output.stdout, "desktop input", "m3-windows-uia@1")?;
    ensure_desktop_input_privacy(&mut value);
    Ok(value)
}

fn desktop_input_fill(url: &str, body: &Value) -> Result<Value, String> {
    let self_test = url.contains("selfTest=1")
        || body
            .get("selfTest")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    let confirm_foreground = url.contains("confirmForeground=1")
        || body
            .get("confirmForeground")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    let allow_clipboard_fallback = url.contains("allowClipboardFallback=1")
        || body
            .get("allowClipboardFallback")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    let allow_text_pattern_verification = url.contains("allowTextPatternVerification=1")
        || body
            .get("allowTextPatternVerification")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    if !cfg!(target_os = "windows") {
        return Ok(json!({
            "schemaVersion": "m3-windows-fill@1",
            "createdAt": now(),
            "platform": std::env::consts::OS,
            "selfTest": self_test,
            "confirmForeground": confirm_foreground,
            "allowClipboardFallback": allow_clipboard_fallback,
            "allowTextPatternVerification": allow_text_pattern_verification,
            "pass": false,
            "reason": "macos_ax_pending_or_unsupported_platform",
            "writeAttempted": false,
            "verified": false,
            "clipboardFallbackTried": false,
            "clipboardRestored": false,
            "supportedToolProfiles": ["codex", "claude-code", "hermes", "workbuddy", "trae"],
            "privacy": desktop_fill_privacy()
        }));
    }

    let script = find_m3_script("check-m3-desktop-fill.ps1")
        .ok_or_else(|| "M3 desktop fill probe script not found near native sidecar.".to_string())?;
    let mut command = Command::new("powershell");
    command
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(script)
        .arg("-JsonOnly");
    if self_test {
        command.arg("-SelfTest");
    }
    if confirm_foreground {
        command.arg("-ConfirmForeground");
    }
    if allow_clipboard_fallback {
        command.arg("-AllowClipboardFallback");
    }
    if allow_text_pattern_verification {
        command.arg("-AllowTextPatternVerification");
    }
    if let Some(expected_title_hash) = body.get("expectedTitleHash").and_then(Value::as_str) {
        if !expected_title_hash.is_empty() {
            command.arg("-ExpectedTitleHash").arg(expected_title_hash);
        }
    }
    if let Some(expected_tool_profile) = body.get("expectedToolProfile").and_then(Value::as_str) {
        if !expected_tool_profile.is_empty() {
            command
                .arg("-ExpectedToolProfile")
                .arg(expected_tool_profile);
        }
    }
    if let Some(candidate_index) = body.get("candidateIndex").and_then(Value::as_i64) {
        command
            .arg("-CandidateIndex")
            .arg(candidate_index.to_string());
    }
    let text = body
        .get("text")
        .or_else(|| body.get("prompt"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if !text.is_empty() {
        command.arg("-Text").arg(text);
    }
    let output = command.output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "M3 desktop fill probe failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let mut value = parse_probe_json(&output.stdout, "desktop fill", "m3-windows-fill@1")?;
    ensure_desktop_fill_privacy(&mut value);
    Ok(value)
}

fn desktop_input_privacy() -> Value {
    json!({
        "titleRedacted": true,
        "elementNamesHashed": true,
        "elementValuesNotRead": true,
        "promptTextNotRead": true
    })
}

fn ensure_desktop_input_privacy(value: &mut Value) {
    if let Some(object) = value.as_object_mut() {
        object.insert("privacy".to_string(), desktop_input_privacy());
        object
            .entry("supportedToolProfiles".to_string())
            .or_insert_with(|| json!(["codex", "claude-code", "hermes", "workbuddy", "trae"]));
    }
}

fn desktop_fill_privacy() -> Value {
    json!({
        "titleRedacted": true,
        "elementNamesHashed": true,
        "elementValuesNotReadBeforeWrite": true,
        "writtenTextNotStored": true,
        "clipboardTextNotStored": true,
        "fallbackRequiresExplicitAllow": true,
        "verificationUsesLengthAndHash": true,
        "promptTextNotRead": true,
        "autoSubmit": false
    })
}

fn ensure_desktop_fill_privacy(value: &mut Value) {
    if let Some(object) = value.as_object_mut() {
        object.insert("privacy".to_string(), desktop_fill_privacy());
        object
            .entry("supportedToolProfiles".to_string())
            .or_insert_with(|| json!(["codex", "claude-code", "hermes", "workbuddy", "trae"]));
    }
}

#[cfg(debug_assertions)]
fn extend_dev_m3_script_roots(roots: &mut Vec<PathBuf>) {
    if let Ok(current_dir) = std::env::current_dir() {
        roots.extend(current_dir.ancestors().map(Path::to_path_buf));
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    roots.extend(manifest_dir.ancestors().map(Path::to_path_buf));
}

fn find_m3_script(script_name: &str) -> Option<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(current_exe) = std::env::current_exe() {
        roots.extend(current_exe.ancestors().map(Path::to_path_buf));
    }
    #[cfg(debug_assertions)]
    extend_dev_m3_script_roots(&mut roots);
    roots
        .into_iter()
        .map(|root| root.join("scripts").join(script_name))
        .find(|candidate| candidate.exists())
}

fn record_prompt_history(
    data_dir: &Path,
    mode: &str,
    generated_by: &str,
    binding: Option<&GenerationBinding>,
) -> Result<(), String> {
    let mut history = read_array(data_dir, "prompt-history.json")?;
    let mut entry = json!({
        "id": format!("history-{}", now()),
        "created_at": now(),
        "mode": mode,
        "tool": "Smart Prompt",
        "generatedBy": generated_by
    });
    if let Some(binding) = binding {
        entry["generationId"] = json!(binding.generation_id);
        entry["sessionId"] = json!(binding.session_id);
        entry["projectScopeToken"] = json!(binding.project_scope_token);
        entry["strategyId"] = json!(binding.strategy_id);
        entry["strategyVersion"] = json!(binding.strategy_version);
        entry["modelFamilyToken"] = json!(binding.model_family_token);
        entry["taskScenarioToken"] = json!(binding.task_scenario_token);
        entry["policyId"] = binding
            .policy_id
            .as_ref()
            .map_or(Value::Null, |value| json!(value));
        entry["policyVersion"] = binding
            .policy_version
            .map_or(Value::Null, |value| json!(value));
        entry["learningCandidateSeed"] = binding
            .learning_candidate_seed
            .clone()
            .unwrap_or(Value::Null);
        entry["verifiedInsertEvidence"] = Value::Bool(false);
        entry["editFeatureSummary"] = Value::Null;
    }
    history.insert(0, entry);
    history.truncate(100);
    write_json(
        &data_dir.join("prompt-history.json"),
        &Value::Array(history),
    )
}

fn record_verified_generation_edit_summary(
    data_dir: &Path,
    binding: &GenerationBinding,
    edit_feature_summary: &Value,
) -> Result<(), String> {
    let mut history = read_array(data_dir, "prompt-history.json")?;
    let Some(entry) = history.iter_mut().find(|entry| {
        entry.get("generationId").and_then(Value::as_str) == Some(binding.generation_id.as_str())
            && entry.get("projectScopeToken").and_then(Value::as_str)
                == Some(binding.project_scope_token.as_str())
    }) else {
        return Err("generation_history_binding_missing".to_string());
    };
    if entry.get("policyId").and_then(Value::as_str) != binding.policy_id.as_deref()
        || entry.get("policyVersion").and_then(Value::as_u64) != binding.policy_version
    {
        return Err("generation_policy_binding_conflict".to_string());
    }
    entry["verifiedInsertEvidence"] = Value::Bool(true);
    entry["editFeatureSummary"] = edit_feature_summary.clone();
    write_json(
        &data_dir.join("prompt-history.json"),
        &Value::Array(history),
    )
}

fn archive_and_clear_project_prompt_history(
    data_dir: &Path,
    archive_dir: &Path,
    project_scope_token: &str,
) -> Result<usize, String> {
    let history = read_array(data_dir, "prompt-history.json")?;
    let (selected, retained): (Vec<_>, Vec<_>) = history.into_iter().partition(|entry| {
        entry.get("projectScopeToken").and_then(Value::as_str) == Some(project_scope_token)
    });
    if selected.is_empty() {
        return Ok(0);
    }
    let selected_count = selected.len();
    write_json(
        &archive_dir.join("prompt-history.json"),
        &json!({
            "schemaVersion": "prompt-history-project-archive@1",
            "projectScopeToken": project_scope_token,
            "entries": selected
        }),
    )?;
    write_json(
        &data_dir.join("prompt-history.json"),
        &Value::Array(retained),
    )?;
    Ok(selected_count)
}

fn event_string(event: &Value, keys: &[&str], max_chars: usize) -> String {
    for key in keys {
        if let Some(value) = event.get(*key).and_then(Value::as_str) {
            return value.chars().take(max_chars).collect();
        }
    }
    String::new()
}

fn record_metric(data_dir: &Path, event: Value) -> Result<Vec<Value>, String> {
    let mut metrics = read_array(data_dir, "metrics.json")?;
    metrics.insert(0, json!({
        "id": event.get("id").and_then(Value::as_str).map(|value| value.to_string()).unwrap_or_else(|| format!("metric-{}", now())),
        "created_at": now(),
        "action": event_string(&event, &["action"], 40),
        "mode": event_string(&event, &["mode"], 40),
        "tool": event_string(&event, &["tool"], 80),
        "adapterId": event_string(&event, &["adapterId", "adapter_id"], 80),
        "site": event_string(&event, &["site", "host"], 120),
        "generatedBy": event_string(&event, &["generatedBy"], 40),
        "source": event_string(&event, &["source"], 40),
        "insertStrategy": event_string(&event, &["insertStrategy", "strategy"], 80),
        "kind": event_string(&event, &["kind"], 40),
        "verified": event.get("verified").and_then(Value::as_bool).unwrap_or(false),
        "failureReason": event_string(&event, &["failureReason", "reason"], 120),
        "ok": event.get("ok").and_then(Value::as_bool).unwrap_or(false),
        "adopted": event.get("adopted").and_then(Value::as_bool).unwrap_or(false),
        "promptLength": event.get("promptLength").and_then(Value::as_u64).unwrap_or(0)
    }));
    metrics.truncate(500);
    write_json(
        &data_dir.join("metrics.json"),
        &Value::Array(metrics.clone()),
    )?;
    Ok(metrics)
}

fn bump_json_usize(value: &mut Value, key: &str) {
    if let Some(object) = value.as_object_mut() {
        let next = object.get(key).and_then(Value::as_u64).unwrap_or(0) + 1;
        object.insert(key.to_string(), json!(next));
    }
}

fn metrics_summary(data_dir: &Path) -> Result<Value, String> {
    let events = read_array(data_dir, "metrics.json")?;
    let mut by_action = BTreeMap::new();
    let mut by_adapter: BTreeMap<String, Value> = BTreeMap::new();
    let mut failure_reasons = BTreeMap::new();
    let mut inserts = 0usize;
    let mut adopted = 0usize;
    let mut card_ready = 0usize;
    let mut saves = 0usize;
    let mut undos = 0usize;
    let mut retries = 0usize;
    for event in &events {
        let action = event
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        *by_action.entry(action.clone()).or_insert(0usize) += 1;
        let adapter_id = event
            .get("adapterId")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let adapter = by_adapter.entry(adapter_id).or_insert_with(|| {
            json!({
                "events": 0,
                "insertAttempts": 0,
                "verifiedInserts": 0,
                "failures": 0
            })
        });
        bump_json_usize(adapter, "events");
        if action == "card_ready" {
            card_ready += 1;
        } else if action == "save" {
            saves += 1;
        } else if action == "undo" {
            undos += 1;
        } else if action == "retry" {
            retries += 1;
        }
        if action == "insert" {
            inserts += 1;
            bump_json_usize(adapter, "insertAttempts");
            if event
                .get("adopted")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || event
                    .get("verified")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            {
                adopted += 1;
                bump_json_usize(adapter, "verifiedInserts");
            } else {
                bump_json_usize(adapter, "failures");
                let reason = event
                    .get("failureReason")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string();
                *failure_reasons.entry(reason).or_insert(0usize) += 1;
            }
        }
    }
    Ok(json!({
        "schemaVersion": 1,
        "eventCount": events.len(),
        "byAction": by_action,
        "byAdapter": by_adapter,
        "failureReasons": failure_reasons,
        "insertSuccessRate": if inserts == 0 { 0.0 } else { adopted as f64 / inserts as f64 },
        "saveRate": if card_ready == 0 { 0.0 } else { saves as f64 / card_ready as f64 },
        "undoUsageRate": if inserts == 0 { 0.0 } else { undos as f64 / inserts as f64 },
        "retryUsageRate": if card_ready == 0 { 0.0 } else { retries as f64 / card_ready as f64 },
        "adapterFailureRate": if inserts == 0 { 0.0 } else { (inserts - adopted) as f64 / inserts as f64 },
        "savedPromptCount": read_array(data_dir, "prompts.json")?.len(),
        "skillCount": read_array(data_dir, "skills.json")?.len(),
        "promptHistoryCount": read_array(data_dir, "prompt-history.json")?.len(),
        "events": events
    }))
}

fn export_diagnostics(data_dir: &Path, port: u16) -> Result<Value, String> {
    let metrics = metrics_summary(data_dir)?;
    Ok(json!({
        "schemaVersion": 1,
        "createdAt": now(),
        "service": SERVICE_NAME,
        "sidecar": "native",
        "port": port,
        "dataDirConfigured": true,
        "diagnostics": true,
        "portRecovery": read_json(&data_dir.join("sidecar-port.json"), json!({}))?,
        "keyMigration": read_json(&data_dir.join("key-migration.json"), json!({ "migrateProviderKeys": false }))?,
        "counts": {
            "skills": metrics["skillCount"],
            "prompts": metrics["savedPromptCount"],
            "promptHistory": metrics["promptHistoryCount"],
            "metrics": metrics["eventCount"]
        },
        "metrics": metrics,
        "logs": read_log_tail(data_dir)
    }))
}

fn log_event(data_dir: &Path, event: &str, detail: Value) {
    let log_dir = data_dir.join("logs");
    let _ = fs::create_dir_all(&log_dir);
    let file = log_dir.join("sidecar.log");
    if let Ok(mut handle) = fs::OpenOptions::new().create(true).append(true).open(file) {
        let _ = writeln!(
            handle,
            "{}",
            json!({ "createdAt": now(), "event": event, "detail": detail })
        );
    }
}

fn read_log_tail(data_dir: &Path) -> Vec<String> {
    let file = data_dir.join("logs").join("sidecar.log");
    fs::read_to_string(file)
        .unwrap_or_default()
        .lines()
        .rev()
        .take(50)
        .map(|line| line.to_string())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

fn send_json(request: Request, status: u16, value: Value) {
    send_json_with_cors_policy(request, status, value, true);
}

fn send_json_without_cors_origin(request: Request, status: u16, value: Value) {
    send_json_with_cors_policy(request, status, value, false);
}

fn send_json_with_cors_policy(
    request: Request,
    status: u16,
    value: Value,
    allow_cors_origin: bool,
) {
    let mut response =
        Response::from_string(format!("{}\n", value)).with_status_code(StatusCode(status));
    for (name, value) in [
        ("Content-Type", "application/json"),
        (
            "Access-Control-Allow-Headers",
            "Content-Type,Authorization,X-Smart-Prompt-Token",
        ),
        (
            "Access-Control-Allow-Methods",
            "GET,POST,PUT,DELETE,OPTIONS",
        ),
        ("Vary", "Origin"),
    ] {
        if let Ok(header) = Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            response.add_header(header);
        }
    }
    if allow_cors_origin {
        if let Some(origin) = request_origin(&request).filter(|origin| is_trusted_origin(origin)) {
            if let Ok(header) =
                Header::from_bytes(b"Access-Control-Allow-Origin", origin.as_bytes())
            {
                response.add_header(header);
            }
        }
    }
    let _ = request.respond(response);
}

fn decode_path_id(value: &str) -> String {
    value
        .replace("%20", " ")
        .replace("%2F", "/")
        .replace("%5C", "\\")
        .replace("%3A", ":")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};
    use target_adapter::{
        AtomicReplaceReply, AtomicReplaceRequest, ComposerSnapshot, ProbeError, ProbeSnapshot,
        TargetExpectation, WriteMethod,
    };

    static NEXT_NATIVE_TEST: AtomicU64 = AtomicU64::new(0);

    struct NativeFakeRunner {
        draft: String,
    }

    impl NativeFakeRunner {
        fn snapshot(&self) -> ProbeSnapshot {
            native_probe_snapshot(&self.draft)
        }
    }

    fn native_probe_snapshot(draft: &str) -> ProbeSnapshot {
        ProbeSnapshot {
            target: "codex".to_string(),
            foreground_hwnd: "0x0000000000000123".to_string(),
            hwnd: "0x0000000000000123".to_string(),
            pid: 4242,
            is_main_window: true,
            is_visible: true,
            is_minimized: false,
            is_cloaked: false,
            runtime_identity_hash: "a".repeat(64),
            project_identity_hash: Some("b".repeat(64)),
            project_identity_reliable: true,
            composer: ComposerSnapshot {
                owner_hwnd: "0x0000000000000123".to_string(),
                candidate_token: "composer_candidate".to_string(),
                focused: true,
                focus_identity_hash: "c".repeat(64),
                can_read_exact: true,
                can_replace_all: true,
                can_set_value: true,
                can_controlled_clipboard: true,
                draft_text: draft.to_string(),
            },
        }
    }

    struct NativeMismatchRunner {
        draft: String,
    }

    impl ProbeRunner for NativeMismatchRunner {
        fn inspect(&mut self) -> Result<ProbeSnapshot, ProbeError> {
            Ok(native_probe_snapshot(&self.draft))
        }

        fn read_exact(
            &mut self,
            _expected: &TargetExpectation,
        ) -> Result<ProbeSnapshot, ProbeError> {
            Ok(native_probe_snapshot(&self.draft))
        }

        fn replace_all_atomic(
            &mut self,
            _request: &AtomicReplaceRequest,
        ) -> Result<AtomicReplaceReply, ProbeError> {
            Ok(AtomicReplaceReply {
                before: native_probe_snapshot(&self.draft),
                attempted: true,
                guard_matched: true,
                lease_fresh_at_commit: true,
                candidate_remapped: false,
                method: WriteMethod::Direct,
                replacement_mode: "set_value".to_string(),
                readback_text: Some("different-written-draft".to_string()),
                clipboard_restored: None,
                focus_confirmed: true,
                select_all_applied: false,
                paste_applied: false,
                submit_count: 0,
            })
        }
    }

    impl ProbeRunner for NativeFakeRunner {
        fn inspect(&mut self) -> Result<ProbeSnapshot, ProbeError> {
            Ok(self.snapshot())
        }

        fn read_exact(
            &mut self,
            _expected: &TargetExpectation,
        ) -> Result<ProbeSnapshot, ProbeError> {
            Ok(self.snapshot())
        }

        fn replace_all_atomic(
            &mut self,
            request: &AtomicReplaceRequest,
        ) -> Result<AtomicReplaceReply, ProbeError> {
            let before = self.snapshot();
            if target_adapter::sha256_hex(&self.draft) != request.expected.draft_hash {
                return Err(ProbeError::new("draft_hash_mismatch"));
            }
            self.draft = request.text.clone();
            Ok(AtomicReplaceReply {
                before,
                attempted: true,
                guard_matched: true,
                lease_fresh_at_commit: true,
                candidate_remapped: false,
                method: WriteMethod::Direct,
                replacement_mode: "set_value".to_string(),
                readback_text: Some(request.text.clone()),
                clipboard_restored: None,
                focus_confirmed: true,
                select_all_applied: false,
                paste_applied: false,
                submit_count: 0,
            })
        }
    }

    fn native_test_dir(label: &str) -> PathBuf {
        let serial = NEXT_NATIVE_TEST.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "smart-prompt-native-route-{}-{}-{serial}-{label}",
            std::process::id(),
            unix_timestamp_millis()
        ));
        fs::create_dir_all(&dir).expect("create retained native route test directory");
        dir
    }

    fn native_production_benchmark(model_family_token: &str) -> Value {
        json!({
            "contractVersion": "benchmark-result@1",
            "benchmarkId": "benchmark_native_policy_incident",
            "status": "passed",
            "executor": "codex",
            "initiatedBy": "user",
            "authorization": { "required": true, "granted": true },
            "modelFamilyToken": model_family_token,
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
            "privacyFlags": outcome_privacy_flags()
        })
    }

    fn register_native_canary(runtime: &NativeRuntime, scope: &Value) -> Value {
        let baseline = ensure_baseline_generation_policy(runtime, scope)
            .expect("register native incident baseline");
        let version = baseline["version"].as_u64().unwrap() + 1;
        let candidate = learning_policy::compile_generation_policy(&json!({
            "policyId": baseline["policyId"],
            "version": version,
            "baselineVersion": baseline["version"],
            "scope": scope,
            "automaticRolloutEligible": true,
            "signals": {}
        }))
        .expect("compile native incident candidate");
        runtime
            .policies
            .register_policy(&candidate)
            .expect("register native incident candidate");
        runtime
            .policies
            .mark_benchmarked(
                candidate["policyId"].as_str().unwrap(),
                version,
                &native_production_benchmark(scope["modelFamilyToken"].as_str().unwrap()),
            )
            .expect("record server benchmark plan");
        runtime
            .policies
            .start_canary_from_benchmark(candidate["policyId"].as_str().unwrap(), version, 10_000)
            .expect("start native incident canary")
    }

    #[test]
    fn normalizes_gemini_custom_model_paths() {
        assert_eq!(
            gemini_model_path("gemini-2.5-flash"),
            "models/gemini-2.5-flash"
        );
        assert_eq!(
            gemini_model_path("models/gemini-custom"),
            "models/gemini-custom"
        );
    }

    #[test]
    fn validates_custom_model_ids() {
        assert_eq!(
            normalize_model_id(" vendor/custom-model:2026-07 ").unwrap(),
            "vendor/custom-model:2026-07"
        );
        assert_eq!(normalize_model_id("invalid model id"), Err("model_invalid"));
        assert_eq!(normalize_model_id(&"x".repeat(201)), Err("model_invalid"));
    }

    #[test]
    fn validates_custom_provider_metadata() {
        assert_eq!(
            normalize_custom_provider_name(" Team Gateway ").unwrap(),
            "Team Gateway"
        );
        assert_eq!(
            normalize_custom_provider_protocol("Anthropic").unwrap(),
            "anthropic"
        );
        assert_eq!(
            normalize_provider_base_url("http://127.0.0.1:17399/v1/").unwrap(),
            "http://127.0.0.1:17399/v1"
        );
        assert_eq!(
            normalize_provider_base_url("file:///tmp/provider"),
            Err("custom_provider_base_url_invalid")
        );
        assert_eq!(
            normalize_provider_base_url("https://user:secret@example.com/v1"),
            Err("custom_provider_base_url_invalid")
        );
    }

    #[test]
    fn distinguishes_model_errors_from_bare_route_404s() {
        assert_eq!(
            classify_provider_failure(404, r#"{"error":"model missing"}"#).code,
            "model_unavailable"
        );
        assert_eq!(
            classify_provider_failure(404, r#"{"error":"route not found"}"#).code,
            "provider_error"
        );
    }

    #[test]
    fn auto_provider_uses_shared_priority_and_provider_defaults() {
        let settings = json!({
            "provider": "auto",
            "baseUrl": "https://api.openai.com/v1",
            "model": "gpt-4o-mini",
            "providerKeys": {
                "agnes": "agnes-key",
                "openai-compatible": "openai-key",
                "anthropic": "anthropic-key",
                "gemini": "gemini-key"
            }
        });
        assert_eq!(selected_provider(&settings), "agnes");
        let effective = effective_provider_settings(&settings);
        assert_eq!(effective["provider"], "agnes");
        assert_eq!(effective["baseUrl"], "https://apihub.agnes-ai.com/v1");
        assert_eq!(effective["model"], "agnes-2.0-flash");

        let without_agnes = json!({
            "provider": "auto",
            "providerKeys": {
                "agnes": "",
                "openai-compatible": "openai-key",
                "anthropic": "anthropic-key",
                "gemini": "gemini-key"
            }
        });
        assert_eq!(selected_provider(&without_agnes), "anthropic");

        let only_custom = json!({
            "provider": "auto",
            "providerKeys": {
                "custom": "custom-key"
            }
        });
        assert_eq!(selected_provider(&only_custom), "openai-compatible");

        let custom = json!({
            "provider": "custom",
            "baseUrl": "http://127.0.0.1:17399/v1",
            "model": "private/model-v2",
            "customProvider": {
                "name": "Team Gateway",
                "protocol": "anthropic",
                "baseUrl": "http://127.0.0.1:17399/v1",
                "model": "private/model-v2"
            },
            "providerKeys": {
                "custom": "custom-key"
            }
        });
        assert_eq!(selected_provider(&custom), "custom");
        assert_eq!(effective_provider_settings(&custom)["provider"], "custom");
    }

    #[test]
    fn parses_clean_probe_json() {
        let value = parse_probe_json(
            br#"{"schemaVersion":"m3-windows-uia@1","pass":true,"privacy":{}}"#,
            "desktop input",
            "m3-windows-uia@1",
        )
        .expect("clean probe JSON should parse");

        assert_eq!(value["pass"], true);
    }

    #[test]
    fn parses_probe_json_after_warning_and_before_trailing_noise() {
        let value = parse_probe_json(
            b"[WARNING] Ignore caches that are heterogeneous\n{\"schemaVersion\":\"m3-windows-uia@1\",\"pass\":true,\"privacy\":{}}\ntrailing diagnostic",
            "desktop input",
            "m3-windows-uia@1",
        )
        .expect("probe JSON should be extracted from noisy stdout");

        assert_eq!(value["schemaVersion"], "m3-windows-uia@1");
    }

    #[test]
    fn rejects_unrelated_json_without_probe_schema() {
        let error = parse_probe_json(
            b"warning {\"message\":\"not a probe\"}",
            "desktop fill",
            "m3-windows-fill@1",
        )
        .expect_err("unrelated JSON must not be accepted");

        assert!(error.contains("Invalid desktop fill JSON"));
    }

    #[test]
    fn skips_unrelated_schema_before_real_probe_json() {
        let value = parse_probe_json(
            b"{\"schemaVersion\":\"other@1\",\"pass\":false,\"privacy\":{}}\n{\"schemaVersion\":\"m3-windows-uia@1\",\"pass\":true,\"privacy\":{}}",
            "desktop input",
            "m3-windows-uia@1",
        )
        .expect("the matching probe contract should be selected");

        assert_eq!(value["schemaVersion"], "m3-windows-uia@1");
        assert_eq!(value["pass"], true);
    }

    #[test]
    fn native_public_learning_observation_matches_non_exportable_node_projection() {
        let data_dir = native_test_dir("public-learning-observation");
        let runtime = NativeRuntime::with_runner(
            &data_dir,
            Box::new(NativeFakeRunner {
                draft: String::new(),
            }),
        )
        .expect("open native observation runtime");
        let project_scope_token = "project_public_observation";
        let input = observation_from_stored_feedback(
            &json!({
                "projectScopeToken": project_scope_token,
                "sessionId": "session_public_observation",
                "outcomeId": "outcome_public_observation",
                "strategyId": "baseline",
                "strategyVersion": "v1",
                "modelFamilyToken": "model_public_observation",
                "status": "succeeded",
                "failureReasonTokens": []
            }),
            None,
            &[],
            None,
        );
        let stored = runtime
            .learning
            .record_observation(&input)
            .expect("persist private learning observation")
            .observation;
        let private_token = stored["semanticFingerprint"]["valueToken"]
            .as_str()
            .expect("private keyed HMAC remains available internally")
            .to_string();
        assert_eq!(stored["semanticFingerprint"]["algorithm"], "hmac_sha256");

        let response = route_outcome_learning(
            &Method::Get,
            "/learning/v1/observations",
            &format!("/learning/v1/observations?projectScopeToken={project_scope_token}"),
            &json!({}),
            &data_dir,
            &runtime,
        )
        .expect("native route")
        .expect("native observation response");
        assert_eq!(response.0, 200, "{}", response.1);
        let observations = response.1["observations"].as_array().unwrap();
        assert_eq!(observations.len(), 1);
        let public = &observations[0];
        let fingerprint = public["semanticFingerprint"].as_object().unwrap();
        assert_eq!(public["projectScopeToken"], project_scope_token);
        assert_eq!(fingerprint["kind"], "keyed_feature_hash");
        assert_eq!(fingerprint["projectScoped"], true);
        assert_eq!(fingerprint["exportable"], false);
        assert!(!fingerprint.contains_key("valueToken"));
        assert!(!fingerprint.contains_key("algorithm"));
        assert!(!serde_json::to_string(&response.1)
            .expect("serialize public response")
            .contains(&private_token));

        let private = runtime
            .learning
            .list_observations(Some(project_scope_token))
            .expect("read private observation after projection");
        assert_eq!(
            private[0]["semanticFingerprint"]["valueToken"],
            private_token
        );
        assert_eq!(
            private[0]["semanticFingerprint"]["algorithm"],
            "hmac_sha256"
        );
    }

    #[test]
    fn native_routes_bind_insert_activation_outcome_learning_and_project_clear() {
        let data_dir = native_test_dir("outcome-loop");
        let runtime = NativeRuntime::with_runner(
            &data_dir,
            Box::new(NativeFakeRunner {
                draft: "opening draft".to_string(),
            }),
        )
        .expect("create native runtime");

        activation_v2::initialize(&data_dir, None).expect("initialize activation");
        activation_v2::set_progress(&data_dir, "configuring", &json!({ "provider": "test" }))
            .expect("configure activation");
        activation_v2::record_model_ready_at(&data_dir, "test", "2026-07-19T00:00:00.000Z")
            .expect("record model connectivity");
        activation_v2::mark_codex_loop_started(&data_dir).expect("start Codex loop");

        let (status, inspected) = target_inspect_route(&runtime, &json!({}));
        assert_eq!(status, 200);
        assert_eq!(inspected["result"]["status"], "ready");
        let lease = inspected["lease"].clone();
        let lease_id = lease["leaseId"].as_str().unwrap().to_string();
        let project = lease["projectScopeToken"].as_str().unwrap().to_string();
        let opening_hash = lease["draftHash"].as_str().unwrap().to_string();
        let generation_id = "generation-native-route";
        let generation_binding = GenerationBinding {
            generation_id: generation_id.to_string(),
            session_id: "session-native-route".to_string(),
            project_scope_token: project.clone(),
            strategy_id: "baseline".to_string(),
            strategy_version: "v1".to_string(),
            model_family_token: "model-native-route".to_string(),
            task_scenario_token: "bug_fix".to_string(),
            mode_token: "standard".to_string(),
            policy_id: Some("policy-native-route".to_string()),
            policy_version: Some(1),
            learning_candidate_seed: None,
            generated_prompt: "generated coding task".to_string(),
            edit_feature_summary: None,
            expires_at_ms: unix_timestamp_millis() + GENERATION_BINDING_TTL_MS,
        };
        {
            let mut target = runtime.target.lock().unwrap();
            target
                .state
                .generation_bindings
                .insert(generation_id.to_string(), generation_binding.clone());
        }
        record_prompt_history(
            &data_dir,
            "standard",
            "native-sidecar",
            Some(&generation_binding),
        )
        .expect("record trusted generation history");
        let (status, inserted) = target_insert_route(
            &data_dir,
            &runtime,
            &json!({
                "leaseId": lease_id,
                "text": "generated coding task",
                "expectedDraftHash": opening_hash,
                "generationId": generation_id,
                "allowClipboardFallback": false
            }),
        );
        assert_eq!(status, 200, "{inserted}");
        assert_eq!(inserted["result"]["verified"], true);
        assert_eq!(inserted["result"]["noAutoSubmit"], true);
        assert_eq!(inserted["pendingOutcome"]["status"], "unknown");
        assert_eq!(
            inserted["pendingOutcome"]["policyId"],
            "policy-native-route"
        );
        assert_eq!(inserted["pendingOutcome"]["policyVersion"], 1);
        let prompt_history =
            read_array(&data_dir, "prompt-history.json").expect("read trusted generation history");
        let trusted_history = prompt_history
            .iter()
            .find(|entry| entry["generationId"] == generation_id)
            .expect("trusted generation history entry");
        assert_eq!(trusted_history["verifiedInsertEvidence"], true);
        assert_eq!(
            trusted_history["editFeatureSummary"],
            json!({
                "userEdited": false,
                "lengthDeltaBucket": "none",
                "structureChanged": false
            })
        );
        let transaction_id = inserted["transaction"]["transactionId"]
            .as_str()
            .unwrap()
            .to_string();
        let undo_token = inserted["undoToken"].as_str().unwrap().to_string();

        let (status, rejected) = complete_codex_activation_from_transaction(
            &data_dir,
            &runtime,
            &json!({
                "contractVersion": activation_v2::SCHEMA_VERSION,
                "transactionId": transaction_id,
                "verified": true
            }),
        )
        .unwrap();
        assert_eq!(status, 400);
        assert_eq!(
            rejected["error"]["code"],
            "activation_self_reported_evidence_rejected"
        );
        let (status, activated) = complete_codex_activation_from_transaction(
            &data_dir,
            &runtime,
            &json!({
                "contractVersion": activation_v2::SCHEMA_VERSION,
                "transactionId": transaction_id
            }),
        )
        .unwrap();
        assert_eq!(status, 200, "{activated}");
        assert_eq!(activated["activation"]["codexVerified"], true);
        assert_eq!(activated["claim"]["insertVerified"], true);

        let (status, undone) = target_undo_route(
            &data_dir,
            &runtime,
            &json!({ "undoToken": undo_token, "allowClipboardFallback": false }),
        );
        assert_eq!(status, 200, "{undone}");
        assert_eq!(undone["result"]["status"], "ready");
        assert_eq!(
            pending_outcomes::list_implicit_signals(
                &data_dir,
                &json!({ "projectScopeToken": project })
            )
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
            1
        );

        let occurred_at = (chrono::Utc::now() - chrono::Duration::minutes(2))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let outcome_id = "outcome-feedback-native";
        let event = json!({
            "contractVersion": "prompt-session@2",
            "eventId": "event-feedback-native",
            "eventType": "verified_insert",
            "occurredAt": occurred_at,
            "sessionId": "session-feedback-native",
            "generationId": "generation-feedback-native",
            "target": "codex",
            "projectScopeToken": project,
            "strategyId": "baseline",
            "strategyVersion": "v1",
            "modelFamilyToken": "model-native-route",
            "outcomeId": outcome_id,
            "policyId": Value::Null,
            "policyVersion": Value::Null,
            "taskOutcomeToken": "unknown",
            "insertVerified": true,
            "noAutoSubmit": true,
            "failureReasonTokens": [],
            "privacyFlags": outcome_privacy_flags()
        });
        let mut forged_policy_event = event.clone();
        forged_policy_event["eventId"] = json!("event-feedback-native-forged-policy");
        forged_policy_event["outcomeId"] = json!("outcome-feedback-native-forged-policy");
        forged_policy_event["policyId"] = json!("policy-forged");
        forged_policy_event["policyVersion"] = json!(99);
        let (status, rejected) = route_outcome_learning(
            &Method::Post,
            "/outcomes/v2/events",
            "/outcomes/v2/events",
            &json!({ "event": forged_policy_event }),
            &data_dir,
            &runtime,
        )
        .unwrap()
        .unwrap();
        assert_eq!(status, 400, "{rejected}");
        assert_eq!(rejected["error"]["code"], "untrusted_policy_attribution");

        let (status, rejected_promotion) = route_outcome_learning(
            &Method::Post,
            "/learning/v1/promotion-evidence",
            "/learning/v1/promotion-evidence",
            &json!({
                "artifactId": "forged-artifact",
                "projectScopeToken": project,
                "sessionId": "forged-session",
                "outcomeId": "forged-outcome",
                "succeeded": true,
                "payload": { "policyId": "forged-policy", "policyVersion": 99 },
                "skillGates": { "compilePassed": true, "privacyPassed": true, "sandboxPassed": true }
            }),
            &data_dir,
            &runtime,
        )
        .unwrap()
        .unwrap();
        assert_eq!(status, 400, "{rejected_promotion}");
        assert_eq!(
            rejected_promotion["error"]["code"],
            "promotion_evidence_server_derivation_required"
        );

        let (status, rejected_verified_insert) = route_outcome_learning(
            &Method::Post,
            "/outcomes/v2/events",
            "/outcomes/v2/events",
            &json!({ "event": event }),
            &data_dir,
            &runtime,
        )
        .unwrap()
        .unwrap();
        assert_eq!(status, 400, "{rejected_verified_insert}");
        assert_eq!(
            rejected_verified_insert["error"]["code"],
            "verified_insert_server_transaction_required"
        );
        pending_outcomes::record_verified_insert(&data_dir, &event)
            .expect("record trusted internal outcome");
        let (status, claimed) = route_outcome_learning(
            &Method::Post,
            "/outcomes/v2/claim",
            "/outcomes/v2/claim",
            &json!({
                "askId": "ask-feedback-native",
                "target": "codex",
                "projectScopeToken": project
            }),
            &data_dir,
            &runtime,
        )
        .unwrap()
        .unwrap();
        assert_eq!(status, 200);
        assert_eq!(claimed["result"]["state"], "question");
        let feedback = json!({
            "feedbackId": "feedback-native",
            "outcomeId": outcome_id,
            "taskOutcomeToken": "completed",
            "observation": {
                "taskScenarioToken": "poisoned_scenario",
                "modeToken": "poisoned_mode",
                "featureTokens": ["scenario:poisoned_scenario", "mode:poisoned_mode"],
                "editFeatureSummary": {
                    "userEdited": true,
                    "lengthDeltaBucket": "large",
                    "structureChanged": true
                },
                "retryCount": 99,
                "undoUsed": true,
                "latencyMs": 250,
                "tokenAccountingSource": "provider",
                "inputTokens": 1,
                "outputTokens": 1,
                "candidate": {
                    "artifactType": "generation_policy",
                    "payload": { "policyId": "policy-forged", "policyVersion": 99 }
                }
            }
        });
        let (status, resolved) = submit_outcome_feedback_route(&data_dir, &runtime, &feedback);
        assert_eq!(status, 200, "{resolved}");
        assert_eq!(resolved["result"]["outcome"]["status"], "succeeded");
        assert!(!resolved["learning"].is_null());
        let observation = &resolved["learning"]["observation"];
        assert_eq!(observation["taskScenarioToken"], "unknown_scenario");
        assert_eq!(observation["modeToken"], "standard");
        assert_eq!(observation["retryCount"], 0);
        assert_eq!(observation["undoUsed"], false);
        assert_eq!(observation["latencyMs"], 0);
        assert_eq!(observation["tokenAccountingSource"], "unavailable");
        assert!(observation["inputTokens"].is_null());
        assert!(observation["outputTokens"].is_null());
        assert_eq!(
            observation["editFeatureSummary"],
            json!({
                "userEdited": false,
                "lengthDeltaBucket": "none",
                "structureChanged": false
            })
        );
        assert!(resolved["learning"]["candidate"].is_null());

        let mut internal_policy_event = event.clone();
        internal_policy_event["eventId"] = json!("event-feedback-native-internal-policy");
        internal_policy_event["outcomeId"] = json!("outcome-feedback-native-internal-policy");
        internal_policy_event["policyId"] = json!("policy-internal");
        internal_policy_event["policyVersion"] = json!(2);
        pending_outcomes::record_verified_insert(&data_dir, &internal_policy_event)
            .expect("record trusted internal policy outcome");
        let mut forged_policy_signal = internal_policy_event.clone();
        forged_policy_signal["eventId"] = json!("event-feedback-native-forged-policy-signal");
        forged_policy_signal["eventType"] = json!("retry");
        forged_policy_signal["insertVerified"] = json!(false);
        forged_policy_signal["policyId"] = Value::Null;
        forged_policy_signal["policyVersion"] = Value::Null;
        let (status, rejected_signal) = route_outcome_learning(
            &Method::Post,
            "/outcomes/v2/events",
            "/outcomes/v2/events",
            &json!({ "event": forged_policy_signal }),
            &data_dir,
            &runtime,
        )
        .unwrap()
        .unwrap();
        assert_eq!(status, 400, "{rejected_signal}");
        assert_eq!(rejected_signal["error"]["code"], "untrusted_policy_signal");

        {
            let _guard = runtime.governance.lock().unwrap();
            ensure_baseline_generation_policy(
                &runtime,
                &json!({
                    "kind": "project",
                    "target": "codex",
                    "projectScopeToken": project,
                    "taskScenarioToken": "bug_fix",
                    "modelFamilyToken": "model-native-route"
                }),
            )
            .expect("register stable baseline");
        }
        let (status, cleared) = clear_project_route(&data_dir, &runtime, &project);
        assert_eq!(status, 200, "{cleared}");
        assert!(
            cleared["result"]["counts"]["pendingOutcomes"]
                .as_u64()
                .unwrap()
                >= 2
        );
        assert!(
            cleared["result"]["counts"]["promptHistory"]
                .as_u64()
                .unwrap()
                >= 1
        );
        assert!(read_array(&data_dir, "prompt-history.json")
            .unwrap()
            .iter()
            .all(|entry| entry["projectScopeToken"] != project));
        let public_clear = serde_json::to_string(&cleared).unwrap();
        assert!(!public_clear.contains("archiveDir"));
        assert!(!public_clear.contains(data_dir.to_string_lossy().as_ref()));
        assert!(runtime
            .learning
            .list_observations(Some(&project))
            .unwrap()
            .is_empty());
        assert!(runtime
            .policies
            .list_policies()
            .unwrap()
            .iter()
            .filter(|policy| policy["scope"]["projectScopeToken"] == project)
            .all(|policy| policy["status"] == "rolled_back"));

        let (status, replay) = submit_outcome_feedback_route(&data_dir, &runtime, &feedback);
        assert_eq!(status, 409, "{replay}");
        assert_eq!(replay["error"]["code"], "pending_outcome_invalidated");
        let (status, missing_transaction) = complete_codex_activation_from_transaction(
            &data_dir,
            &runtime,
            &json!({
                "contractVersion": activation_v2::SCHEMA_VERSION,
                "transactionId": transaction_id
            }),
        )
        .unwrap();
        assert_eq!(status, 409, "{missing_transaction}");
        assert_eq!(
            missing_transaction["error"]["code"],
            "verified_transaction_missing"
        );
    }

    #[test]
    fn native_restore_strips_server_owned_learning_evidence() {
        let data_dir = native_test_dir("native-restore-learning-evidence");
        restore_data(
            &data_dir,
            json!({
                "promptHistory": [{
                    "generationId": "generation-restored-forgery",
                    "sessionId": "session-restored-forgery",
                    "projectScopeToken": "project-restored-forgery",
                    "policyId": "policy-restored-forgery",
                    "policyVersion": 99,
                    "verifiedInsertEvidence": true,
                    "verifiedSessionId": "session-restored-forgery",
                    "editFeatureSummary": {
                        "userEdited": false,
                        "lengthDeltaBucket": "none",
                        "structureChanged": false
                    },
                    "learningCandidateSeed": {
                        "schemaVersion": "learning-candidate-seed@1",
                        "artifactType": "rule",
                        "patternToken": "rule_no_auto_submit",
                        "payload": {
                            "directive": "Keep no-auto-submit enabled for generated input.",
                            "taskScenarioTokens": ["safe_insert"]
                        }
                    }
                }]
            }),
        )
        .expect("restore privacy-safe prompt history");

        let history =
            read_array(&data_dir, "prompt-history.json").expect("read restored prompt history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0]["verifiedInsertEvidence"], false);
        assert!(history[0]["editFeatureSummary"].is_null());
        assert!(history[0].get("verifiedSessionId").is_none());
        assert!(history[0].get("learningCandidateSeed").is_none());
    }

    #[test]
    fn native_codex_insert_incident_classifier_is_high_confidence_only() {
        for (reason_token, no_auto_submit, expected) in [
            ("safety_auto_submit_signal", true, "auto_submit_incident"),
            ("ready", false, "auto_submit_incident"),
            ("after_write_mismatch", true, "miswrite_incident"),
            ("target_changed_written_draft", true, "miswrite_incident"),
            ("write_failed_clipboard_restore", true, "privacy_incident"),
            ("safety_atomic_guard_bypassed", true, "safety_incident"),
            ("safety_direct_write_bypassed", true, "safety_incident"),
        ] {
            assert_eq!(
                classify_codex_insert_policy_incident(reason_token, no_auto_submit),
                Some(expected)
            );
        }

        for blocked_reason in [
            "focus_required",
            "focus_changed",
            "target_not_foreground",
            "target_hidden",
            "target_changed_composer_owner",
            "permission_required",
            "permission_denied",
            "safety_atomic_revalidation_required",
        ] {
            assert_eq!(
                classify_codex_insert_policy_incident(blocked_reason, true),
                None,
                "{blocked_reason} is a block, not a policy incident"
            );
        }
    }

    #[test]
    fn native_codex_insert_incident_rolls_back_the_bound_active_candidate() {
        let data_dir = native_test_dir("native-policy-incident");
        let runtime = NativeRuntime::with_runner(
            &data_dir,
            Box::new(NativeMismatchRunner {
                draft: "opening draft".to_string(),
            }),
        )
        .expect("open native incident runtime");

        let (status, inspected) = target_inspect_route(&runtime, &json!({}));
        assert_eq!(status, 200, "{inspected}");
        let lease_id = inspected["lease"]["leaseId"].as_str().unwrap().to_string();
        let project_scope_token = inspected["lease"]["projectScopeToken"]
            .as_str()
            .unwrap()
            .to_string();
        let expected_draft_hash = inspected["lease"]["draftHash"]
            .as_str()
            .unwrap()
            .to_string();
        let scope = json!({
            "kind": "project",
            "target": "codex",
            "projectScopeToken": project_scope_token,
            "taskScenarioToken": "bug_fix",
            "modelFamilyToken": "model_native_policy_incident"
        });
        let candidate = register_native_canary(&runtime, &scope);
        assert_eq!(candidate["status"], "canary");
        let generation_id = "generation-native-policy-incident";
        runtime
            .target
            .lock()
            .unwrap()
            .state
            .generation_bindings
            .insert(
                generation_id.to_string(),
                GenerationBinding {
                    generation_id: generation_id.to_string(),
                    session_id: "session-native-policy-incident".to_string(),
                    project_scope_token: scope["projectScopeToken"].as_str().unwrap().to_string(),
                    strategy_id: "candidate-policy".to_string(),
                    strategy_version: "v2".to_string(),
                    model_family_token: scope["modelFamilyToken"].as_str().unwrap().to_string(),
                    task_scenario_token: scope["taskScenarioToken"].as_str().unwrap().to_string(),
                    mode_token: "standard".to_string(),
                    policy_id: candidate["policyId"].as_str().map(str::to_string),
                    policy_version: candidate["version"].as_u64(),
                    learning_candidate_seed: None,
                    generated_prompt: "generated policy incident".to_string(),
                    edit_feature_summary: None,
                    expires_at_ms: unix_timestamp_millis() + GENERATION_BINDING_TTL_MS,
                },
            );

        let (status, inserted) = target_insert_route(
            &data_dir,
            &runtime,
            &json!({
                "leaseId": lease_id,
                "text": "candidate generated prompt",
                "expectedDraftHash": expected_draft_hash,
                "generationId": generation_id,
                "requestId": "insert-native-policy-incident",
                "allowClipboardFallback": false
            }),
        );
        assert_eq!(status, 200, "{inserted}");
        assert_eq!(inserted["result"]["reasonToken"], "after_write_mismatch");
        assert_eq!(inserted["pendingOutcome"], Value::Null);
        assert_eq!(inserted["policyEvaluation"]["action"], "rollback");
        assert_eq!(
            inserted["policyEvaluation"]["reasonToken"],
            "miswrite_incident"
        );
        assert_eq!(inserted["policyEvaluation"]["policyStatus"], "rolled_back");

        let policy = runtime
            .policies
            .get_policy(
                candidate["policyId"].as_str().unwrap(),
                candidate["version"].as_u64().unwrap(),
            )
            .expect("read incident policy")
            .expect("incident policy exists");
        assert_eq!(policy["status"], "rolled_back");
        let rollout = runtime
            .policies
            .list_rollouts()
            .expect("list incident rollout")
            .into_iter()
            .find(|rollout| {
                rollout["policyId"] == candidate["policyId"]
                    && rollout["policyVersion"] == candidate["version"]
            })
            .expect("incident rollout exists");
        assert_eq!(rollout["status"], "rolled_back");
        assert_eq!(rollout["gates"]["miswriteIncidentCount"], 1);

        let restarted = GenerationPolicyRegistry::open(data_dir.join("outcome-learning-v1"))
            .expect("reopen incident policy registry");
        assert_eq!(
            restarted
                .get_policy(
                    candidate["policyId"].as_str().unwrap(),
                    candidate["version"].as_u64().unwrap(),
                )
                .expect("read persisted incident policy")
                .expect("persisted incident policy exists")["status"],
            "rolled_back"
        );
    }

    #[test]
    fn native_canary_route_rejects_client_reported_rollout_evidence() {
        let data_dir = native_test_dir("native-canary-contract");
        let runtime = NativeRuntime::with_runner(
            &data_dir,
            Box::new(NativeFakeRunner {
                draft: String::new(),
            }),
        )
        .expect("open native runtime");

        for forbidden in [
            json!({
                "policyId": "policy-native",
                "version": 2,
                "rollout": { "gates": { "benchmarkPassed": true } }
            }),
            json!({
                "policyId": "policy-native",
                "version": 2,
                "gates": { "benchmarkPassed": true }
            }),
        ] {
            let response = route_outcome_learning(
                &Method::Post,
                "/policies/v1/canary",
                "/policies/v1/canary",
                &forbidden,
                &data_dir,
                &runtime,
            )
            .expect("native route")
            .expect("route response");
            assert_eq!(response.0, 400, "{}", response.1);
            assert_eq!(
                response.1["error"]["code"],
                "unexpected_policy_canary_field"
            );
        }

        for invalid in [
            json!({
                "policyId": "policy-native",
                "canaryShareBps": 1_000
            }),
            json!({
                "policyId": "policy-native",
                "version": 0,
                "canaryShareBps": 1_000
            }),
        ] {
            let response = route_outcome_learning(
                &Method::Post,
                "/policies/v1/canary",
                "/policies/v1/canary",
                &invalid,
                &data_dir,
                &runtime,
            )
            .expect("native route")
            .expect("route response");
            assert_eq!(response.0, 400, "{}", response.1);
            assert_eq!(response.1["error"]["code"], "invalid_policy_canary_request");
        }

        let invalid_share = route_outcome_learning(
            &Method::Post,
            "/policies/v1/canary",
            "/policies/v1/canary",
            &json!({
                "policyId": "policy-native",
                "version": 2,
                "canaryShareBps": "1000"
            }),
            &data_dir,
            &runtime,
        )
        .expect("native route")
        .expect("route response");
        assert_eq!(invalid_share.0, 400, "{}", invalid_share.1);
        assert_eq!(
            invalid_share.1["error"]["code"],
            "invalid_policy_canary_share"
        );

        let accepted_shape = route_outcome_learning(
            &Method::Post,
            "/policies/v1/canary",
            "/policies/v1/canary",
            &json!({
                "policyId": "policy-native",
                "version": 2,
                "canaryShareBps": 1_000
            }),
            &data_dir,
            &runtime,
        )
        .expect("native route")
        .expect("route response");
        assert_eq!(accepted_shape.0, 404, "{}", accepted_shape.1);
        assert_eq!(
            accepted_shape.1["error"]["code"],
            "generation_policy_not_found"
        );
    }

    #[test]
    fn native_policy_evaluation_accepts_only_rollout_identity_and_stored_evidence() {
        let data_dir = native_test_dir("native-policy-evaluate-contract");
        let runtime = NativeRuntime::with_runner(
            &data_dir,
            Box::new(NativeFakeRunner {
                draft: String::new(),
            }),
        )
        .expect("open native runtime");
        let scope = json!({
            "kind": "project",
            "target": "codex",
            "projectScopeToken": "project_native_policy_evaluate",
            "taskScenarioToken": "bug_fix",
            "modelFamilyToken": "model_native_policy_evaluate"
        });
        let candidate = register_native_canary(&runtime, &scope);
        let rollout = runtime
            .policies
            .list_rollouts()
            .expect("list native evaluation rollouts")
            .into_iter()
            .find(|rollout| {
                rollout["policyId"] == candidate["policyId"]
                    && rollout["policyVersion"] == candidate["version"]
            })
            .expect("native evaluation rollout");
        let rollout_id = rollout["rolloutId"].as_str().unwrap();

        for forbidden in [
            json!({ "rolloutId": rollout_id, "confidence": 1.0 }),
            json!({
                "rolloutId": rollout_id,
                "arms": {
                    "baseline": { "attributableOutcomes": 10 },
                    "candidate": { "attributableOutcomes": 10 }
                }
            }),
            json!({ "rolloutId": rollout_id, "rollout": rollout }),
        ] {
            let response = route_outcome_learning(
                &Method::Post,
                "/policies/v1/evaluate",
                "/policies/v1/evaluate",
                &forbidden,
                &data_dir,
                &runtime,
            )
            .expect("native route")
            .expect("route response");
            assert_eq!(response.0, 400, "{}", response.1);
            assert_eq!(
                response.1["error"]["code"],
                "unexpected_policy_evaluate_field"
            );
        }

        let evaluated = route_outcome_learning(
            &Method::Post,
            "/policies/v1/evaluate",
            "/policies/v1/evaluate",
            &json!({ "rolloutId": rollout_id }),
            &data_dir,
            &runtime,
        )
        .expect("native route")
        .expect("route response");
        assert_eq!(evaluated.0, 200, "{}", evaluated.1);
        assert_eq!(evaluated.1["evaluation"]["action"], "continue_canary");
        assert_eq!(evaluated.1["confidence"]["confidence"], 0.0);
        assert_eq!(evaluated.1["confidence"]["enoughSamples"], false);
    }

    #[test]
    fn native_resolved_outcomes_auto_promote_from_persisted_evidence() {
        let data_dir = native_test_dir("native-policy-auto-promotion");
        let runtime = NativeRuntime::with_runner(
            &data_dir,
            Box::new(NativeFakeRunner {
                draft: String::new(),
            }),
        )
        .expect("open native runtime");
        let scope = json!({
            "kind": "project",
            "target": "codex",
            "projectScopeToken": "project_native_auto_promotion",
            "taskScenarioToken": "bug_fix",
            "modelFamilyToken": "model_native_auto_promotion"
        });
        let candidate = register_native_canary(&runtime, &scope);
        let baseline_version = candidate["baselineVersion"].as_u64().unwrap();
        let candidate_version = candidate["version"].as_u64().unwrap();
        let occurred_at = (chrono::Utc::now() - chrono::Duration::minutes(2))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let mut final_response = Value::Null;

        for index in 0..20 {
            let policy_version = if index < 10 {
                baseline_version
            } else {
                candidate_version
            };
            let outcome_id = format!("outcome_native_auto_promotion_{index}");
            let event = json!({
                "contractVersion": "prompt-session@2",
                "eventId": format!("event_native_auto_promotion_{index}"),
                "eventType": "verified_insert",
                "occurredAt": occurred_at,
                "sessionId": format!("session_native_auto_promotion_{index}"),
                "generationId": format!("generation_native_auto_promotion_{index}"),
                "target": "codex",
                "projectScopeToken": scope["projectScopeToken"],
                "strategyId": if index < 10 { "baseline" } else { "candidate" },
                "strategyVersion": if index < 10 { "v1" } else { "v2" },
                "modelFamilyToken": scope["modelFamilyToken"],
                "outcomeId": outcome_id,
                "policyId": candidate["policyId"],
                "policyVersion": policy_version,
                "taskOutcomeToken": "unknown",
                "insertVerified": true,
                "noAutoSubmit": true,
                "failureReasonTokens": [],
                "privacyFlags": outcome_privacy_flags()
            });
            let binding = GenerationBinding {
                generation_id: event["generationId"].as_str().unwrap().to_string(),
                session_id: event["sessionId"].as_str().unwrap().to_string(),
                project_scope_token: scope["projectScopeToken"].as_str().unwrap().to_string(),
                strategy_id: event["strategyId"].as_str().unwrap().to_string(),
                strategy_version: event["strategyVersion"].as_str().unwrap().to_string(),
                model_family_token: scope["modelFamilyToken"].as_str().unwrap().to_string(),
                task_scenario_token: scope["taskScenarioToken"].as_str().unwrap().to_string(),
                mode_token: "continue".to_string(),
                policy_id: candidate["policyId"].as_str().map(str::to_string),
                policy_version: Some(policy_version),
                learning_candidate_seed: None,
                generated_prompt: "generated native policy fixture".to_string(),
                edit_feature_summary: None,
                expires_at_ms: unix_timestamp_millis() + GENERATION_BINDING_TTL_MS,
            };
            let edit_feature_summary = json!({
                "userEdited": index == 10,
                "lengthDeltaBucket": if index == 10 { "large" } else { "none" },
                "structureChanged": index == 10
            });
            record_prompt_history(&data_dir, "continue", "native-fixture", Some(&binding))
                .expect("record native rollout generation history");
            record_verified_generation_edit_summary(&data_dir, &binding, &edit_feature_summary)
                .expect("record native rollout verified edit summary");
            pending_outcomes::record_verified_insert(&data_dir, &event)
                .expect("record native rollout outcome");
            if index < 10 {
                let mut retry_event = event.clone();
                retry_event["eventId"] = json!(format!("retry_native_auto_promotion_{index}"));
                retry_event["eventType"] = json!("retry");
                retry_event["insertVerified"] = json!(false);
                pending_outcomes::record_implicit_signal(&data_dir, &retry_event)
                    .expect("record trusted native retry signal");
            }
            let claimed = pending_outcomes::claim_next_feedback(
                &data_dir,
                &json!({
                    "askId": format!("ask_native_auto_promotion_{index}"),
                    "target": "codex",
                    "projectScopeToken": scope["projectScopeToken"]
                }),
            )
            .expect("claim native rollout outcome");
            assert_eq!(claimed["state"], "question", "{claimed}");
            let (status, response) = submit_outcome_feedback_route(
                &data_dir,
                &runtime,
                &json!({
                    "feedbackId": format!("feedback_native_auto_promotion_{index}"),
                    "outcomeId": outcome_id,
                    "taskOutcomeToken": "completed"
                }),
            );
            assert_eq!(status, 200, "{response}");
            final_response = response;
        }

        assert_eq!(final_response["policyEvaluation"]["action"], "promote");
        assert_eq!(
            final_response["policyEvaluation"]["reasonToken"],
            "promotion_gates_passed"
        );
        assert_eq!(final_response["policyEvaluation"]["confidence"], 1.0);
        assert_eq!(final_response["policyEvaluation"]["enoughSamples"], true);
        assert_eq!(
            runtime
                .policies
                .get_policy(candidate["policyId"].as_str().unwrap(), candidate_version,)
                .expect("read promoted native policy")
                .expect("promoted native policy exists")["status"],
            "stable"
        );
        let promoted = runtime
            .policies
            .list_rollouts()
            .expect("list promoted native rollout")
            .into_iter()
            .find(|rollout| {
                rollout["policyId"] == candidate["policyId"]
                    && rollout["policyVersion"] == candidate["version"]
            })
            .expect("promoted native rollout");
        assert_eq!(promoted["arms"]["baseline"]["averageReworkCount"], 1.0);
        assert_eq!(promoted["arms"]["candidate"]["averageReworkCount"], 0.1);
    }

    #[test]
    fn native_public_benchmark_evidence_is_rejected() {
        let data_dir = native_test_dir("native-policy-benchmark-route");
        let runtime = NativeRuntime::with_runner(
            &data_dir,
            Box::new(NativeFakeRunner {
                draft: String::new(),
            }),
        )
        .expect("open native runtime");
        let scope = json!({
            "kind": "project",
            "target": "codex",
            "projectScopeToken": "project_native_benchmark_route",
            "taskScenarioToken": "bug_fix",
            "modelFamilyToken": "model_native_benchmark_route"
        });
        let baseline = ensure_baseline_generation_policy(&runtime, &scope)
            .expect("register native benchmark baseline");
        let candidate = learning_policy::compile_generation_policy(&json!({
            "policyId": baseline["policyId"],
            "version": baseline["version"].as_u64().unwrap() + 1,
            "baselineVersion": baseline["version"],
            "scope": scope,
            "automaticRolloutEligible": true,
            "signals": {}
        }))
        .expect("compile native benchmark candidate");
        runtime
            .policies
            .register_policy(&candidate)
            .expect("register native benchmark candidate");

        let response = route_outcome_learning(
            &Method::Post,
            "/policies/v1/benchmarked",
            "/policies/v1/benchmarked",
            &json!({
                "policyId": candidate["policyId"],
                "version": candidate["version"],
                "benchmarkResult": native_production_benchmark(
                    scope["modelFamilyToken"].as_str().unwrap()
                )
            }),
            &data_dir,
            &runtime,
        )
        .expect("native route")
        .expect("native benchmark response");
        assert_eq!(response.0, 400, "{}", response.1);
        assert_eq!(
            response.1["error"]["code"],
            "policy_benchmark_server_evidence_required"
        );
        assert_eq!(
            runtime
                .policies
                .get_policy(
                    candidate["policyId"].as_str().unwrap(),
                    candidate["version"].as_u64().unwrap(),
                )
                .expect("read benchmark candidate")
                .expect("benchmark candidate exists")["status"],
            "draft"
        );
    }

    #[test]
    fn native_versioned_rollback_rejects_unbound_or_extra_fields() {
        let data_dir = native_test_dir("native-rollback-contract");
        let runtime = NativeRuntime::with_runner(
            &data_dir,
            Box::new(NativeFakeRunner {
                draft: String::new(),
            }),
        )
        .expect("open native runtime");

        let unbound = route_outcome_learning(
            &Method::Post,
            "/policies/v1/rollback",
            "/policies/v1/rollback",
            &json!({ "policyId": "policy-native", "reason": "manual" }),
            &data_dir,
            &runtime,
        )
        .expect("native route")
        .expect("route response");
        assert_eq!(unbound.0, 400, "{}", unbound.1);
        assert_eq!(
            unbound.1["error"]["code"],
            "invalid_policy_rollback_request"
        );

        let extra_field = route_outcome_learning(
            &Method::Post,
            "/policies/v1/rollback",
            "/policies/v1/rollback",
            &json!({
                "policyId": "policy-native",
                "version": 2,
                "reason": "manual",
                "assetId": "asset-specific-pause-is-not-supported"
            }),
            &data_dir,
            &runtime,
        )
        .expect("native route")
        .expect("route response");
        assert_eq!(extra_field.0, 400, "{}", extra_field.1);
        assert_eq!(
            extra_field.1["error"]["code"],
            "unexpected_policy_rollback_field"
        );

        let accepted_shape = route_outcome_learning(
            &Method::Post,
            "/policies/v1/rollback",
            "/policies/v1/rollback",
            &json!({
                "policyId": "policy-native",
                "version": 2,
                "reason": "manual"
            }),
            &data_dir,
            &runtime,
        )
        .expect("native route")
        .expect("route response");
        assert_eq!(accepted_shape.0, 404, "{}", accepted_shape.1);
        assert_eq!(
            accepted_shape.1["error"]["code"],
            "generation_policy_not_found"
        );
    }

    #[test]
    fn native_verified_feedback_derives_semantic_candidates_from_canonical_seeds() {
        let outcome = json!({
            "projectScopeToken": "project-native-semantic-seed",
            "sessionId": "session-native-semantic-seed",
            "outcomeId": "outcome-native-semantic-seed",
            "status": "succeeded",
            "failureReasonTokens": []
        });
        let baseline = json!({
            "policyId": "policy-native-semantic-seed",
            "version": 1
        });
        for (input, scenario, expected_type, expected_pattern) in [
            (
                "This project uses Tauri for its desktop shell.",
                "feature_development",
                "memory",
                "memory_tauri",
            ),
            (
                "Preserve existing changes while implementing the request.",
                "feature_development",
                "rule",
                "rule_preserve_existing_changes",
            ),
            (
                "Create a reusable workflow for recurring bug fixes.",
                "bug_fix",
                "skill",
                "skill_bug_fix",
            ),
        ] {
            let binding = GenerationBinding {
                generation_id: format!("generation-{expected_pattern}"),
                session_id: "session-native-semantic-seed".to_string(),
                project_scope_token: "project-native-semantic-seed".to_string(),
                strategy_id: "baseline".to_string(),
                strategy_version: "v1".to_string(),
                model_family_token: "model-native-semantic-seed".to_string(),
                task_scenario_token: scenario.to_string(),
                mode_token: "continue".to_string(),
                policy_id: Some("policy-native-semantic-seed".to_string()),
                policy_version: Some(1),
                learning_candidate_seed: outcome_contracts::derive_learning_candidate_seed(
                    input, scenario,
                ),
                generated_prompt: String::new(),
                edit_feature_summary: Some(json!({
                    "userEdited": false,
                    "lengthDeltaBucket": "none",
                    "structureChanged": false
                })),
                expires_at_ms: i64::MAX,
            };
            let observation =
                observation_from_stored_feedback(&outcome, Some(&binding), &[], Some(&baseline));
            assert_eq!(observation["candidate"]["artifactType"], expected_type);
            let expected_feature = format!("learning:{expected_pattern}");
            assert!(observation["featureTokens"]
                .as_array()
                .unwrap()
                .iter()
                .any(|token| token.as_str() == Some(expected_feature.as_str())));
        }
    }

    #[test]
    fn native_generation_task_scenario_inference_matches_node_context_semantics() {
        assert_eq!(
            generation_task_scenario_token(
                &json!({}),
                "Use this standard process whenever a review repeats.",
                "continue"
            ),
            "code-review"
        );
        assert_eq!(
            generation_task_scenario_token(
                &json!({ "context": { "tool": "sidecar" } }),
                "Continue with the next scoped step.",
                "continue"
            ),
            "release-ops"
        );
        assert_eq!(
            generation_task_scenario_token(
                &json!({ "context": { "task_scenario": "bug_fix" } }),
                "Continue with the next scoped step.",
                "continue"
            ),
            "bug_fix"
        );
    }

    #[test]
    fn native_open_card_resolves_learning_reminder_without_model_generation() {
        let data_dir = native_test_dir("native-learning-reminder-resolve");
        let runtime = NativeRuntime::with_runner(
            &data_dir,
            Box::new(NativeFakeRunner {
                draft: String::new(),
            }),
        )
        .expect("create native reminder runtime");
        let input = "Preserve existing changes while implementing the request.";
        let seed = outcome_contracts::derive_learning_candidate_seed(input, "feature_development")
            .expect("derive native rule seed");
        let baseline = json!({
            "policyId": "policy-native-reminder",
            "version": 1
        });
        for index in 0..3 {
            let outcome = json!({
                "projectScopeToken": "project-native-reminder",
                "sessionId": if index < 2 { "session-native-reminder-a" } else { "session-native-reminder-b" },
                "outcomeId": format!("outcome-native-reminder-{index}"),
                "status": "succeeded",
                "failureReasonTokens": []
            });
            let binding = GenerationBinding {
                generation_id: format!("generation-native-reminder-{index}"),
                session_id: outcome["sessionId"].as_str().unwrap().to_string(),
                project_scope_token: "project-native-reminder".to_string(),
                strategy_id: "baseline".to_string(),
                strategy_version: "v1".to_string(),
                model_family_token: "gpt-4o-mini".to_string(),
                task_scenario_token: "feature_development".to_string(),
                mode_token: "continue".to_string(),
                policy_id: Some("policy-native-reminder".to_string()),
                policy_version: Some(1),
                learning_candidate_seed: Some(seed.clone()),
                generated_prompt: String::new(),
                edit_feature_summary: Some(json!({
                    "userEdited": false,
                    "lengthDeltaBucket": "none",
                    "structureChanged": false
                })),
                expires_at_ms: i64::MAX,
            };
            let observation =
                observation_from_stored_feedback(&outcome, Some(&binding), &[], Some(&baseline));
            runtime
                .learning
                .record_observation(&observation)
                .expect("record native semantic observation");
        }

        let resolved = route_outcome_learning(
            &Method::Post,
            "/learning/v1/reminder/resolve",
            "/learning/v1/reminder/resolve",
            &json!({
                "projectScopeToken": "project-native-reminder",
                "input": input,
                "taskScenarioToken": "feature_development",
                "modeToken": "continue"
            }),
            &data_dir,
            &runtime,
        )
        .expect("native learning route")
        .expect("native reminder response");
        assert_eq!(resolved.0, 200, "{}", resolved.1);
        assert_eq!(resolved.1["reminder"]["artifactType"], "rule");
        assert!(resolved.1["featureTokens"]
            .as_array()
            .unwrap()
            .iter()
            .any(|token| token == "learning:rule_preserve_existing_changes"));

        let inferred = route_outcome_learning(
            &Method::Post,
            "/learning/v1/reminder/resolve",
            "/learning/v1/reminder/resolve",
            &json!({
                "projectScopeToken": "project-native-inferred-reminder",
                "input": "Use this standard process whenever a review repeats.",
                "modeToken": "continue"
            }),
            &data_dir,
            &runtime,
        )
        .expect("native inferred learning route")
        .expect("native inferred reminder response");
        assert_eq!(inferred.0, 200, "{}", inferred.1);
        assert!(inferred.1["featureTokens"]
            .as_array()
            .unwrap()
            .iter()
            .any(|token| token == "scenario:code-review"));
        assert!(inferred.1["featureTokens"]
            .as_array()
            .unwrap()
            .iter()
            .any(|token| token == "learning:skill_code_review"));
    }

    #[test]
    fn native_global_learning_pause_resume_contract_persists_across_restart() {
        let data_dir = native_test_dir("native-global-learning-pause");

        {
            let runtime = NativeRuntime::with_runner(
                &data_dir,
                Box::new(NativeFakeRunner {
                    draft: String::new(),
                }),
            )
            .expect("open native runtime");

            for invalid in [
                json!({}),
                json!({ "reason": "automatic" }),
                json!({
                    "reason": "manual",
                    "policyId": "per-asset-pause-is-not-supported",
                    "version": 2
                }),
            ] {
                let response = route_outcome_learning(
                    &Method::Post,
                    "/policies/v1/pause",
                    "/policies/v1/pause",
                    &invalid,
                    &data_dir,
                    &runtime,
                )
                .expect("native route")
                .expect("route response");
                assert_eq!(response.0, 400, "{}", response.1);
                assert_eq!(response.1["error"]["code"], "invalid_policy_pause_request");
            }

            let paused = route_outcome_learning(
                &Method::Post,
                "/policies/v1/pause",
                "/policies/v1/pause",
                &json!({ "reason": "manual" }),
                &data_dir,
                &runtime,
            )
            .expect("native route")
            .expect("route response");
            assert_eq!(paused.0, 200, "{}", paused.1);
            assert_eq!(paused.1["state"]["learningPaused"], true);

            let listed = route_outcome_learning(
                &Method::Get,
                "/policies/v1",
                "/policies/v1",
                &json!({}),
                &data_dir,
                &runtime,
            )
            .expect("native route")
            .expect("route response");
            assert_eq!(listed.0, 200, "{}", listed.1);
            assert_eq!(listed.1["learningPaused"], true);
        }

        {
            let runtime = NativeRuntime::with_runner(
                &data_dir,
                Box::new(NativeFakeRunner {
                    draft: String::new(),
                }),
            )
            .expect("reopen paused native runtime");
            let listed = list_policies_route("/policies/v1", &runtime);
            assert_eq!(listed.0, 200, "{}", listed.1);
            assert_eq!(listed.1["learningPaused"], true);

            let per_asset_resume = route_outcome_learning(
                &Method::Post,
                "/policies/v1/resume",
                "/policies/v1/resume",
                &json!({ "policyId": "unsupported", "version": 2 }),
                &data_dir,
                &runtime,
            )
            .expect("native route")
            .expect("route response");
            assert_eq!(per_asset_resume.0, 400, "{}", per_asset_resume.1);
            assert_eq!(
                per_asset_resume.1["error"]["code"],
                "invalid_policy_resume_request"
            );

            let resumed = route_outcome_learning(
                &Method::Post,
                "/policies/v1/resume",
                "/policies/v1/resume",
                &json!({}),
                &data_dir,
                &runtime,
            )
            .expect("native route")
            .expect("route response");
            assert_eq!(resumed.0, 200, "{}", resumed.1);
            assert_eq!(resumed.1["state"]["learningPaused"], false);
        }

        let runtime = NativeRuntime::with_runner(
            &data_dir,
            Box::new(NativeFakeRunner {
                draft: String::new(),
            }),
        )
        .expect("reopen resumed native runtime");
        let listed = list_policies_route("/policies/v1", &runtime);
        assert_eq!(listed.0, 200, "{}", listed.1);
        assert_eq!(listed.1["learningPaused"], false);
    }

    #[test]
    fn compact_generation_policy_stays_valid_and_contains_only_the_runtime_subset() {
        let policy = json!({
            "contractVersion": "generation-policy@1",
            "policyId": "policy-compact-native",
            "version": 3,
            "selectedStrategy": {
                "strategyId": "strategy-compact",
                "strategyVersion": "v3"
            },
            "directives": (0..6)
                .map(|index| format!("directive-{index}-{}", "x".repeat(500)))
                .collect::<Vec<_>>(),
            "contextBudget": {
                "maxInputTokens": 1_200,
                "maxContextSourceTokens": 300
            },
            "signals": { "private": "must-not-be-injected" },
            "evidenceSummary": { "attributableOutcomeCount": 42 },
            "status": "stable"
        });

        let compact = compact_generation_policy(&policy);
        assert!(compact.len() <= 1_600);
        let parsed: Value = serde_json::from_str(&compact).expect("compact policy is valid JSON");
        let keys = parsed
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        assert_eq!(
            keys,
            [
                "contextBudget",
                "contractVersion",
                "directives",
                "policyId",
                "selectedStrategy",
                "version"
            ]
        );
        assert!(parsed["directives"].as_array().unwrap().len() <= 5);
        assert!(parsed.get("signals").is_none());
        assert!(parsed.get("evidenceSummary").is_none());
        let prompt = build_prompt("draft", "idea", &[], 0, Some(&compact));
        assert_eq!(
            prompt
                .matches("Apply exactly this one versioned local Generation Policy")
                .count(),
            1
        );
        assert_eq!(prompt.matches("policy-compact-native").count(), 1);
    }
}
