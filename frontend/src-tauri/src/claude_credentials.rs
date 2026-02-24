use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Serialize, Deserialize)]
pub struct ClaudeCredentials {
    #[serde(rename = "sessionToken")]
    pub session_token: Option<String>,
    #[serde(rename = "expiresAt")]
    pub expires_at: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClaudeCredentialsResult {
    pub found: bool,
    pub token: Option<String>,
    pub expires_at: Option<u64>,
    pub is_expired: bool,
    pub error: Option<String>,
}

/// Read Claude CLI credentials from ~/.claude/.credentials.json
/// Returns the token and expiration info if found
#[tauri::command]
pub async fn read_claude_cli_credentials() -> Result<ClaudeCredentialsResult, String> {
    println!("[CLAUDE-CLI] Checking for Claude CLI credentials");

    // Get home directory
    let home_dir = match dirs::home_dir() {
        Some(dir) => dir,
        None => {
            println!("[CLAUDE-CLI] Could not determine home directory");
            return Ok(ClaudeCredentialsResult {
                found: false,
                token: None,
                expires_at: None,
                is_expired: false,
                error: Some("Could not determine home directory".to_string()),
            });
        }
    };

    let credentials_path = home_dir.join(".claude").join(".credentials.json");
    println!("[CLAUDE-CLI] Looking for credentials at: {}", credentials_path.display());

    // Check if file exists
    if !credentials_path.exists() {
        println!("[CLAUDE-CLI] Credentials file not found");
        return Ok(ClaudeCredentialsResult {
            found: false,
            token: None,
            expires_at: None,
            is_expired: false,
            error: None,
        });
    }

    // Read and parse the credentials file
    let content = match fs::read_to_string(&credentials_path) {
        Ok(content) => content,
        Err(e) => {
            println!("[CLAUDE-CLI] Failed to read credentials file: {}", e);
            return Ok(ClaudeCredentialsResult {
                found: false,
                token: None,
                expires_at: None,
                is_expired: false,
                error: Some(format!("Failed to read credentials file: {}", e)),
            });
        }
    };

    // Parse JSON
    let json_value: serde_json::Value = match serde_json::from_str(&content) {
        Ok(val) => val,
        Err(e) => {
            println!("[CLAUDE-CLI] Failed to parse credentials JSON: {}", e);
            return Ok(ClaudeCredentialsResult {
                found: false,
                token: None,
                expires_at: None,
                is_expired: false,
                error: Some(format!("Failed to parse credentials JSON: {}", e)),
            });
        }
    };

    // Check for claudeAiOauth.accessToken
    let token = if let Some(access_token) = json_value.get("claudeAiOauth")
        .and_then(|oauth| oauth.get("accessToken"))
        .and_then(|v| v.as_str()) {
        access_token.to_string()
    } else {
        println!("[CLAUDE-CLI] No valid session token found in credentials");
        return Ok(ClaudeCredentialsResult {
            found: false,
            token: None,
            expires_at: None,
            is_expired: false,
            error: Some("No valid session token found".to_string()),
        });
    };

    let expires_at = json_value.get("claudeAiOauth")
        .and_then(|oauth| oauth.get("expiresAt"))
        .and_then(|v| v.as_u64());

    // Check expiration
    let is_expired = if let Some(exp) = expires_at {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let expired = now >= exp;
        println!("[CLAUDE-CLI] Token expires at: {}, now: {}, expired: {}", exp, now, expired);
        expired
    } else {
        println!("[CLAUDE-CLI] No expiration info found, assuming not expired");
        false
    };

    println!("[CLAUDE-CLI] Successfully read credentials - found: true, expired: {}", is_expired);

    Ok(ClaudeCredentialsResult {
        found: true,
        token: Some(token),
        expires_at,
        is_expired,
        error: None,
    })
}
