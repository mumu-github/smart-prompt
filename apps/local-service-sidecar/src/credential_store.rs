use serde_json::{json, Map, Value};
use std::{collections::BTreeMap, fs, io::ErrorKind, path::Path};

pub type ProviderKeys = BTreeMap<String, String>;

const PROVIDERS: [&str; 5] = [
    "agnes",
    "openai-compatible",
    "anthropic",
    "gemini",
    "custom",
];
const SCHEMA_VERSION: &str = "provider-keys-dpapi@1";
const STORAGE: &str = "windows-dpapi-current-user";

pub fn empty_provider_keys() -> ProviderKeys {
    PROVIDERS
        .iter()
        .map(|provider| ((*provider).to_string(), String::new()))
        .collect()
}

fn normalize_provider_keys(value: &Value) -> ProviderKeys {
    let mut keys = empty_provider_keys();
    for provider in PROVIDERS {
        if let Some(key) = value.get(provider).and_then(Value::as_str) {
            keys.insert(provider.to_string(), key.to_string());
        }
    }
    keys
}

fn write_json(file: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|_| "credential_storage_write_failed".to_string())?;
    }
    let text = serde_json::to_string_pretty(value)
        .map_err(|_| "credential_storage_encode_failed".to_string())?;
    fs::write(file, format!("{text}\n")).map_err(|_| "credential_storage_write_failed".to_string())
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn hex_decode(value: &str) -> Result<Vec<u8>, String> {
    if value.len() % 2 != 0 || !value.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("credential_storage_ciphertext_invalid".to_string());
    }
    (0..value.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&value[index..index + 2], 16)
                .map_err(|_| "credential_storage_ciphertext_invalid".to_string())
        })
        .collect()
}

#[cfg(windows)]
fn protect(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    use std::{ffi::c_void, ptr};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB},
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: plaintext
            .len()
            .try_into()
            .map_err(|_| "credential_storage_input_too_large".to_string())?,
        pbData: plaintext.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    let succeeded = unsafe {
        CryptProtectData(
            &input,
            ptr::null(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if succeeded == 0 || output.pbData.is_null() {
        return Err("credential_storage_encrypt_failed".to_string());
    }
    let ciphertext = unsafe {
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData as *mut c_void);
        bytes
    };
    Ok(ciphertext)
}

#[cfg(not(windows))]
fn protect(_plaintext: &[u8]) -> Result<Vec<u8>, String> {
    Err("credential_encryption_unavailable".to_string())
}

#[cfg(windows)]
fn unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    use std::{ffi::c_void, ptr};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: ciphertext
            .len()
            .try_into()
            .map_err(|_| "credential_storage_input_too_large".to_string())?,
        pbData: ciphertext.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    let succeeded = unsafe {
        CryptUnprotectData(
            &input,
            ptr::null_mut(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if succeeded == 0 || output.pbData.is_null() {
        return Err("credential_storage_decrypt_failed".to_string());
    }
    let plaintext = unsafe {
        let bytes = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData as *mut c_void);
        bytes
    };
    Ok(plaintext)
}

#[cfg(not(windows))]
fn unprotect(_ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    Err("credential_encryption_unavailable".to_string())
}

fn encrypt_document(keys: &ProviderKeys) -> Result<Value, String> {
    let mut encrypted = Map::new();
    for provider in PROVIDERS {
        let key = keys.get(provider).map(String::as_str).unwrap_or("");
        let ciphertext = if key.is_empty() {
            String::new()
        } else {
            hex_encode(&protect(key.as_bytes())?)
        };
        encrypted.insert(provider.to_string(), json!(ciphertext));
    }
    Ok(json!({
        "schemaVersion": SCHEMA_VERSION,
        "storage": if cfg!(windows) { STORAGE } else { "credential-encryption-unavailable" },
        "keys": Value::Object(encrypted)
    }))
}

fn decrypt_document(document: &Value) -> Result<ProviderKeys, String> {
    if document.get("schemaVersion").and_then(Value::as_str) != Some(SCHEMA_VERSION) {
        return Err("credential_storage_schema_invalid".to_string());
    }
    if cfg!(windows) && document.get("storage").and_then(Value::as_str) != Some(STORAGE) {
        return Err("credential_storage_backend_invalid".to_string());
    }
    let encrypted = document
        .get("keys")
        .and_then(Value::as_object)
        .ok_or_else(|| "credential_storage_keys_invalid".to_string())?;
    let mut keys = empty_provider_keys();
    for provider in PROVIDERS {
        let ciphertext = encrypted
            .get(provider)
            .and_then(Value::as_str)
            .unwrap_or("");
        let key = if ciphertext.is_empty() {
            String::new()
        } else {
            String::from_utf8(unprotect(&hex_decode(ciphertext)?)?)
                .map_err(|_| "credential_storage_plaintext_invalid".to_string())?
        };
        keys.insert(provider.to_string(), key);
    }
    Ok(keys)
}

fn migrate_legacy(file: &Path, keys: &ProviderKeys) -> Result<(), String> {
    let encrypted = encrypt_document(keys)?;
    let serialized = serde_json::to_string(&encrypted)
        .map_err(|_| "credential_storage_encode_failed".to_string())?;
    if keys
        .values()
        .filter(|value| !value.is_empty())
        .any(|value| serialized.contains(value))
    {
        return Err("credential_storage_plaintext_guard_failed".to_string());
    }

    let recovery = file.with_file_name("provider-keys-sidecar.encrypted-recovery.json");
    write_json(&recovery, &encrypted)?;
    let recovery_text = fs::read_to_string(&recovery)
        .map_err(|_| "credential_storage_recovery_read_failed".to_string())?;
    let recovery_document: Value = serde_json::from_str(&recovery_text)
        .map_err(|_| "credential_storage_recovery_invalid".to_string())?;
    if decrypt_document(&recovery_document)? != *keys {
        return Err("credential_storage_recovery_verify_failed".to_string());
    }
    write_json(file, &encrypted)
}

pub fn load_provider_keys(data_dir: &Path) -> Result<ProviderKeys, String> {
    let file = data_dir.join("provider-keys-sidecar.json");
    let text = match fs::read_to_string(&file) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(empty_provider_keys()),
        Err(_) => return Err("credential_storage_read_failed".to_string()),
    };
    let document: Value = serde_json::from_str(&text)
        .map_err(|_| "credential_storage_document_invalid".to_string())?;
    if document.get("schemaVersion").and_then(Value::as_str) == Some(SCHEMA_VERSION) {
        return decrypt_document(&document);
    }

    let legacy = normalize_provider_keys(&document);
    migrate_legacy(&file, &legacy)?;
    Ok(legacy)
}

pub fn save_provider_keys(data_dir: &Path, keys: &ProviderKeys) -> Result<(), String> {
    let normalized = normalize_provider_keys(
        &serde_json::to_value(keys).map_err(|_| "credential_storage_encode_failed".to_string())?,
    );
    let encrypted = encrypt_document(&normalized)?;
    write_json(&data_dir.join("provider-keys-sidecar.json"), &encrypted)
}

pub fn has_any_key(keys: &ProviderKeys) -> bool {
    keys.values().any(|value| !value.is_empty())
}

pub fn storage_summary() -> Value {
    json!({
        "encrypted": cfg!(windows),
        "storage": if cfg!(windows) { STORAGE } else { "credential-encryption-unavailable" },
        "file": "provider-keys-sidecar.json",
        "plaintextSettings": false,
        "migrateProviderKeys": true
    })
}
