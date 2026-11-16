use crate::discovery::{SampleCandidate, SearchFilters};
use serde::Deserialize;
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::process::Command;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Deserialize)]
struct YtDlpFlatEntry {
    id: Option<String>,
    title: Option<String>,
    uploader: Option<String>,
    channel: Option<String>,
    duration: Option<f64>,
    url: Option<String>,
    webpage_url: Option<String>,
    thumbnail: Option<String>,
}

pub fn resolve_ytdlp_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(data_dir) = app.path().app_data_dir() {
        let bin_name = if cfg!(target_os = "windows") {
            "yt-dlp.exe"
        } else {
            "yt-dlp"
        };
        let updated = data_dir.join("bin").join(bin_name);
        if updated.exists() {
            return Ok(updated);
        }
    }

    let exe_dir = std::env::current_exe()
        .map_err(|e| format!("Failed to get current_exe: {e}"))?
        .parent()
        .ok_or_else(|| "Failed to get executable parent directory".to_string())?
        .to_path_buf();

    let candidates = if cfg!(target_os = "windows") {
        vec![
            exe_dir.join("yt-dlp.exe"),
            exe_dir.join("yt-dlp-x86_64-pc-windows-msvc.exe"),
            PathBuf::from("src-tauri/binaries/yt-dlp-x86_64-pc-windows-msvc.exe"),
            PathBuf::from("binaries/yt-dlp-x86_64-pc-windows-msvc.exe"),
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            exe_dir.join("yt-dlp"),
            exe_dir.join("yt-dlp-aarch64-apple-darwin"),
            exe_dir.join("yt-dlp-x86_64-apple-darwin"),
        ]
    } else {
        vec![
            exe_dir.join("yt-dlp"),
            exe_dir.join("yt-dlp-x86_64-unknown-linux-gnu"),
        ]
    };

    for path in candidates {
        if path.exists() {
            return Ok(path);
        }
    }

    Err("Bundled yt-dlp binary not found".to_string())
}

fn matches_duration_filter(duration_sec: u32, filter: &str, is_world_adventure: bool) -> bool {
    if is_world_adventure || filter == "any" || filter.is_empty() {
        return duration_sec >= 5 && duration_sec <= 1800;
    }

    match filter {
        "shorts" => duration_sec > 0 && duration_sec <= 65,
        "medium" => duration_sec > 60 && duration_sec <= 300,
        "long" => duration_sec > 300 && duration_sec <= 1800,
        _ => true,
    }
}

/// Strips 4-digit years and YouTube-only vinyl modifiers so SoundCloud returns rich results on the first try.
fn clean_query_for_soundcloud(query: &str) -> String {
    let yt_only_phrases = [
        "vinyl rip",
        "rare groove",
        "full album track",
        "obscure record",
        "original pressing",
        "deep cut",
        "studio session",
        "#shorts",
    ];

    let mut cleaned = query.to_lowercase();
    for phrase in yt_only_phrases {
        cleaned = cleaned.replace(phrase, " ");
    }

    let words: Vec<&str> = cleaned
        .split_whitespace()
        .filter(|w| !(w.len() == 4 && w.chars().all(|c| c.is_ascii_digit())))
        .collect();

    if words.is_empty() {
        "rare groove instrumental".to_string()
    } else {
        words.join(" ")
    }
}

pub async fn search_youtube_flat(
    app: &AppHandle,
    query: &str,
    query_tag: &str,
    filters: &SearchFilters,
    seen_ids: &HashSet<String>,
) -> Result<Vec<SampleCandidate>, String> {
    let ytdlp_path = resolve_ytdlp_path(app)?;
    let search_depth = if query == "sample this vocal #shorts" {
        "ytsearch30"
    } else {
        "ytsearch12"
    };
    let search_arg = format!("{}:{}", search_depth, query);

    let mut cmd = Command::new(&ytdlp_path);
    cmd.args([
        "--flat-playlist",
        "--dump-json",
        "--no-warnings",
        "--ignore-errors",
        &search_arg,
    ]);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to spawn yt-dlp search: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let is_world = filters.mode == crate::discovery::DigMode::WorldAdventure;
    let mut results = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Ok(entry) = serde_json::from_str::<YtDlpFlatEntry>(trimmed) else {
            continue;
        };

        let Some(id) = entry.id else {
            continue;
        };

        if seen_ids.contains(&id) {
            continue;
        }

        let duration_sec = entry.duration.unwrap_or(0.0).round() as u32;
        if !matches_duration_filter(duration_sec, &filters.duration, is_world) {
            continue;
        }

        let source_url = entry
            .webpage_url
            .or(entry.url)
            .unwrap_or_else(|| format!("https://www.youtube.com/watch?v={}", id));

        let thumbnail_url = entry
            .thumbnail
            .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", id));

        let title = entry.title.unwrap_or_else(|| "Untitled Track".to_string());
        let channel = entry
            .channel
            .or(entry.uploader)
            .unwrap_or_else(|| "Unknown Artist".to_string());

        results.push(SampleCandidate {
            id,
            source: "youtube".to_string(),
            title,
            channel,
            duration_sec,
            thumbnail_url,
            source_url,
            query_tag: query_tag.to_string(),
        });
    }

    Ok(results)
}

pub async fn search_soundcloud_flat(
    app: &AppHandle,
    query: &str,
    query_tag: &str,
    filters: &SearchFilters,
    seen_ids: &HashSet<String>,
) -> Result<Vec<SampleCandidate>, String> {
    let ytdlp_path = resolve_ytdlp_path(app)?;
    let sc_query = clean_query_for_soundcloud(query);
    let search_arg = format!("scsearch10:{}", sc_query);

    let mut cmd = Command::new(&ytdlp_path);
    cmd.args([
        "--flat-playlist",
        "--dump-json",
        "--no-warnings",
        "--ignore-errors",
        &search_arg,
    ]);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to spawn SoundCloud search: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let is_world = filters.mode == crate::discovery::DigMode::WorldAdventure;
    let mut results = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Ok(entry) = serde_json::from_str::<YtDlpFlatEntry>(trimmed) else {
            continue;
        };

        let Some(raw_id) = entry.id else {
            continue;
        };
        let cid = format!("sc_{}", raw_id);

        if seen_ids.contains(&cid) {
            continue;
        }

        let duration_sec = entry.duration.unwrap_or(0.0).round() as u32;
        if !matches_duration_filter(duration_sec, &filters.duration, is_world) {
            continue;
        }

        let Some(source_url) = entry.webpage_url.or(entry.url) else {
            continue;
        };

        let title = entry.title.unwrap_or_else(|| "SoundCloud Track".to_string());
        let channel = entry
            .channel
            .or(entry.uploader)
            .unwrap_or_else(|| "SoundCloud Artist".to_string());

        results.push(SampleCandidate {
            id: cid,
            source: "soundcloud".to_string(),
            title,
            channel,
            duration_sec,
            thumbnail_url: entry.thumbnail.unwrap_or_default(),
            source_url,
            query_tag: format!("{} • SC", query_tag),
        });
    }

    Ok(results)
}

#[tauri::command]
pub async fn update_ytdlp_binary(app: AppHandle) -> Result<String, String> {
    let ytdlp_path = resolve_ytdlp_path(&app)?;
    let mut cmd = Command::new(&ytdlp_path);
    cmd.arg("-U");

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run yt-dlp -U: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        Ok(if stdout.is_empty() { "yt-dlp is up to date".to_string() } else { stdout })
    } else {
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}