use rand::{rngs::OsRng, RngCore};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    env, fs,
    io::Write,
    net::TcpListener,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

const DEFAULT_PORT: u16 = 17371;
const SERVICE_NAME: &str = "smart-prompt-local-service";
const VERSION: &str = "0.5.0-native";

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let data_dir = data_dir()?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    let requested_port = env::var("SMART_PROMPT_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    let (server, port, port_recovered) = bind_server(requested_port)?;
    write_json(&data_dir.join("sidecar-port.json"), &json!({
        "requestedPort": requested_port,
        "port": port,
        "portRecovery": port_recovered,
        "updatedAt": now()
    }))?;
    log_event(&data_dir, "sidecar_started", json!({
        "requestedPort": requested_port,
        "port": port,
        "portRecovery": port_recovered
    }));

    for request in server.incoming_requests() {
        let data_dir = data_dir.clone();
        handle_request(request, &data_dir, port);
    }
    Ok(())
}

fn bind_server(requested_port: u16) -> Result<(Server, u16, bool), String> {
    for offset in 0..=5u16 {
        let port = requested_port.saturating_add(offset);
        let address = format!("127.0.0.1:{port}");
        if TcpListener::bind(&address).is_ok() {
            return Server::http(&address)
                .map(|server| (server, port, offset > 0))
                .map_err(|error| error.to_string());
        }
    }
    Err(format!("No available local-service port starting at {requested_port}"))
}

fn handle_request(mut request: Request, data_dir: &Path, port: u16) {
    let method = request.method().clone();
    let url = request.url().to_string();
    let path = url.split('?').next().unwrap_or("/");

    if method == Method::Options {
        send_json(request, 200, json!({ "ok": true }));
        return;
    }

    if !is_public(&method, path) && !is_authorized(&request, data_dir) {
        send_json(request, 401, json!({
            "ok": false,
            "error": {
                "code": "auth_required",
                "message": "Smart Prompt local service auth token is required."
            }
        }));
        return;
    }

    let body = if method == Method::Post || method == Method::Put {
        let mut text = String::new();
        let _ = request.as_reader().read_to_string(&mut text);
        if text.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(&text).unwrap_or_else(|_| json!({}))
        }
    } else {
        json!({})
    };

    let result = route(method, path, &url, body, data_dir, port);
    match result {
        Ok((status, value)) => send_json(request, status, value),
        Err(error) => send_json(request, 500, json!({
            "ok": false,
            "error": {
                "code": "sidecar_error",
                "message": error
            }
        })),
    }
}

