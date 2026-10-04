//! Shared GitHub credential access for repository APIs and Copilot.
//! Secrets remain in the OS credential store and never cross IPC.
use keyring::{Entry, Error};
const SERVICE: &str = "dev.gitcerberus.app";
#[cfg(target_os = "linux")]
const COLLECTION: &str = "GitCerberus";

fn entry(id: &str) -> keyring::Result<Entry> {
    let user = format!("github:{id}");
    #[cfg(target_os = "linux")]
    {
        Entry::new_with_target(COLLECTION, SERVICE, &user)
    }
    #[cfg(not(target_os = "linux"))]
    {
        Entry::new(SERVICE, &user)
    }
}
#[cfg(target_os = "linux")]
fn legacy_entry(id: &str) -> keyring::Result<Entry> {
    // Search by service/user across collections. The default-target search in
    // keyring falls back to ReadAlias(default), which fails when no alias exists.
    let credential = keyring::secret_service::SsCredential::new_with_no_target(
        SERVICE,
        &format!("github:{id}"),
    )?;
    Ok(Entry::new_with_credential(Box::new(credential)))
}
fn read_with(
    primary: impl FnOnce() -> keyring::Result<String>,
    legacy: impl FnOnce() -> keyring::Result<String>,
) -> keyring::Result<String> {
    match primary() {
        Err(Error::NoEntry) => legacy(),
        result => result,
    }
}
fn describe(error: Error) -> String {
    match error {
        Error::NoEntry => "GitHub token is missing from the active system credential store. Reconnect this account. On Linux, keep the same Secret Service provider active between sign-in and execution.".into(),
        Error::NoStorageAccess(_) | Error::PlatformFailure(_) => format!("GitHub credential storage is unavailable: {error}. Unlock or repair the system credential store before reconnecting; signing in again alone cannot repair storage access."),
        Error::Ambiguous(_) => "Multiple GitHub credentials match this account in the system credential store. Disconnect and reconnect this account to replace them.".into(),
        _ => "The system credential store returned an unreadable GitHub credential. Disconnect and reconnect this account.".into(),
    }
}
pub fn token(id: &str) -> Result<String, String> {
    let value = read_with(
        || entry(id)?.get_password(),
        || {
            #[cfg(target_os = "linux")]
            {
                legacy_entry(id)?.get_password()
            }
            #[cfg(not(target_os = "linux"))]
            {
                Err(Error::NoEntry)
            }
        },
    )
    .map_err(describe)?;
    if value.trim().is_empty() {
        return Err(describe(Error::NoEntry));
    }
    Ok(value)
}
fn save_with(
    secret: &str,
    write: impl FnOnce(&str) -> keyring::Result<()>,
    read_fresh: impl FnOnce() -> keyring::Result<String>,
) -> Result<(), String> {
    write(secret).map_err(|error| {
        format!(
            "GitHub sign-in could not save its credential: {}",
            describe(error)
        )
    })?;
    let saved = read_fresh().map_err(|error| {
        format!(
            "GitHub sign-in could not verify its saved credential: {}",
            describe(error)
        )
    })?;
    if saved != secret {
        return Err("GitHub sign-in could not verify its saved credential. Repair the system credential store and reconnect.".into());
    }
    Ok(())
}
pub fn save(id: &str, secret: &str) -> Result<(), String> {
    // A fresh entry exercises the same lookup used by later API/agent calls.
    save_with(
        secret,
        |value| entry(id)?.set_password(value),
        || entry(id)?.get_password(),
    )
}
pub fn disconnect(id: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let entry = legacy_entry(id).map_err(describe)?;
        let credential = entry
            .get_credential()
            .downcast_ref::<keyring::secret_service::SsCredential>()
            .ok_or("GitHub credential store type is unavailable")?;
        credential.delete_all_passwords().map_err(describe)
    }
    #[cfg(not(target_os = "linux"))]
    {
        match entry(id).map_err(describe)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(describe(error)),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_credentials_are_read_only_when_primary_is_missing() {
        assert_eq!(
            read_with(|| Err(Error::NoEntry), || Ok("old credential".into())).unwrap(),
            "old credential"
        );
        assert_eq!(
            read_with(
                || Ok("current credential".into()),
                || panic!("unneeded legacy lookup")
            )
            .unwrap(),
            "current credential"
        );
        assert!(matches!(
            read_with(
                || Err(Error::Ambiguous(vec![])),
                || panic!("must not mask a storage error")
            ),
            Err(Error::Ambiguous(_))
        ));
    }
    #[test]
    fn sign_in_requires_a_fresh_successful_read() {
        assert!(save_with("fixture", |_| Ok(()), || Ok("fixture".into())).is_ok());
        assert!(save_with("fixture", |_| Ok(()), || Err(Error::NoEntry)).is_err());
        let error = save_with(
            "fixture-private-value",
            |_| Ok(()),
            || Ok("other-private-value".into()),
        )
        .unwrap_err();
        assert!(!error.contains("fixture-private-value") && !error.contains("other-private-value"));
        assert!(save_with(
            "fixture",
            |_| Err(Error::NoEntry),
            || panic!("failed write must stop sign-in")
        )
        .is_err());
    }
    #[test]
    fn storage_errors_are_distinct_from_missing_credentials() {
        let error = describe(Error::NoStorageAccess(Box::new(std::io::Error::other(
            "fixture store locked",
        ))));
        assert!(error.contains("storage is unavailable") && error.contains("fixture store locked"));
        assert!(!error.contains("token is missing"));
        assert!(describe(Error::NoEntry).contains("Reconnect this account"));
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn linux_entries_use_a_named_collection_and_legacy_lookup_has_no_target() {
        let current = entry("fixture").unwrap();
        let current = current
            .get_credential()
            .downcast_ref::<keyring::secret_service::SsCredential>()
            .unwrap();
        assert_eq!(current.attributes["target"], COLLECTION);
        let legacy = legacy_entry("fixture").unwrap();
        let legacy = legacy
            .get_credential()
            .downcast_ref::<keyring::secret_service::SsCredential>()
            .unwrap();
        assert!(!legacy.attributes.contains_key("target"));
        assert_eq!(legacy.attributes["service"], SERVICE);
        assert_eq!(legacy.attributes["username"], "github:fixture");
    }
}
