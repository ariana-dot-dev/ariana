use actix_web::{get, post, web::Json, HttpResponse};
use log::{info, warn};
use serde::{Deserialize, Serialize};

/// Clipboard proxy endpoints that forward to xdotool-server on localhost:9091
/// This allows HTTPS pages to access the clipboard functionality without mixed-content issues

const XDOTOOL_SERVER_URL: &str = "http://127.0.0.1:9091";

#[derive(Debug, Serialize, Deserialize)]
pub struct ClipboardData {
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClipboardError {
    pub error: String,
}

/// GET /api/clipboard - Read clipboard from remote desktop
#[get("/clipboard")]
pub async fn get_clipboard() -> HttpResponse {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            warn!("[Clipboard] Failed to create HTTP client: {}", e);
            return HttpResponse::InternalServerError().json(ClipboardError {
                error: format!("Failed to create HTTP client: {}", e),
            });
        }
    };

    match client.get(format!("{}/clipboard", XDOTOOL_SERVER_URL)).send().await {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<ClipboardData>().await {
                    Ok(data) => {
                        info!("[Clipboard] GET OK: {} chars from xdotool-server", data.text.len());
                        HttpResponse::Ok().json(data)
                    }
                    Err(e) => {
                        warn!("[Clipboard] Failed to parse response: {}", e);
                        HttpResponse::InternalServerError().json(ClipboardError {
                            error: format!("Failed to parse clipboard response: {}", e),
                        })
                    }
                }
            } else {
                warn!("[Clipboard] xdotool-server returned status: {}", response.status());
                HttpResponse::InternalServerError().json(ClipboardError {
                    error: format!("xdotool-server error: {}", response.status()),
                })
            }
        }
        Err(e) => {
            warn!("[Clipboard] Failed to connect to xdotool-server: {}", e);
            HttpResponse::ServiceUnavailable().json(ClipboardError {
                error: format!("xdotool-server not available: {}", e),
            })
        }
    }
}

/// POST /api/clipboard - Write clipboard to remote desktop
#[post("/clipboard")]
pub async fn post_clipboard(Json(data): Json<ClipboardData>) -> HttpResponse {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            warn!("[Clipboard] Failed to create HTTP client: {}", e);
            return HttpResponse::InternalServerError().json(ClipboardError {
                error: format!("Failed to create HTTP client: {}", e),
            });
        }
    };

    match client
        .post(format!("{}/clipboard", XDOTOOL_SERVER_URL))
        .json(&data)
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                info!("[Clipboard] POST OK: wrote {} chars to xdotool-server", data.text.len());
                HttpResponse::Ok().body("ok")
            } else {
                warn!("[Clipboard] xdotool-server returned status: {}", response.status());
                HttpResponse::InternalServerError().json(ClipboardError {
                    error: format!("xdotool-server error: {}", response.status()),
                })
            }
        }
        Err(e) => {
            warn!("[Clipboard] Failed to connect to xdotool-server: {}", e);
            HttpResponse::ServiceUnavailable().json(ClipboardError {
                error: format!("xdotool-server not available: {}", e),
            })
        }
    }
}