fn route(
    method: Method,
    path: &str,
    url: &str,
    body: Value,
    data_dir: &Path,
    port: u16,
) -> Result<(u16, Value), String> {
    match (method, path) {
        (Method::Get, "/health") => Ok((200, json!({
            "ok": true,
            "service": SERVICE_NAME,
            "version": VERSION,
            "sidecar": "native",
            "authRequired": true,
            "port": port
        }))),
        (Method::Get, "/auth/bootstrap") => Ok((200, json!({
            "ok": true,
            "auth": {
                "scheme": "Bearer",
                "header": "Authorization",
                "tokenHeader": "X-Smart-Prompt-Token",
                "token": get_auth_token(data_dir)?
            }
        }))),
        (Method::Get, "/settings") => Ok((200, json!({
            "ok": true,
            "settings": public_settings(data_dir)?
        }))),
        (Method::Put, "/settings") => {
            let settings = body.get("settings").cloned().unwrap_or(body);
            save_settings(data_dir, settings)?;
            Ok((200, json!({ "ok": true, "settings": public_settings(data_dir)? })))
        }
        (Method::Get, "/llm/providers") => Ok((200, provider_status(data_dir)?)),
        (Method::Post, "/llm/test") => {
            let mode = body.get("mode").and_then(Value::as_str).unwrap_or("idea");
            let settings = private_settings(data_dir)?;
            let key = selected_provider_key(&settings);
            if key.is_empty() {
                return Ok((502, json!({
                    "ok": false,
                    "error": {
                        "code": "provider_key_missing",
                        "message": "Provider API key is required before testing the provider."
                    }
                })));
            }
            let prompt = generate_with_provider(
                &settings,
                "Generate a short Smart Prompt provider connectivity check.",
                mode,
                &[],
                0,
            )?;
            Ok((200, json!({
                "ok": true,
                "provider": settings["provider"],
                "model": settings["model"],
                "mode": mode,
                "generatedBy": "llm",
                "promptLength": prompt.len(),
                "skillCount": 0,
                "uploadWholePage": false,
                "autoSubmit": false,
                "testedAt": now()
            })))
        }
        (Method::Get, "/skills") => Ok((200, json!({ "ok": true, "skills": read_array(data_dir, "skills.json")? }))),
        (Method::Post, "/skills/import-folder") => {
            let imported = import_skill_folder(body.get("path").and_then(Value::as_str).unwrap_or(""))?;
            let mut skills = read_array(data_dir, "skills.json")?;
            for skill in imported.iter().rev() {
                let id = skill.get("id").and_then(Value::as_str).unwrap_or("");
                skills.retain(|item| item.get("id").and_then(Value::as_str).unwrap_or("") != id);
                skills.insert(0, skill.clone());
            }
            write_json(&data_dir.join("skills.json"), &Value::Array(skills.clone()))?;
            Ok((200, json!({ "ok": true, "imported": imported, "skills": skills })))
        }
        (Method::Delete, _) if path.starts_with("/skills/") => {
            let id = decode_path_id(path.trim_start_matches("/skills/"));
            let mut skills = read_array(data_dir, "skills.json")?;
            let before = skills.len();
            skills.retain(|item| item.get("id").and_then(Value::as_str).unwrap_or("") != id);
            write_json(&data_dir.join("skills.json"), &Value::Array(skills.clone()))?;
            if skills.len() == before {
                Ok((404, json!({ "ok": false, "error": { "code": "skill_not_found", "message": "Skill not found." } })))
            } else {
                Ok((200, json!({ "ok": true, "skills": skills })))
            }
        }
        (Method::Post, "/skills/recommend") => {
            let input = body.get("input").and_then(Value::as_str).unwrap_or("");
            let skills = recommend_skills(input, &read_array(data_dir, "skills.json")?);
            Ok((200, json!({ "ok": true, "skills": skills })))
        }
        (Method::Get, "/prompts") => Ok((200, json!({ "ok": true, "prompts": read_array(data_dir, "prompts.json")? }))),
        (Method::Post, "/prompts") => {
            let prompts = add_prompt(data_dir, body)?;
            Ok((200, json!({ "ok": true, "prompt": prompts.first().cloned().unwrap_or(json!({})), "prompts": prompts })))
        }
        (Method::Delete, _) if path.starts_with("/prompts/") => {
            let id = decode_path_id(path.trim_start_matches("/prompts/"));
            let mut prompts = read_array(data_dir, "prompts.json")?;
            let before = prompts.len();
            prompts.retain(|item| item.get("id").and_then(Value::as_str).unwrap_or("") != id);
            write_json(&data_dir.join("prompts.json"), &Value::Array(prompts.clone()))?;
            if prompts.len() == before {
                Ok((404, json!({ "ok": false, "error": { "code": "prompt_not_found", "message": "Prompt not found." } })))
            } else {
                Ok((200, json!({ "ok": true, "prompts": prompts })))
            }
        }
        (Method::Get, "/search") => search(data_dir, url),
        (Method::Get, "/data/backup") => Ok((200, json!({ "ok": true, "backup": export_data(data_dir)? }))),
        (Method::Post, "/data/restore") => {
            let restored = restore_data(data_dir, body.get("backup").cloned().unwrap_or(body))?;
            Ok((200, json!({ "ok": true, "restored": restored })))
        }
        (Method::Delete, "/data/all") => {
            clear_all_local_data(data_dir)?;
            Ok((200, json!({ "ok": true, "deleted": "all-local-data", "clearAllLocalData": true })))
        }
        (Method::Get, "/metrics") => Ok((200, json!({ "ok": true, "metrics": metrics_summary(data_dir)? }))),
        (Method::Post, "/metrics") => {
            let metrics = record_metric(data_dir, body.get("event").cloned().unwrap_or(body))?;
            Ok((200, json!({ "ok": true, "metric": metrics.first().cloned().unwrap_or(json!({})), "metrics": metrics_summary(data_dir)? })))
        }
        (Method::Post, "/generate") => {
            let input = body.get("input").and_then(Value::as_str).unwrap_or("");
            let mode = body
                .get("mode")
                .and_then(Value::as_str)
                .or_else(|| body.pointer("/context/mode").and_then(Value::as_str))
                .unwrap_or_else(|| detect_mode(input));
            let variant = body.get("variantIndex").and_then(Value::as_u64).unwrap_or(0) as usize;
            let skills = recommend_skills(input, &read_array(data_dir, "skills.json")?);
            let settings = private_settings(data_dir)?;
            let prompt = match generate_with_provider(&settings, input, mode, &skills, variant) {
                Ok(value) => value,
                Err(error) if body.get("allowTemplateFallback").and_then(Value::as_bool) == Some(true) => {
                    log_event(data_dir, "llm_fallback", json!({ "error": error }));
                    build_prompt(input, mode, &skills, variant)
                }
                Err(error) => return Ok((502, json!({ "ok": false, "error": { "code": "llm_error", "message": error } }))),
            };
            record_prompt_history(data_dir, mode, "native-sidecar")?;
            Ok((200, json!({
                "ok": true,
                "card": {
                    "mode": mode,
                    "modeLabel": mode_label(mode),
                    "tool": "Smart Prompt",
                    "prompt": prompt,
                    "skills": skills,
                    "generatedBy": if selected_provider_key(&settings).is_empty() { "template-fallback" } else { "llm" },
                    "provider": settings["provider"],
                    "model": settings["model"]
                }
            })))
        }
        (Method::Get, "/diagnostics/export") => Ok((200, json!({
            "ok": true,
            "diagnostics": export_diagnostics(data_dir, port)?
        }))),
        (Method::Get, "/desktop/input-snapshot") => Ok((200, json!({
            "ok": true,
            "snapshot": desktop_input_snapshot(url)?
        }))),
        (Method::Post, "/desktop/fill") => Ok((200, json!({
            "ok": true,
            "fill": desktop_input_fill(url, &body)?
        }))),
        _ => Ok((404, json!({ "ok": false, "error": { "code": "not_found", "message": format!("{path}") } }))),
    }
}

