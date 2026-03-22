use log::info;
use reqwest::header::{ACCEPT, RANGE, USER_AGENT};
use reqwest::{Client, Response, StatusCode, Url};
use serde::Deserialize;
use std::process::Command;

const APP_USER_AGENT: &str = "Vox-Jot";

#[derive(Debug, Clone)]
struct GithubReleaseDownload {
    owner: String,
    repo: String,
    tag: String,
    asset_name: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAsset {
    name: String,
    url: String,
}

pub async fn get_with_optional_github_auth(
    client: &Client,
    url: &str,
    range_start: Option<u64>,
) -> Result<Response, String> {
    let direct = send_request(client, url, range_start, None).await?;
    if direct.status() != StatusCode::NOT_FOUND && direct.status() != StatusCode::FORBIDDEN {
        return Ok(direct);
    }

    let Some(download) = parse_github_release_download(url) else {
        return Ok(direct);
    };

    let Some(token) = github_token() else {
        return Ok(direct);
    };

    info!(
        "Retrying private GitHub release asset via API for {}/{} tag {} asset {}",
        download.owner, download.repo, download.tag, download.asset_name
    );

    match resolve_private_asset_api_url(client, &download, &token).await? {
        Some(asset_api_url) => {
            send_request(client, &asset_api_url, range_start, Some(&token)).await
        }
        None => Ok(direct),
    }
}

async fn send_request(
    client: &Client,
    url: &str,
    range_start: Option<u64>,
    token: Option<&str>,
) -> Result<Response, String> {
    let mut request = client.get(url).header(USER_AGENT, APP_USER_AGENT);

    if let Some(start) = range_start {
        request = request.header(RANGE, format!("bytes={start}-"));
    }

    if let Some(token) = token {
        request = request
            .bearer_auth(token)
            .header(ACCEPT, "application/octet-stream");
    }

    request
        .send()
        .await
        .map_err(|err| format!("HTTP request failed for {url}: {err}"))
}

async fn resolve_private_asset_api_url(
    client: &Client,
    download: &GithubReleaseDownload,
    token: &str,
) -> Result<Option<String>, String> {
    let release_api_url = format!(
        "https://api.github.com/repos/{}/{}/releases/tags/{}",
        download.owner, download.repo, download.tag
    );

    let release: GithubRelease = client
        .get(&release_api_url)
        .header(USER_AGENT, APP_USER_AGENT)
        .bearer_auth(token)
        .header(ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|err| format!("Failed to resolve private GitHub release: {err}"))?
        .error_for_status()
        .map_err(|err| format!("Failed to resolve private GitHub release: {err}"))?
        .json()
        .await
        .map_err(|err| format!("Failed to parse private GitHub release metadata: {err}"))?;

    Ok(release
        .assets
        .into_iter()
        .find(|asset| asset.name == download.asset_name)
        .map(|asset| asset.url))
}

fn parse_github_release_download(url: &str) -> Option<GithubReleaseDownload> {
    let parsed = Url::parse(url).ok()?;
    if parsed.host_str()? != "github.com" {
        return None;
    }

    let segments: Vec<_> = parsed.path_segments()?.collect();
    if segments.len() < 6 || segments[2] != "releases" || segments[3] != "download" {
        return None;
    }

    Some(GithubReleaseDownload {
        owner: segments[0].to_string(),
        repo: segments[1].to_string(),
        tag: segments[4].to_string(),
        asset_name: segments[5].to_string(),
    })
}

fn github_token() -> Option<String> {
    for key in ["VOX_JOT_GITHUB_TOKEN", "GH_TOKEN"] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    if let Ok(output) = Command::new("gh").args(["auth", "token"]).output() {
        if output.status.success() {
            let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !token.is_empty() {
                return Some(token);
            }
        }
    }

    if let Ok(value) = std::env::var("GITHUB_TOKEN") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::parse_github_release_download;

    #[test]
    fn parses_github_release_download_urls() {
        let parsed = parse_github_release_download(
            "https://github.com/KimaniDJ11/Vox-Jot/releases/download/v0.3.0-tts-models/tts-sherpa-runtime-macos-universal2.tar.gz",
        )
        .expect("should parse");

        assert_eq!(parsed.owner, "KimaniDJ11");
        assert_eq!(parsed.repo, "Vox-Jot");
        assert_eq!(parsed.tag, "v0.3.0-tts-models");
        assert_eq!(
            parsed.asset_name,
            "tts-sherpa-runtime-macos-universal2.tar.gz"
        );
    }

    #[test]
    fn rejects_non_release_urls() {
        assert!(parse_github_release_download("https://github.com/KimaniDJ11/Vox-Jot").is_none());
        assert!(parse_github_release_download("https://example.com/file.tar.gz").is_none());
    }
}
