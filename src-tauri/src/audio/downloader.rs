use crate::audio::{processor, ActiveSample, ChopJobProgress, ExportFormat};
use crate::discovery::ytdlp_search::resolve_ytdlp_path;
use crate::discovery::{DigMode, SampleCandidate};
use crate::storage::sanitize_filename;
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

const INITIAL_CAPTURE_SEC: u32 = 45;
const INITIAL_DIRECT_MAX_BYTES: u64 = 2_400_000;

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
    size: Option<String>,
}

/// Fast local FFmpeg decode (slices first `max_seconds` on disk in ~0.1s)
async fn decode_local_to_wav(
    input_path: &Path,
    output_wav_path: &Path,
    max_seconds: Option<u32>,
) -> Result<(), String> {
    let ffmpeg_path = processor::resolve_ffmpeg_path()?;
    let mut cmd = Command::new(ffmpeg_path);
    cmd.args(["-y", "-hide_banner", "-loglevel", "error", "-i"])
        .arg(input_path);

    if let Some(secs) = max_seconds {
        cmd.args(["-t", &secs.to_string()]);
    }

    cmd.args(["-vn", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le"])
        .arg(output_wav_path)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run FFmpeg: {e}"))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("FFmpeg decode failed: {err}"));
    }
    Ok(())
}

/// Downloads a direct HTTP audio stream (.mp3, .ogg, .wav, .flac) via reqwest
async fn download_direct_http_stream(
    app: &AppHandle,
    job_id: &str,
    url: &str,
    dest_path: &Path,
    max_bytes: Option<u64>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .read_timeout(Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) CrateWave/2.0")
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let resp = client
        .get(url)
        .header("Accept-Encoding", "identity")
        .header("Referer", "https://ccmixter.org/")
        .send()
        .await
        .map_err(|e| format!("Direct audio stream error: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Direct audio HTTP {}", resp.status()));
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
            emit_progress(
                app,
                job_id,
                "downloading",
                12.0 + pct * 0.6,
                &format!("Streaming audio... {:.0}%", pct),
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
        .connect_timeout(Duration::from_secs(8))
        .read_timeout(Duration::from_secs(15))
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

    // Prioritize frame-streamable formats (.mp3, .ogg, .wav) that decode cleanly when byte-capped
    let priority_exts = [".mp3", ".ogg", ".wav", ".flac", ".m4a"];
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
        if size_bytes < 20_000 || size_bytes > 160_000_000 {
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

    let (chosen, rank) = best_file
        .ok_or_else(|| "No downloadable audio file found in this Internet Archive item".to_string())?;

    let encoded_name = chosen.name.replace(' ', "%20");
    let direct_url = format!("https://archive.org/download/{}/{}", identifier, encoded_name);

    // Only byte-cap streamable formats (.mp3/.ogg); .m4a needs its trailing moov atom
    let effective_cap = if rank <= 1 { max_bytes } else { None };
    download_direct_http_stream(app, job_id, &direct_url, dest_path, effective_cap).await
}

fn is_direct_audio_url(url: &str) -> bool {
    let clean = url.split('?').next().unwrap_or(url).to_lowercase();
    clean.ends_with(".mp3") || clean.ends_with(".ogg") || clean.ends_with(".wav")
}

pub async fn download_and_prepare_sample_with_limit(
    app: &AppHandle,
    candidate: &SampleCandidate,
    _mode: &DigMode,
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
        let max_bytes = max_seconds.map(|_| INITIAL_DIRECT_MAX_BYTES);

        download_internet_archive_direct(
            app,
            &job_id,
            &candidate.source_url,
            &direct_raw,
            max_bytes,
        )
        .await?;

        emit_progress(app, &job_id, "decoding", 78.0, "Decoding Master WAV...");
        decode_local_to_wav(&direct_raw, &master_wav_path, max_seconds).await?;
        let _ = fs::remove_file(&direct_raw);
    } else if candidate.source == "ccmixter" || is_direct_audio_url(&candidate.source_url) {
        let direct_raw = cache_dir.join(format!("{}_raw.audio", job_id));
        let _ = fs::remove_file(&direct_raw);
        let max_bytes = max_seconds.map(|_| INITIAL_DIRECT_MAX_BYTES);

        download_direct_http_stream(
            app,
            &job_id,
            &candidate.source_url,
            &direct_raw,
            max_bytes,
        )
        .await?;

        emit_progress(app, &job_id, "decoding", 78.0, "Decoding Master WAV...");
        decode_local_to_wav(&direct_raw, &master_wav_path, max_seconds).await?;
        let _ = fs::remove_file(&direct_raw);
    } else {
        let ytdlp_path = resolve_ytdlp_path(app)?;
        let ffmpeg_path = processor::resolve_ffmpeg_path()?;
        let raw_template = cache_dir.join(format!("{}_raw.%(ext)s", job_id));

        let mut cmd = Command::new(&ytdlp_path);
        cmd.args([
            "-f",
            "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
            "--no-playlist",
            "--no-part",
            "--concurrent-fragments",
            "4",
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
                    let mapped = 15.0 + (pct.clamp(0.0, 100.0) * 0.58);
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

        let output = tokio::time::timeout(Duration::from_secs(20), child.wait_with_output())
            .await
            .map_err(|_| "Track download timed out".to_string())?
            .map_err(|e| format!("yt-dlp process error: {e}"))?;

        if !output.status.success() {
            let err_line = String::from_utf8_lossy(&output.stderr)
                .lines()
                .last()
                .unwrap_or("unknown error")
                .to_string();
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

        emit_progress(app, &job_id, "decoding", 80.0, "Decoding Master WAV...");
        let decode_res = decode_local_to_wav(&downloaded_file, &master_wav_path, max_seconds).await;
        let _ = fs::remove_file(&downloaded_file);
        decode_res?;
    }

    let wav_bytes = fs::metadata(&master_wav_path)
        .map(|m| m.len())
        .unwrap_or(0);
    if wav_bytes <= 44_100 {
        let _ = fs::remove_file(&master_wav_path);
        return Err("Decoded WAV is empty or too short".to_string());
    }

    emit_progress(app, &job_id, "decoding", 92.0, "Probing waveform duration...");
    let duration_sec = processor::probe_duration_sec(&master_wav_path)
        .await
        .map_err(|e| format!("Invalid WAV file: {e}"))?;

    let initial_trim_end = duration_sec.min(16.0);
    let master_str = master_wav_path.to_string_lossy().to_string();

    emit_progress(app, &job_id, "ready", 100.0, "Ready to spin & chop");

    Ok(ActiveSample {
        job_id,
        title: candidate.title.clone(),
        master_wav_path: master_str.clone(),
        exported_path: master_str,
        stream_url: String::new(),
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