fn data_dir() -> Result<PathBuf, String> {
    if let Some(value) = env::var_os("SMART_PROMPT_DATA_DIR") {
        return Ok(PathBuf::from(value));
    }
    env::current_dir()
        .map(|dir| dir.join(".smart-prompt-data"))
        .map_err(|error| error.to_string())
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
    matches!((method, path), (Method::Get, "/health") | (Method::Get, "/auth/bootstrap"))
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
    fs::write(file, format!("{}\n", serde_json::to_string_pretty(value).map_err(|error| error.to_string())?))
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
        "providerKeys": {
            "agnes": "",
            "openai-compatible": "",
            "anthropic": "",
            "gemini": ""
        },
        "uploadWholePage": false,
        "autoSubmit": false
    })
}

fn private_settings(data_dir: &Path) -> Result<Value, String> {
    let mut settings = merge(default_settings(), read_json(&data_dir.join("settings.json"), json!({}))?);
    let keys = read_json(&data_dir.join("provider-keys-sidecar.json"), json!({}))?;
    settings["providerKeys"] = merge(default_settings()["providerKeys"].clone(), keys);
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
            redacted.insert(provider.clone(), json!(redact_key(value.as_str().unwrap_or(""))));
        }
    }
    settings["apiKey"] = json!("");
    settings["providerKeys"] = Value::Object(redacted);
    settings["credentialStorage"] = json!({
        "encrypted": false,
        "storage": "native-sidecar-local",
        "file": "provider-keys-sidecar.json",
        "plaintextSettings": false,
        "migrateProviderKeys": true
    });
    Ok(settings)
}

