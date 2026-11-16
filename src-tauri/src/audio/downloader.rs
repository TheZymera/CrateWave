use crate::audio::{processor, ActiveSample, ChopJobProgress, ExportFormat};
use crate::discovery::ytdlp_search::resolve_ytdlp_path;
use crate::discovery::{DigMode, SampleCandidate};
use crate::storage::{build_sample_output_path, resolve_samples_dir, sanitize_filename};
use futures_util::StreamExt;
use serde::Deserialize;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn emit_progress(app: &AppHandle, job_id: &str, stage: &str, percent: f32, message: &str) {
    let payload = ChopJobProgress {
        job_id: job_id.to_string(),
        stage: stage.to_string(),
        percent,
        message: message.to_string(),
    };
    let _ = app.emit("chop-progress", payload);
}

fn parse_ytdlp_percent(line: &str) -> Option<f32> {
    let idx = line.find('%')?;
    let prefix = &line[..idx];
    let num_str = prefix.split_whitespace().last()?;
    num_str.parse::<f32>().ok()
}

#[derive(Debug, Deserialize)]
struct IaFilesResponse {
    result: Option<Vec<IaFileEntry>>,
}

#[derive(Debug, Deserialize)]
struct IaFileEntry {
    name: String,
    format: Option<String>,
    size: Option<String>,
}

/// Resolves and downloads the best direct audio file from Internet Archive's Metadata API.
async fn download_internet_archive_direct(
    app: &AppHandle,
    job_id: &str,
    source_url: &str,
    dest_path: &Path,
) -> Result<(), String> {
    let identifier = source_url
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .ok_or_else(|| "Invalid Internet Archive URL".to_string())?;

    let client = reqwest::Client::builder()
        .http1_only()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) CrateWave/1.0")
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    emit_progress(app, job_id, "downloading", 8.0, "Fetching Archive tracklist...");

    let meta_url = format!("https://archive.org/metadata/{}/files", identifier);
    let meta: IaFilesResponse = client
        .get(&meta_url)
        .header("Accept-Encoding", "identity")
        .send()
        .await
        .map_err(|e| format!("Archive metadata error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Archive metadata parse error: {e}"))?;

    let files = meta.result.unwrap_or_default();

    let priority_exts = [".mp3", ".m4a", ".ogg", ".flac", ".wav"];
    let mut best_file: Option<(&IaFileEntry, usize)> = None;

    for f in &files {
        let lower = f.name.to_lowercase();
        if lower.ends_with("_spectrogram.png") || lower.contains(".thumbs/") {
            continue;
        }
        let size_bytes: u64 = f.size.as_deref().and_then(|s| s.parse().ok()).unwrap_or(1_000_000);
        if size_bytes < 15_000 || size_bytes > 120_000_000 {
            continue;
        }

        if let Some(rank) = priority_exts.iter().position(|ext| lower.ends_with(ext)) {
            match best_file {
                None => best_file = Some((f, rank)),
                Some((_, best_rank)) if rank < best_rank => best_file = Some((f, rank)),
                _ => {}
            }
        }
    }

    let (chosen, _) = best_file
        .ok_or_else(|| "No downloadable audio file found in this Internet Archive item".to_string())?;

    let encoded_name = chosen.name.replace(' ', "%20");
    let direct_url = format!("https://archive.org/download/{}/{}", identifier, encoded_name);

    let resp = client
        .get(&direct_url)
        .header("Accept-Encoding", "identity")
        .send()
        .await
        .map_err(|e| format!("Archive stream error: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Archive download HTTP {}", resp.status()));
    }

    let total_bytes = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut out_file =
        fs::File::create(dest_path).map_err(|e| format!("Failed to create temp file: {e}"))?;

    let mut stream = resp.bytes_stream();
    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("Stream read error: {e}"))?;
        out_file
            .write_all(&chunk)
            .map_err(|e| format!("Disk write error: {e}"))?;
        downloaded += chunk.len() as u64;

        if total_bytes > 0 {
            let pct = (downloaded as f32 / total_bytes as f32) * 100.0;
            let mapped = 10.0 + (pct.clamp(0.0, 100.0) * 0.62);
            emit_progress(
                app,
                job_id,
                "downloading",
                mapped,
                &format!("Downloading from Archive... {:.0}%", pct),
            );
        }
    }

    Ok(())
}

