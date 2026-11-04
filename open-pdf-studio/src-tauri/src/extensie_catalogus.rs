//! Downloads for the extension catalogue (js/plugins/extension-catalog.js):
//! the catalogue JSON, GitHub release information and `.oppx` packages.
//! HTTPS only, with size limits; a package can be checked against a SHA-256
//! from the catalogue. The package itself is installed through the normal
//! transactional install (extensie_installatie.rs).

use sha2::{Digest, Sha256};

const MAX_TEKST: usize = 2 * 1024 * 1024;

fn klant() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("OpenPDFStudio-extensions/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())
}

fn controleer_url(url: &str) -> Result<(), String> {
    let u = reqwest::Url::parse(url).map_err(|_| "Invalid URL".to_string())?;
    if u.scheme() != "https" {
        return Err("Only https:// links are allowed".to_string());
    }
    Ok(())
}

async fn haal(url: &str, max: usize) -> Result<Vec<u8>, String> {
    controleer_url(url)?;
    let mut antwoord = klant()?
        .get(url)
        .header("Accept", "application/json, application/octet-stream, */*")
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    if !antwoord.status().is_success() {
        return Err(format!("HTTP {}", antwoord.status()));
    }
    // Redirects (GitHub release assets) must stay on https.
    controleer_url(antwoord.url().as_str())?;
    if antwoord.content_length().map_or(false, |n| n as usize > max) {
        return Err(format!("Download is larger than {} MB", max / (1024 * 1024)));
    }
    let mut data = Vec::new();
    while let Some(stuk) = antwoord.chunk().await.map_err(|e| format!("Download failed: {e}"))? {
        data.extend_from_slice(&stuk);
        if data.len() > max {
            return Err(format!("Download is larger than {} MB", max / (1024 * 1024)));
        }
    }
    Ok(data)
}

/// A small text resource: the catalogue JSON or GitHub API release info.
#[tauri::command]
pub async fn extensie_tekst_ophalen(url: String) -> Result<String, String> {
    let data = haal(&url, MAX_TEKST).await?;
    String::from_utf8(data).map_err(|_| "Response is not UTF-8 text".to_string())
}

/// Download a `.oppx` package to a temporary file and return its path. With
/// `sha256` (hex) the download must match it.
#[tauri::command]
pub async fn extensie_pakket_ophalen(url: String, sha256: Option<String>) -> Result<String, String> {
    let data = haal(&url, crate::extensie_installatie::MAX_PAKKET as usize).await?;
    if let Some(verwacht) = sha256.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let echt: String = Sha256::digest(&data).iter().map(|b| format!("{b:02x}")).collect();
        if !echt.eq_ignore_ascii_case(verwacht) {
            return Err(format!("SHA-256 mismatch: the download is not the reviewed package (got {echt})"));
        }
    }
    let stempel = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let pad = std::env::temp_dir().join(format!("opds-extension-{stempel}.oppx"));
    std::fs::write(&pad, &data).map_err(|e| format!("Failed to write temp file: {e}"))?;
    Ok(pad.to_string_lossy().to_string())
}
