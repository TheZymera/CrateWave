pub mod downloader;
pub mod processor;

use crate::discovery::{DigMode, SampleCandidate};
use crate::storage::{build_sample_output_path, resolve_samples_dir};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Wav,
    #[serde(rename = "mp3_320")]
    Mp3320,
}

impl ExportFormat {
    pub fn extension(&self) -> &'static str {
        match self {
            ExportFormat::Wav => "wav",
            ExportFormat::Mp3320 => "mp3",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChopJobProgress {
    pub job_id: String,
    pub stage: String,
    pub percent: f32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSample {
    pub job_id: String,
    pub title: String,
    pub master_wav_path: String,
    pub exported_path: String,
    pub duration_sec: f64,
    pub trim_start_sec: f64,
    pub trim_end_sec: f64,
    pub format: ExportFormat,
}

#[tauri::command]
pub async fn load_and_chop_sample(
    app: AppHandle,
    candidate: SampleCandidate,
    mode: DigMode,
    format: ExportFormat,
) -> Result<ActiveSample, String> {
    downloader::download_and_prepare_sample(&app, &candidate, &mode, &format).await
}

#[tauri::command]
pub async fn export_trimmed_sample(
    master_wav_path: String,
    title: String,
    mode: DigMode,
    start_sec: f64,
    end_sec: f64,
    format: ExportFormat,
) -> Result<String, String> {
    let samples_dir = resolve_samples_dir()?;
    let output_path = build_sample_output_path(
        &samples_dir,
        &mode,
        &title,
        start_sec,
        end_sec,
        &format,
    );

    processor::render_trimmed_export(
        &PathBuf::from(&master_wav_path),
        &output_path,
        start_sec,
        end_sec,
        &format,
    )
    .await?;

    Ok(output_path.to_string_lossy().to_string())
}