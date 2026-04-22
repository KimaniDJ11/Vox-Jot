use once_cell::sync::Lazy;
use std::sync::{Arc, Mutex};

#[cfg(test)]
use std::collections::{HashMap, HashSet};

const POST_PROCESS_KEY_SERVICE: &str = "com.voxjot.post_process_api_keys";

pub trait SecretStore: Send + Sync {
    fn get_secret(&self, account: &str) -> Result<Option<String>, String>;
    fn set_secret(&self, account: &str, value: &str) -> Result<(), String>;
    fn clear_secret(&self, account: &str) -> Result<(), String>;
}

#[derive(Default)]
struct KeyringSecretStore;

impl KeyringSecretStore {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    fn ensure_native_backend(entry: &keyring::Entry, account: &str) -> Result<(), String> {
        if entry
            .get_credential()
            .downcast_ref::<keyring::mock::MockCredential>()
            .is_some()
        {
            return Err(format!(
                "Secure credential backend is unavailable for '{account}': keyring resolved to an in-memory mock backend instead of the native OS store."
            ));
        }

        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    fn ensure_native_backend(_entry: &keyring::Entry, _account: &str) -> Result<(), String> {
        Ok(())
    }

    fn entry(&self, account: &str) -> Result<keyring::Entry, String> {
        let entry = keyring::Entry::new(POST_PROCESS_KEY_SERVICE, account).map_err(|error| {
            format!("Failed to initialize credential entry for '{account}': {error}")
        })?;

        Self::ensure_native_backend(&entry, account)?;

        Ok(entry)
    }
}

impl SecretStore for KeyringSecretStore {
    fn get_secret(&self, account: &str) -> Result<Option<String>, String> {
        match self.entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(format!("Failed to read credential for '{account}': {error}")),
        }
    }

    fn set_secret(&self, account: &str, value: &str) -> Result<(), String> {
        self.entry(account)?
            .set_password(value)
            .map_err(|error| format!("Failed to store credential for '{account}': {error}"))
    }

    fn clear_secret(&self, account: &str) -> Result<(), String> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
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
