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

/// Initial fast-dig cap (90 seconds -> ~2.5-4s total load time)
const INITIAL_CAPTURE_SEC: u32 = 90;
/// ~2.8 MB is roughly 90-150s of MP3/OGG/M4A audio from Internet Archive
const INITIAL_IA_MAX_BYTES: u64 = 2_800_000;

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
    #[serde(default)]
    _format: Option<String>,
    size: Option<String>,
}

/// Resolves and downloads audio from Internet Archive's Metadata API (capped when `max_bytes` is Some).
async fn download_internet_archive_direct(
    app: &AppHandle,
    job_id: &str,
    source_url: &str,
    dest_path: &Path,
    max_bytes: Option<u64>,
) -> Result<(), String> {
    let identifier = source_url
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .ok_or_else(|| "Invalid Internet Archive URL".to_string())?;

    let client = reqwest::Client::builder()
        .http1_only()
        .connect_timeout(Duration::from_secs(12))
        .read_timeout(Duration::from_secs(25))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) CrateWave/2.0")
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
        let size_bytes: u64 = f
            .size
            .as_deref()
            .and_then(|s| s.parse().ok())
            .unwrap_or(1_000_000);
        if size_bytes < 15_000 || size_bytes > 180_000_000 {
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
    let target_bytes = match max_bytes {
        Some(cap) if total_bytes > 0 => total_bytes.min(cap),
        Some(cap) => cap,
        None => total_bytes,
    };

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

        if target_bytes > 0 {
            let pct = ((downloaded as f32 / target_bytes as f32) * 100.0).min(100.0);
            let mapped = 10.0 + (pct * 0.62);
            emit_progress(
                app,
                job_id,
                "downloading",
                mapped,
                &format!("Capturing Archive audio... {:.0}%", pct),
            );
        }

        if let Some(cap) = max_bytes {
            if downloaded >= cap {
                break;
            }
        }
    }

    out_file
        .flush()
        .map_err(|e| format!("Disk flush error: {e}"))?;
    Ok(())
}