fn save_settings(data_dir: &Path, mut next: Value) -> Result<(), String> {
    let current = private_settings(data_dir)?;
    let provider = next.get("provider").cloned().unwrap_or_else(|| current["provider"].clone());
    let mut keys = current["providerKeys"].clone();
    if let Some(incoming) = next.get("providerKeys").and_then(Value::as_object) {
        for (name, value) in incoming {
            if value.as_str().unwrap_or("").is_empty() {
                continue;
            }
            keys[name] = value.clone();
        }
    }
    if let Some(api_key) = next.get("apiKey").and_then(Value::as_str) {
        if !api_key.is_empty() {
            let target = if provider.as_str().unwrap_or("auto") == "auto" {
                "openai-compatible"
            } else {
                provider.as_str().unwrap_or("openai-compatible")
            };
            keys[target] = json!(api_key);
        }
    }
    write_json(&data_dir.join("provider-keys-sidecar.json"), &keys)?;
    next["apiKey"] = json!("");
    next["providerKeys"] = default_settings()["providerKeys"].clone();
    next["uploadWholePage"] = json!(false);
    next["autoSubmit"] = json!(false);
    write_json(&data_dir.join("settings.json"), &merge(current, next))?;
    write_json(&data_dir.join("key-migration.json"), &json!({
        "migrateProviderKeys": true,
        "migratedAt": now(),
        "storage": "native-sidecar-local"
    }))?;
    Ok(())
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
    if value.len() <= 8 {
        return if value.is_empty() { String::new() } else { "***".to_string() };
    }
    format!("{}...{}", &value[..4], &value[value.len().saturating_sub(4)..])
}

fn provider_status(data_dir: &Path) -> Result<Value, String> {
    let settings = private_settings(data_dir)?;
    let keys = settings.get("providerKeys").and_then(Value::as_object).cloned().unwrap_or_default();
    let providers = [
        ("agnes", "Agnes", "https://apihub.agnes-ai.com/v1", "agnes-2.0-flash"),
        ("openai-compatible", "OpenAI-compatible", "https://api.openai.com/v1", "gpt-4o-mini"),
        ("anthropic", "Anthropic", "https://api.anthropic.com/v1", "claude-sonnet-4-20250514"),
        ("gemini", "Gemini", "https://generativelanguage.googleapis.com/v1beta", "gemini-2.5-flash"),
    ];
    let selected = settings.get("provider").and_then(Value::as_str).unwrap_or("auto");
    let auto = providers
        .iter()
        .find(|(provider, _, _, _)| keys.get(*provider).and_then(Value::as_str).unwrap_or("").len() > 0)
        .map(|(provider, _, _, _)| *provider)
        .unwrap_or("openai-compatible");
    Ok(json!({
        "ok": true,
        "selected": selected,
        "auto": { "provider": auto },
        "providers": providers.iter().map(|(provider, label, base_url, model)| json!({
            "provider": provider,
            "label": label,
            "baseUrl": base_url,
            "model": model,
            "selected": *provider == selected,
            "keyAvailable": keys.get(*provider).and_then(Value::as_str).unwrap_or("").len() > 0,
            "keySource": if keys.get(*provider).and_then(Value::as_str).unwrap_or("").is_empty() { "" } else { "native-sidecar" },
            "usesStoredKey": keys.get(*provider).and_then(Value::as_str).unwrap_or("").len() > 0
        })).collect::<Vec<_>>()
    }))
}

fn selected_provider_key(settings: &Value) -> String {
    let keys = settings.get("providerKeys").and_then(Value::as_object).cloned().unwrap_or_default();
    let selected = settings.get("provider").and_then(Value::as_str).unwrap_or("auto");
    if selected != "auto" {
        return keys.get(selected).and_then(Value::as_str).unwrap_or("").to_string();
    }
    for provider in ["agnes", "openai-compatible", "anthropic", "gemini"] {
        let key = keys.get(provider).and_then(Value::as_str).unwrap_or("");
        if !key.is_empty() {
            return key.to_string();
        }
    }
    String::new()
}

fn selected_provider(settings: &Value) -> String {
    let selected = settings.get("provider").and_then(Value::as_str).unwrap_or("auto");
    if selected != "auto" {
        return selected.to_string();
    }
    let keys = settings.get("providerKeys").and_then(Value::as_object).cloned().unwrap_or_default();
    for provider in ["agnes", "openai-compatible", "anthropic", "gemini"] {
        if !keys.get(provider).and_then(Value::as_str).unwrap_or("").is_empty() {
            return provider.to_string();
        }
    }
    "openai-compatible".to_string()
}

