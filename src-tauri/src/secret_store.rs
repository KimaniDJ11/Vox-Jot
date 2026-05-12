use once_cell::sync::Lazy;
use std::sync::{Arc, Mutex, Once};

#[cfg(test)]
use std::collections::{HashMap, HashSet};

const POST_PROCESS_KEY_SERVICE: &str = "com.voxjot.post_process_api_keys";
const HUGGING_FACE_TOKEN_ACCOUNT: &str = "hugging_face:hub_token";

pub trait SecretStore: Send + Sync {
    fn get_secret(&self, account: &str) -> Result<Option<String>, String>;
    fn set_secret(&self, account: &str, value: &str) -> Result<(), String>;
    fn clear_secret(&self, account: &str) -> Result<(), String>;
}

#[derive(Default)]
struct KeyringSecretStore;

static DEFAULT_STORE_INIT: Once = Once::new();
static DEFAULT_STORE_INIT_ERROR: Mutex<Option<String>> = Mutex::new(None);

#[cfg(target_os = "macos")]
fn install_native_default_store() -> Result<(), String> {
    let store = apple_native_keyring_store::keychain::Store::new()
        .map_err(|error| format!("Failed to open the macOS keychain credential store: {error}"))?;
    keyring_core::set_default_store(store);
    Ok(())
}

#[cfg(target_os = "windows")]
fn install_native_default_store() -> Result<(), String> {
    let store = windows_native_keyring_store::Store::new().map_err(|error| {
        format!("Failed to open the Windows credential manager store: {error}")
    })?;
    keyring_core::set_default_store(store);
    Ok(())
}

#[cfg(target_os = "linux")]
fn install_native_default_store() -> Result<(), String> {
    let store = dbus_secret_service_keyring_store::Store::new().map_err(|error| {
        format!("Failed to open the Linux Secret Service credential store: {error}")
    })?;
    keyring_core::set_default_store(store);
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn install_native_default_store() -> Result<(), String> {
    Err("No native credential store backend is available on this platform.".to_string())
}

fn ensure_default_store_installed() -> Result<(), String> {
    DEFAULT_STORE_INIT.call_once(|| {
        if let Err(error) = install_native_default_store() {
            *DEFAULT_STORE_INIT_ERROR
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(error);
        }
    });
    DEFAULT_STORE_INIT_ERROR
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
        .map_or(Ok(()), Err)
}

impl KeyringSecretStore {
    fn entry(&self, account: &str) -> Result<keyring_core::Entry, String> {
        ensure_default_store_installed()?;
        keyring_core::Entry::new(POST_PROCESS_KEY_SERVICE, account).map_err(|error| {
            format!("Failed to initialize credential entry for '{account}': {error}")
        })
    }
}

impl SecretStore for KeyringSecretStore {
    fn get_secret(&self, account: &str) -> Result<Option<String>, String> {
        match self.entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(error) => Err(format!(
                "Failed to read credential for '{account}': {error}"
            )),
        }
    }

    fn set_secret(&self, account: &str, value: &str) -> Result<(), String> {
        self.entry(account)?
            .set_password(value)
            .map_err(|error| format!("Failed to store credential for '{account}': {error}"))
    }

    fn clear_secret(&self, account: &str) -> Result<(), String> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!(
                "Failed to delete credential for '{account}': {error}"
            )),
        }
    }
}

static SECRET_STORE: Lazy<Mutex<Arc<dyn SecretStore>>> =
    Lazy::new(|| Mutex::new(Arc::new(KeyringSecretStore)));

fn store() -> Arc<dyn SecretStore> {
    SECRET_STORE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn provider_account(provider_id: &str) -> String {
    format!("post_process_provider:{provider_id}")
}

pub fn get_post_process_api_key(provider_id: &str) -> Result<Option<String>, String> {
    store().get_secret(&provider_account(provider_id))
}

pub fn set_post_process_api_key(provider_id: &str, api_key: &str) -> Result<(), String> {
    store().set_secret(&provider_account(provider_id), api_key)
}

pub fn clear_post_process_api_key(provider_id: &str) -> Result<(), String> {
    store().clear_secret(&provider_account(provider_id))
}

pub fn get_hugging_face_token() -> Result<Option<String>, String> {
    store().get_secret(HUGGING_FACE_TOKEN_ACCOUNT)
}

pub fn set_hugging_face_token(token: &str) -> Result<(), String> {
    store().set_secret(HUGGING_FACE_TOKEN_ACCOUNT, token)
}

pub fn clear_hugging_face_token() -> Result<(), String> {
    store().clear_secret(HUGGING_FACE_TOKEN_ACCOUNT)
}

#[cfg(test)]
pub struct TestSecretStore {
    values: Mutex<HashMap<String, String>>,
    fail_reads: Mutex<HashSet<String>>,
    fail_writes: Mutex<HashSet<String>>,
    fail_clears: Mutex<HashSet<String>>,
}

#[cfg(test)]
impl TestSecretStore {
    pub fn new() -> Self {
        Self {
            values: Mutex::new(HashMap::new()),
            fail_reads: Mutex::new(HashSet::new()),
            fail_writes: Mutex::new(HashSet::new()),
            fail_clears: Mutex::new(HashSet::new()),
        }
    }
}

#[cfg(test)]
impl SecretStore for TestSecretStore {
    fn get_secret(&self, account: &str) -> Result<Option<String>, String> {
        if self
            .fail_reads
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains(account)
        {
            return Err(format!("forced read failure for {account}"));
        }
        Ok(self
            .values
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(account)
            .cloned())
    }

    fn set_secret(&self, account: &str, value: &str) -> Result<(), String> {
        if self
            .fail_writes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains(account)
        {
            return Err(format!("forced write failure for {account}"));
        }
        self.values
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(account.to_string(), value.to_string());
        Ok(())
    }

    fn clear_secret(&self, account: &str) -> Result<(), String> {
        if self
            .fail_clears
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains(account)
        {
            return Err(format!("forced clear failure for {account}"));
        }
        self.values
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(account);
        Ok(())
    }
}

#[cfg(test)]
pub struct TestSecretStoreGuard {
    previous: Arc<dyn SecretStore>,
}

#[cfg(test)]
impl Drop for TestSecretStoreGuard {
    fn drop(&mut self) {
        *SECRET_STORE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = self.previous.clone();
    }
}

#[cfg(test)]
pub fn install_test_secret_store(store_impl: Arc<dyn SecretStore>) -> TestSecretStoreGuard {
    let mut guard = SECRET_STORE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let previous = guard.clone();
    *guard = store_impl;
    TestSecretStoreGuard { previous }
}
