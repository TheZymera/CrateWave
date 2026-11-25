use crate::audio::ExportFormat;
use crate::discovery::DigMode;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub samples_dir: String,
    pub seen_count: usize,
}

/// Resolves `~/Music/My Samples` (or fallback in user home) and creates it if missing.
pub fn resolve_samples_dir() -> Result<PathBuf, String> {
    let base = dirs::audio_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| "Could not resolve user Music or Home directory".to_string())?;

    let samples_dir = base.join("My Samples");
    fs::create_dir_all(&samples_dir)
        .map_err(|e| format!("Failed to create My Samples directory: {e}"))?;

    Ok(samples_dir)
}

fn seen_ids_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app_data_dir: {e}"))?;
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create app_data_dir: {e}"))?;
    Ok(data_dir.join("seen_ids.json"))
}

pub fn load_seen_ids(app: &AppHandle) -> HashSet<String> {
    let Ok(path) = seen_ids_path(app) else {
        return HashSet::new();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<HashSet<String>>(&raw).ok())
        .unwrap_or_default()
}

pub fn mark_ids_seen(app: &AppHandle, new_ids: &[String]) -> Result<usize, String> {
    let path = seen_ids_path(app)?;
    let mut seen = load_seen_ids(app);
    for id in new_ids {
        seen.insert(id.clone());
    }
    let json = serde_json::to_string_pretty(&seen)
        .map_err(|e| format!("Failed to serialize seen_ids: {e}"))?;
    fs::write(path, json).map_err(|e| format!("Failed to write seen_ids.json: {e}"))?;
    Ok(seen.len())
}

fn quarantined_ids_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app_data_dir: {e}"))?;
    fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create app_data_dir: {e}"))?;
    Ok(data_dir.join("quarantined_ids.json"))
}

pub fn load_quarantined_ids(app: &AppHandle) -> HashSet<String> {
    let Ok(path) = quarantined_ids_path(app) else {
        return HashSet::new();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<HashSet<String>>(&raw).ok())
        .unwrap_or_default()
}

pub fn quarantine_id(app: &AppHandle, bad_id: &str) -> Result<(), String> {
    let path = quarantined_ids_path(app)?;
    let mut set = load_quarantined_ids(app);
    set.insert(bad_id.to_string());
    let json = serde_json::to_string_pretty(&set)
        .map_err(|e| format!("Failed to serialize quarantined_ids: {e}"))?;
    fs::write(path, json).map_err(|e| format!("Failed to write quarantined_ids.json: {e}"))?;
    Ok(())
}

/// Strips Windows/POSIX illegal filename characters and collapses whitespace.
pub fn sanitize_filename(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();

    let collapsed: String = cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("_");

    let trimmed = collapsed.trim_matches(|c| c == '.' || c == '_' || c == ' ');
    let limited: String = trimmed.chars().take(64).collect();

    if limited.is_empty() {
        "Untitled_Sample".to_string()
    } else {
        limited
    }
}

fn format_mm_ss(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    let mins = total / 60;
    let secs = total % 60;
    format!("{:02}m{:02}s", mins, secs)
}

/// Builds `[Mode]_[SanitizedTitle]_[MMmSSs-MMmSSs].[wav|mp3]` inside `My Samples`.
pub fn build_sample_output_path(
    samples_dir: &Path,
    mode: &DigMode,
    title: &str,
    start_sec: f64,
    end_sec: f64,
    format: &ExportFormat,
) -> PathBuf {
    let mode_prefix = match mode {
        DigMode::General => "General",
        DigMode::WorldAdventure => "World",
        DigMode::OnlyVocal => "Vocal",
        DigMode::OnlyInstrumental => "Inst",
    };

    let safe_title = sanitize_filename(title);
    let range = format!("{}-{}", format_mm_ss(start_sec), format_mm_ss(end_sec));
    let file_name = format!(
        "{}_{}_{}.{}",
        mode_prefix,
        safe_title,
        range,
        format.extension()
    );

    samples_dir.join(file_name)
}

#[tauri::command]
pub fn init_storage(app: AppHandle) -> Result<StorageInfo, String> {
    let dir = resolve_samples_dir()?;
    let _ = crate::discovery::query_builder::load_or_init_dictionary(&app);

    let saved_files = fs::read_dir(&dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| {
                    e.path()
                        .extension()
                        .and_then(|ext| ext.to_str())
                        .map(|ext| ext.eq_ignore_ascii_case("wav") || ext.eq_ignore_ascii_case("mp3"))
                        .unwrap_or(false)
                })
                .count()
        })
        .unwrap_or(0);

    Ok(StorageInfo {
        samples_dir: dir.to_string_lossy().to_string(),
        seen_count: saved_files,
    })
}

#[tauri::command]
pub fn get_drag_icon_path(app: AppHandle) -> Result<String, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("cratewave_cache"));
    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create cache dir: {e}"))?;

    let icon_path = cache_dir.join("drag_sample_icon.png");
    if !icon_path.exists() {
        // Minimal valid 1x1 coral-tinted PNG placeholder for OS drag ghost
        const MINIMAL_PNG: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
            0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
            0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
            0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D, 0xB0, 0x00, 0x00, 0x00,
            0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        fs::write(&icon_path, MINIMAL_PNG)
            .map_err(|e| format!("Failed to write drag icon: {e}"))?;
    }

    Ok(icon_path.to_string_lossy().to_string())
}

use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn open_samples_folder(app: AppHandle) -> Result<(), String> {
    let dir = resolve_samples_dir()?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open My Samples folder: {e}"))
}