pub async fn download_and_prepare_sample(
    app: &AppHandle,
    candidate: &SampleCandidate,
    mode: &DigMode,
    format: &ExportFormat,
) -> Result<ActiveSample, String> {
    let job_id = format!("job_{}", sanitize_filename(&candidate.id));
    emit_progress(app, &job_id, "downloading", 4.0, "Resolving audio stream...");

    let cache_dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("cratewave_cache"));
    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create cache dir: {e}"))?;

    let master_wav_path = cache_dir.join(format!("{}_master.wav", job_id));
    let _ = fs::remove_file(&master_wav_path);

    let downloaded_file = if candidate.source == "internet_archive" {
        let direct_raw = cache_dir.join(format!("{}_raw.audio", job_id));
        let _ = fs::remove_file(&direct_raw);
        download_internet_archive_direct(app, &job_id, &candidate.source_url, &direct_raw).await?;
        direct_raw
    } else {
        let ytdlp_path = resolve_ytdlp_path(app)?;
        let ffmpeg_path = processor::resolve_ffmpeg_path()?;
        let raw_template = cache_dir.join(format!("{}_raw.%(ext)s", job_id));

        let mut cmd = Command::new(&ytdlp_path);
        cmd.args([
            "-f",
            "bestaudio/best",
            "--no-playlist",
            "--newline",
            "--progress",
            "--no-warnings",
            "--ffmpeg-location",
        ])
        .arg(ffmpeg_path.parent().unwrap_or(ffmpeg_path.as_ref()))
        .arg("-o")
        .arg(&raw_template)
        .arg(&candidate.source_url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start yt-dlp download: {e}"))?;

        if let Some(stdout) = child.stdout.take() {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(pct) = parse_ytdlp_percent(&line) {
                    let mapped = 5.0 + (pct.clamp(0.0, 100.0) * 0.67);
                    emit_progress(
                        app,
                        &job_id,
                        "downloading",
                        mapped,
                        &format!("Downloading audio... {:.0}%", pct),
                    );
                }
            }
        }

        let output = child
            .wait_with_output()
            .await
            .map_err(|e| format!("yt-dlp process error: {e}"))?;

        if !output.status.success() {
            let err_line = String::from_utf8_lossy(&output.stderr)
                .lines()
                .last()
                .unwrap_or("unknown error")
                .to_string();
            emit_progress(app, &job_id, "error", 0.0, "Download failed");
            return Err(format!("yt-dlp download failed: {err_line}"));
        }

        let prefix = format!("{}_raw.", job_id);
        fs::read_dir(&cache_dir)
            .map_err(|e| format!("Failed to read cache dir: {e}"))?
            .flatten()
            .map(|entry| entry.path())
            .find(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with(&prefix))
                    .unwrap_or(false)
            })
            .ok_or_else(|| "Downloaded audio file not found in cache".to_string())?
    };

    emit_progress(app, &job_id, "decoding", 78.0, "Decoding Master WAV...");
    processor::decode_to_master_wav(&downloaded_file, &master_wav_path).await?;
    let _ = fs::remove_file(&downloaded_file);

    emit_progress(app, &job_id, "decoding", 90.0, "Probing waveform duration...");
    let duration_sec = processor::probe_duration_sec(&master_wav_path)
        .await
        .unwrap_or_else(|_| (candidate.duration_sec.max(1)) as f64);

    emit_progress(app, &job_id, "decoding", 95.0, "Writing initial sample to My Samples...");
    let samples_dir = resolve_samples_dir()?;
    let exported_path = build_sample_output_path(
        &samples_dir,
        mode,
        &candidate.title,
        0.0,
        duration_sec,
        format,
    );

    processor::render_trimmed_export(
        &master_wav_path,
        &exported_path,
        0.0,
        duration_sec,
        format,
    )
    .await?;

    emit_progress(app, &job_id, "ready", 100.0, "Ready to chop & drag");

    Ok(ActiveSample {
        job_id,
        title: candidate.title.clone(),
        master_wav_path: master_wav_path.to_string_lossy().to_string(),
        exported_path: exported_path.to_string_lossy().to_string(),
        duration_sec,
        trim_start_sec: 0.0,
        trim_end_sec: duration_sec,
        format: format.clone(),
    })
}