fn generate_with_provider(
    settings: &Value,
    input: &str,
    mode: &str,
    skills: &[Value],
    variant: usize,
) -> Result<String, String> {
    let key = selected_provider_key(settings);
    if key.is_empty() {
        return Err("provider key missing".to_string());
    }
    let provider = selected_provider(settings);
    let prompt = build_prompt(input, mode, skills, variant);
    match provider.as_str() {
        "gemini" => call_gemini(settings, &key, &prompt),
        "anthropic" => call_anthropic(settings, &key, &prompt),
        _ => call_openai_compatible(settings, &key, &prompt),
    }
}

fn call_openai_compatible(settings: &Value, key: &str, prompt: &str) -> Result<String, String> {
    let base = settings.get("baseUrl").and_then(Value::as_str).unwrap_or("https://api.openai.com/v1").trim_end_matches('/');
    let model = settings.get("model").and_then(Value::as_str).unwrap_or("gpt-4o-mini");
    let url = format!("{base}/chat/completions");
    let response: Value = ureq::post(&url)
        .set("Authorization", &format!("Bearer {key}"))
        .set("Content-Type", "application/json")
        .send_json(json!({
            "model": model,
            "messages": [
                { "role": "system", "content": "Return only a polished prompt for the user's AI tool." },
                { "role": "user", "content": prompt }
            ],
            "temperature": 0.35
        }))
        .map_err(|error| error.to_string())?
        .into_json()
        .map_err(|error| error.to_string())?;
    response.pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .ok_or_else(|| "LLM response did not include choices[0].message.content".to_string())
}

fn call_anthropic(settings: &Value, key: &str, prompt: &str) -> Result<String, String> {
    let base = settings.get("baseUrl").and_then(Value::as_str).unwrap_or("https://api.anthropic.com/v1").trim_end_matches('/');
    let model = settings.get("model").and_then(Value::as_str).unwrap_or("claude-sonnet-4-20250514");
    let response: Value = ureq::post(&format!("{base}/messages"))
        .set("x-api-key", key)
        .set("anthropic-version", "2023-06-01")
        .set("Content-Type", "application/json")
        .send_json(json!({
            "model": model,
            "max_tokens": 900,
            "messages": [{ "role": "user", "content": prompt }]
        }))
        .map_err(|error| error.to_string())?
        .into_json()
        .map_err(|error| error.to_string())?;
    response.pointer("/content/0/text")
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .ok_or_else(|| "Anthropic response did not include content[0].text".to_string())
}

