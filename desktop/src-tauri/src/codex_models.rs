//! Account-authorized model catalog. Authentication never crosses IPC.
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};

fn credential_user(home: &Path) -> Result<String, String> {
    let home = home
        .canonicalize()
        .map_err(|_| "ChatGPT account home is unavailable")?;
    let digest = format!("{:x}", Sha256::digest(home.to_string_lossy().as_bytes()));
    Ok(format!("cli-{}", &digest[..16]))
}
pub fn catalog(home: &Path) -> Result<Value, String> {
    let user = credential_user(home)?;
    let raw = keyring::Entry::new("Codex Auth", &user)
        .and_then(|entry| entry.get_password())
        .map_err(|_| "Cannot verify model availability: ChatGPT credentials are unavailable in the OS credential store.")?;
    let auth: Value =
        serde_json::from_str(&raw).map_err(|_| "Cannot read ChatGPT model credentials")?;
    let token = auth["tokens"]["access_token"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or("ChatGPT model credentials contain no access token")?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Cannot initialize the model catalog client")?;
    let mut request = client
        .get("https://api.openai.com/v1/models")
        .bearer_auth(token);
    if let Some(account) = auth["tokens"]["account_id"].as_str() {
        request = request.header("ChatGPT-Account-ID", account);
    }
    let response = request.send().map_err(|_| "Cannot verify model availability: model catalog request failed. Check your connection and refresh.")?;
    if !response.status().is_success() {
        return Err(format!("Cannot verify model availability (HTTP {}). Refresh or reconnect the selected ChatGPT account.", response.status().as_u16()));
    }
    let catalog: Value = response
        .json()
        .map_err(|_| "Invalid account model catalog response")?;
    if !catalog["models"].is_array() {
        return Err("The account did not return a selectable model catalog".into());
    }
    Ok(catalog)
}
pub fn selectable(catalog: &Value, metadata: &[Value]) -> Vec<Value> {
    catalog["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|item| item["visibility"] == "list")
        .filter_map(|item| {
            let slug = item["slug"].as_str().filter(|slug| !slug.is_empty())?;
            let mut model = metadata
                .iter()
                .find(|model| model["model"] == slug)
                .cloned()
                .unwrap_or_else(|| {
                    serde_json::json!({
                        "model":slug,"displayName":slug,"isDefault":false,
                        "defaultReasoningEffort":"medium","supportedReasoningEfforts":[]
                    })
                });
            if let Some(name) = item["display_name"].as_str() {
                model["displayName"] = name.into();
            }
            Some(model)
        })
        .collect()
}
pub fn validate(home: &Path, model: &str) -> Result<(), String> {
    let catalog = catalog(home)?;
    if selectable(&catalog, &[])
        .iter()
        .any(|item| item["model"] == model)
    {
        Ok(())
    } else {
        Err(format!("Model {model} is unavailable for the selected ChatGPT account. Choose an available model or Provider default; the automation remains enabled."))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn live_catalog_excludes_bundled_and_hidden_models() {
        let catalog = serde_json::json!({"models":[{"slug":"supported","display_name":"Supported","visibility":"list"},{"slug":"hidden","visibility":"hide"}]});
        let metadata = vec![
            serde_json::json!({"model":"gpt-6-luna"}),
            serde_json::json!({"model":"supported","isDefault":true,"supportedReasoningEfforts":[{"reasoningEffort":"high"}]}),
        ];
        let models = selectable(&catalog, &metadata);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0]["model"], "supported");
        assert_eq!(models[0]["displayName"], "Supported");
        assert_eq!(
            models[0]["supportedReasoningEfforts"][0]["reasoningEffort"],
            "high"
        );
    }
    #[test]
    fn live_only_models_are_available_without_bundled_metadata() {
        let models = selectable(
            &serde_json::json!({"models":[{"slug":"new","visibility":"list"}]}),
            &[],
        );
        assert_eq!(models[0]["model"], "new");
        assert!(selectable(&serde_json::json!({}), &[]).is_empty());
    }
}