/// Fast single-pass stream capture: resolves direct audio URL with `yt-dlp --get-url`
/// and captures only `max_seconds` via FFmpeg straight to 44.1kHz PCM WAV.
async fn try_fast_stream_to_wav(
    ytdlp_path: &Path,
    ffmpeg_path: &Path,
    source_url: &str,
    master_wav_path: &Path,
    max_seconds: Option<u32>,
) -> Result<(), String> {
    let mut url_cmd = Command::new(ytdlp_path);
    url_cmd
        .args([
            "-f",
            "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
            "--get-url",
            "--no-playlist",
            "--no-warnings",
        ])
        .arg(source_url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    url_cmd.creation_flags(CREATE_NO_WINDOW);

    let url_out = tokio::time::timeout(Duration::from_secs(12), url_cmd.output())
        .await
        .map_err(|_| "Stream URL resolution timed out".to_string())?
        .map_err(|e| format!("yt-dlp --get-url error: {e}"))?;

    if !url_out.status.success() {
        return Err("yt-dlp --get-url returned non-zero".to_string());
    }

    let stream_url = String::from_utf8_lossy(&url_out.stdout)
        .lines()
        .map(str::trim)
        .find(|l| l.starts_with("http"))
        .ok_or_else(|| "No direct stream URL found".to_string())?
        .to_string();

    let mut ff_cmd = Command::new(ffmpeg_path);
    ff_cmd.args([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-reconnect",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "3",
        "-i",
        &stream_url,
    ]);

    if let Some(secs) = max_seconds {
        ff_cmd.args(["-t", &secs.to_string()]);
    }

    ff_cmd
        .args(["-vn", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le"])
        .arg(master_wav_path)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    ff_cmd.creation_flags(CREATE_NO_WINDOW);

    let ff_out = tokio::time::timeout(Duration::from_secs(35), ff_cmd.output())
        .await
        .map_err(|_| "FFmpeg fast stream capture timed out".to_string())?
        .map_err(|e| format!("FFmpeg stream capture error: {e}"))?;

    if !ff_out.status.success() || !master_wav_path.exists() {
        let err = String::from_utf8_lossy(&ff_out.stderr);
        return Err(format!("FFmpeg fast capture failed: {err}"));
    }

    Ok(())
}

pub async fn download_and_prepare_sample_with_limit(
    app: &AppHandle,
    candidate: &SampleCandidate,
    mode: &DigMode,
    format: &ExportFormat,
    max_seconds: Option<u32>,
) -> Result<ActiveSample, String> {
    let job_id = format!("job_{}", sanitize_filename(&candidate.id));
    emit_progress(app, &job_id, "downloading", 5.0, "Resolving audio stream...");

    let cache_dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("cratewave_cache"));
    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create cache dir: {e}"))?;

    let master_wav_path = cache_dir.join(format!("{}_master.wav", job_id));
    let _ = fs::remove_file(&master_wav_path);

    if candidate.source == "internet_archive" {
        let direct_raw = cache_dir.join(format!("{}_raw.audio", job_id));
        let _ = fs::remove_file(&direct_raw);
        let max_bytes = max_seconds.map(|_| INITIAL_IA_MAX_BYTES);

        download_internet_archive_direct(
            app,
            &job_id,
            &candidate.source_url,
            &direct_raw,
            max_bytes,
        )
        .await?;

        emit_progress(app, &job_id, "decoding", 76.0, "Decoding Master WAV...");
        processor::decode_to_master_wav(&direct_raw, &master_wav_path).await?;
        let _ = fs::remove_file(&direct_raw);
    } else {
        let ytdlp_path = resolve_ytdlp_path(app)?;
        let ffmpeg_path = processor::resolve_ffmpeg_path()?;

        emit_progress(app, &job_id, "downloading", 18.0, "Fast-capturing audio stream...");

        let fast_ok = try_fast_stream_to_wav(
            &ytdlp_path,
            &ffmpeg_path,
            &candidate.source_url,
            &master_wav_path,
            max_seconds,
        )
        .await
        .is_ok();

        if !fast_ok {
            // Fallback: use yt-dlp with `--download-sections` so long videos still cap quickly
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
            .arg(ffmpeg_path.parent().unwrap_or(ffmpeg_path.as_ref()));

            if let Some(secs) = max_seconds {
                let end_m = (secs + 5) / 60;
                let end_s = (secs + 5) % 60;
                cmd.args([
                    "--download-sections",
                    &format!("*0:00-{}:{:02}", end_m, end_s),
                ]);
            }

            cmd.arg("-o")
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
                        let mapped = 20.0 + (pct.clamp(0.0, 100.0) * 0.52);
                        emit_progress(
                            app,
                            &job_id,
                            "downloading",
                            mapped,
                            &format!("Capturing audio... {:.0}%", pct),
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
            let downloaded_file = fs::read_dir(&cache_dir)
                .map_err(|e| format!("Failed to read cache dir: {e}"))?
                .flatten()
                .map(|entry| entry.path())
                .find(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.starts_with(&prefix))
                        .unwrap_or(false)
                })
                .ok_or_else(|| "Downloaded audio file not found in cache".to_string())?;

            emit_progress(app, &job_id, "decoding", 78.0, "Decoding Master WAV...");
            processor::decode_to_master_wav(&downloaded_file, &master_wav_path).await?;
            let _ = fs::remove_file(&downloaded_file);
        }
    }

    emit_progress(app, &job_id, "decoding", 88.0, "Probing waveform duration...");
    let duration_sec = processor::probe_duration_sec(&master_wav_path)
        .await
        .unwrap_or_else(|_| (candidate.duration_sec.max(1)) as f64);

    let initial_trim_end = duration_sec.min(16.0);

    emit_progress(app, &job_id, "decoding", 94.0, "Preparing initial loop slice...");
    let samples_dir = resolve_samples_dir()?;
    let exported_path = build_sample_output_path(
        &samples_dir,
        mode,
        &candidate.title,
        0.0,
        initial_trim_end,
        format,
    );

    processor::render_trimmed_export(
        &master_wav_path,
        &exported_path,
        0.0,
        initial_trim_end,
        format,
    )
    .await?;

    emit_progress(app, &job_id, "ready", 100.0, "Ready to spin & chop");

    Ok(ActiveSample {
        job_id,
        title: candidate.title.clone(),
        master_wav_path: master_wav_path.to_string_lossy().to_string(),
        exported_path: exported_path.to_string_lossy().to_string(),
        duration_sec,
        trim_start_sec: 0.0,
        trim_end_sec: initial_trim_end,
        format: format.clone(),
    })
}

pub async fn download_and_prepare_sample(
    app: &AppHandle,
    candidate: &SampleCandidate,
    mode: &DigMode,
    format: &ExportFormat,
) -> Result<ActiveSample, String> {
    download_and_prepare_sample_with_limit(
        app,
        candidate,
        mode,
        format,
        Some(INITIAL_CAPTURE_SEC),
    )
    .await
}

pub async fn extend_and_prepare_full_sample(
    app: &AppHandle,
    candidate: &SampleCandidate,
    mode: &DigMode,
    format: &ExportFormat,
) -> Result<ActiveSample, String> {
    download_and_prepare_sample_with_limit(app, candidate, mode, format, None).await
}