fn call_gemini(settings: &Value, key: &str, prompt: &str) -> Result<String, String> {
    let base = settings.get("baseUrl").and_then(Value::as_str).unwrap_or("https://generativelanguage.googleapis.com/v1beta").trim_end_matches('/');
    let model = settings.get("model").and_then(Value::as_str).unwrap_or("gemini-2.5-flash");
    let response: Value = ureq::post(&format!("{base}/models/{model}:generateContent?key={key}"))
        .set("Content-Type", "application/json")
        .send_json(json!({
            "contents": [{ "parts": [{ "text": prompt }] }]
        }))
        .map_err(|error| error.to_string())?
        .into_json()
        .map_err(|error| error.to_string())?;
    response.pointer("/candidates/0/content/parts/0/text")
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .ok_or_else(|| "Gemini response did not include candidates[0].content.parts[0].text".to_string())
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

fn build_prompt(input: &str, mode: &str, skills: &[Value], variant: usize) -> String {
    let skill_names = skills
        .iter()
        .take(3)
        .filter_map(|skill| skill.get("name").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "Mode: {}\nVariant: {}\nRelevant skills: {}\n\nTurn the user's draft into a concise, actionable prompt with clear context, constraints, acceptance criteria, and privacy-safe boundaries.\n\nUser draft:\n{}",
        mode_label(mode),
        variant + 1,
        if skill_names.is_empty() { "none" } else { &skill_names },
        input
    )
}

fn recommend_skills(input: &str, skills: &[Value]) -> Vec<Value> {
    let lower = input.to_ascii_lowercase();
    skills
        .iter()
        .filter(|skill| {
            let name = skill.get("name").and_then(Value::as_str).unwrap_or("").to_ascii_lowercase();
            let description = skill.get("description").and_then(Value::as_str).unwrap_or("").to_ascii_lowercase();
            lower.is_empty() || lower.split_whitespace().any(|token| name.contains(token) || description.contains(token))
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
            let name = text.lines().find(|line| line.starts_with("name:"))
                .map(|line| line.trim_start_matches("name:").trim().to_string())
                .unwrap_or_else(|| path.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()).unwrap_or("skill").to_string());
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
    let prompt_body = body.get("body").or_else(|| body.get("prompt")).and_then(Value::as_str).unwrap_or("");
    let title = body.get("title").and_then(Value::as_str).unwrap_or("Untitled prompt");
    let id = body.get("id").and_then(Value::as_str).map(|value| value.to_string()).unwrap_or_else(|| format!("prompt-{}", now()));
    prompts.retain(|item| item.get("id").and_then(Value::as_str).unwrap_or("") != id);
    prompts.insert(0, json!({
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
    }));
    prompts.truncate(200);
    write_json(&data_dir.join("prompts.json"), &Value::Array(prompts.clone()))?;
    Ok(prompts)
}

fn search(data_dir: &Path, url: &str) -> Result<(u16, Value), String> {
    let query = url.split('?').nth(1).unwrap_or("");
    let needle = query.split('&')
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
    Ok((200, json!({ "ok": true, "queryLength": needle.len(), "prompts": prompts, "skills": skills })))
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
            write_json(&data_dir.join(file), value)?;
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

fn clear_all_local_data(data_dir: &Path) -> Result<(), String> {
    log_event(data_dir, "clear_all_local_data", json!({ "clearAllLocalData": true }));
    for entry in fs::read_dir(data_dir).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_dir() {
            fs::remove_dir_all(path).map_err(|error| error.to_string())?;
        } else {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
    }
    fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
    let _ = get_auth_token(data_dir)?;
    Ok(())
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
            "supportedToolProfiles": ["codex", "claude-code", "hermes"],
            "candidates": [],
            "privacy": desktop_input_privacy()
        }));
    }

    let script = find_m3_script("check-m3-desktop-input.ps1")
        .ok_or_else(|| "M3 desktop input probe script not found near native sidecar.".to_string())?;
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
    let text = String::from_utf8_lossy(&output.stdout).trim_start_matches('\u{feff}').trim().to_string();
    let mut value: Value = serde_json::from_str(&text).map_err(|error| format!("Invalid desktop input JSON: {error}"))?;
    ensure_desktop_input_privacy(&mut value);
    Ok(value)
}

fn desktop_input_fill(url: &str, body: &Value) -> Result<Value, String> {
    let self_test = url.contains("selfTest=1")
        || body.get("selfTest").and_then(Value::as_bool).unwrap_or(false);
    let confirm_foreground = url.contains("confirmForeground=1")
        || body.get("confirmForeground").and_then(Value::as_bool).unwrap_or(false);
    let allow_clipboard_fallback = url.contains("allowClipboardFallback=1")
        || body.get("allowClipboardFallback").and_then(Value::as_bool).unwrap_or(false);
    if !cfg!(target_os = "windows") {
        return Ok(json!({
            "schemaVersion": "m3-windows-fill@1",
            "createdAt": now(),
            "platform": std::env::consts::OS,
            "selfTest": self_test,
            "confirmForeground": confirm_foreground,
            "allowClipboardFallback": allow_clipboard_fallback,
            "pass": false,
            "reason": "macos_ax_pending_or_unsupported_platform",
            "writeAttempted": false,
            "verified": false,
            "clipboardFallbackTried": false,
            "clipboardRestored": false,
            "supportedToolProfiles": ["codex", "claude-code", "hermes"],
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
    if let Some(expected_title_hash) = body.get("expectedTitleHash").and_then(Value::as_str) {
        if !expected_title_hash.is_empty() {
            command.arg("-ExpectedTitleHash").arg(expected_title_hash);
        }
    }
    if let Some(expected_tool_profile) = body.get("expectedToolProfile").and_then(Value::as_str) {
        if !expected_tool_profile.is_empty() {
            command.arg("-ExpectedToolProfile").arg(expected_tool_profile);
        }
    }
    if let Some(candidate_index) = body.get("candidateIndex").and_then(Value::as_i64) {
        command.arg("-CandidateIndex").arg(candidate_index.to_string());
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
    let text = String::from_utf8_lossy(&output.stdout).trim_start_matches('\u{feff}').trim().to_string();
    let mut value: Value = serde_json::from_str(&text).map_err(|error| format!("Invalid desktop fill JSON: {error}"))?;
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
        object.entry("supportedToolProfiles".to_string()).or_insert_with(|| json!(["codex", "claude-code", "hermes"]));
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
        object.entry("supportedToolProfiles".to_string()).or_insert_with(|| json!(["codex", "claude-code", "hermes"]));
    }
}

fn find_m3_script(script_name: &str) -> Option<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(current_exe) = std::env::current_exe() {
        roots.extend(current_exe.ancestors().map(Path::to_path_buf));
    }
    if let Ok(current_dir) = std::env::current_dir() {
        roots.extend(current_dir.ancestors().map(Path::to_path_buf));
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    roots.extend(manifest_dir.ancestors().map(Path::to_path_buf));
    roots.into_iter()
        .map(|root| root.join("scripts").join(script_name))
        .find(|candidate| candidate.exists())
}

fn record_prompt_history(data_dir: &Path, mode: &str, generated_by: &str) -> Result<(), String> {
    let mut history = read_array(data_dir, "prompt-history.json")?;
    history.insert(0, json!({ "id": format!("history-{}", now()), "created_at": now(), "mode": mode, "tool": "Smart Prompt", "generatedBy": generated_by }));
    history.truncate(100);
    write_json(&data_dir.join("prompt-history.json"), &Value::Array(history))
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
    write_json(&data_dir.join("metrics.json"), &Value::Array(metrics.clone()))?;
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
        let action = event.get("action").and_then(Value::as_str).unwrap_or("unknown").to_string();
        *by_action.entry(action.clone()).or_insert(0usize) += 1;
        let adapter_id = event.get("adapterId").and_then(Value::as_str).unwrap_or("unknown").to_string();
        let adapter = by_adapter.entry(adapter_id).or_insert_with(|| json!({
            "events": 0,
            "insertAttempts": 0,
            "verifiedInserts": 0,
            "failures": 0
        }));
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
            if event.get("adopted").and_then(Value::as_bool).unwrap_or(false)
                || event.get("verified").and_then(Value::as_bool).unwrap_or(false)
            {
                adopted += 1;
                bump_json_usize(adapter, "verifiedInserts");
            } else {
                bump_json_usize(adapter, "failures");
                let reason = event.get("failureReason").and_then(Value::as_str).unwrap_or("unknown").to_string();
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
    Ok(json!({
        "createdAt": now(),
        "service": SERVICE_NAME,
        "sidecar": "native",
        "port": port,
        "dataDir": data_dir.to_string_lossy(),
        "diagnostics": true,
        "portRecovery": read_json(&data_dir.join("sidecar-port.json"), json!({}))?,
        "keyMigration": read_json(&data_dir.join("key-migration.json"), json!({ "migrateProviderKeys": false }))?,
        "metrics": metrics_summary(data_dir)?,
        "logs": read_log_tail(data_dir)
    }))
}

fn log_event(data_dir: &Path, event: &str, detail: Value) {
    let log_dir = data_dir.join("logs");
    let _ = fs::create_dir_all(&log_dir);
    let file = log_dir.join("sidecar.log");
    if let Ok(mut handle) = fs::OpenOptions::new().create(true).append(true).open(file) {
        let _ = writeln!(handle, "{}", json!({ "createdAt": now(), "event": event, "detail": detail }));
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
    let mut response = Response::from_string(format!("{}\n", value))
        .with_status_code(StatusCode(status));
    for (name, value) in [
        ("Content-Type", "application/json"),
        ("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Smart-Prompt-Token"),
        ("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS"),
        ("Access-Control-Allow-Origin", request.headers().iter().find(|header| header.field.as_str().to_string().eq_ignore_ascii_case("Origin")).map(|header| header.value.as_str()).unwrap_or("http://tauri.localhost")),
        ("Vary", "Origin"),
    ] {
        if let Ok(header) = Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            response.add_header(header);
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
