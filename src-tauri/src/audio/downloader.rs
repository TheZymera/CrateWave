use crate::audio::{processor, ActiveSample, ChopJobProgress, ExportFormat};
use crate::discovery::ytdlp_search::resolve_ytdlp_path;
use crate::discovery::{DigMode, SampleCandidate};
use crate::storage::sanitize_filename;
use futures_util::StreamExt;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const INITIAL_CAPTURE_SEC: u32 = 45;
const INITIAL_DIRECT_MAX_BYTES: u64 = 2_400_000;
const MAX_CACHED_WAVS: usize = 12;

static STREAM_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn stream_http_client() -> &'static reqwest::Client {
    STREAM_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .http1_only()
            .pool_max_idle_per_host(8)
            .connect_timeout(Duration::from_secs(6))
            .read_timeout(Duration::from_secs(10))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) CrateWave/2.0")
            .build()
            .expect("Failed to build streaming HTTP client")
    })
}

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

/// Keeps disk usage bounded by removing oldest `*_master.wav` files beyond `MAX_CACHED_WAVS`.
fn prune_audio_cache(cache_dir: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(cache_dir) else { return };
    let mut wavs: Vec<(SystemTime, std::path::PathBuf)> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.ends_with("_master.wav"))
                .unwrap_or(false)
        })
        .map(|p| {
            let mtime = fs::metadata(&p)
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            (mtime, p)
        })
        .collect();

    if wavs.len() <= keep {
        return;
    }
    wavs.sort_by_key(|(t, _)| *t);
    let to_remove = wavs.len() - keep;
    for (_, old_path) in wavs.into_iter().take(to_remove) {
        let _ = fs::remove_file(old_path);
    }
}

/// Downloads a direct HTTP audio stream (iTunes, Deezer, Openverse, MP3/M4A/OGG/WAV)
async fn download_direct_http_stream(
    app: &AppHandle,
    job_id: &str,
    url: &str,
    dest_path: &Path,
    max_bytes: Option<u64>,
) -> Result<(), String> {
    let req = stream_http_client()
        .get(url)
        .header("Accept-Encoding", "identity");

    let resp = tokio::time::timeout(Duration::from_secs(7), req.send())
        .await
        .map_err(|_| "Direct audio stream timed out (7s)".to_string())?
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

fn is_direct_audio_url(url: &str) -> bool {
    let clean = url.split('?').next().unwrap_or(url).to_lowercase();
    clean.ends_with(".mp3")
        || clean.ends_with(".m4a")
        || clean.ends_with(".ogg")
        || clean.ends_with(".wav")
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

    prune_audio_cache(&cache_dir, MAX_CACHED_WAVS);

    let master_wav_path = cache_dir.join(format!("{}_master.wav", job_id));
    let _ = fs::remove_file(&master_wav_path);

    if matches!(candidate.source.as_str(), "itunes" | "deezer") {
        // 30s studio CDN previews (~480KB): download complete file so M4A moov atom stays intact
        let ext = if candidate.source == "itunes" { "m4a" } else { "mp3" };
        let direct_raw = cache_dir.join(format!("{}_raw.{ext}", job_id));
        let _ = fs::remove_file(&direct_raw);

        download_direct_http_stream(app, &job_id, &candidate.source_url, &direct_raw, None).await?;

        emit_progress(app, &job_id, "decoding", 78.0, "Conditioning Master WAV...");
        let decode_res =
            processor::decode_and_condition_wav(&direct_raw, &master_wav_path, max_seconds).await;
        let _ = fs::remove_file(&direct_raw);
        decode_res?;
    } else if candidate.source == "openverse" || is_direct_audio_url(&candidate.source_url) {
        let direct_raw = cache_dir.join(format!("{}_raw.audio", job_id));
        let _ = fs::remove_file(&direct_raw);

        let clean_url = candidate
            .source_url
            .split('?')
            .next()
            .unwrap_or(&candidate.source_url)
            .to_lowercase();
        let can_byte_cap = clean_url.ends_with(".mp3") || clean_url.ends_with(".ogg");
        let max_bytes = if can_byte_cap {
            max_seconds.map(|_| INITIAL_DIRECT_MAX_BYTES)
        } else {
            None
        };

        download_direct_http_stream(
            app,
            &job_id,
            &candidate.source_url,
            &direct_raw,
            max_bytes,
        )
        .await?;

        emit_progress(app, &job_id, "decoding", 78.0, "Conditioning Master WAV...");
        let decode_res =
            processor::decode_and_condition_wav(&direct_raw, &master_wav_path, max_seconds).await;
        let _ = fs::remove_file(&direct_raw);
        decode_res?;
    } else {
        // YouTube via yt-dlp with fast partial capture (*0-48s) so it never downloads full 20-min audio
        let ytdlp_path = resolve_ytdlp_path(app)?;
        let ffmpeg_path = processor::resolve_ffmpeg_path()?;
        let raw_template = cache_dir.join(format!("{}_raw.%(ext)s", job_id));

        let mut cmd = Command::new(&ytdlp_path);
        cmd.args([
            "-f",
            "bestaudio[filesize<10M]/bestaudio[abr<=160]/bestaudio[ext=m4a]/bestaudio",
            "--no-playlist",
            "--no-part",
            "--socket-timeout",
            "5",
            "--concurrent-fragments",
            "4",
            "--newline",
            "--progress",
            "--no-warnings",
            "--ffmpeg-location",
        ])
        .arg(ffmpeg_path.parent().unwrap_or(ffmpeg_path.as_ref()));

        if candidate.source == "youtube" {
            if let Some(secs) = max_seconds {
                cmd.args(["--download-sections", &format!("*0-{}", secs + 6)]);
            }
        }

        cmd.arg("-o")
            .arg(&raw_template)
            .arg(&candidate.source_url)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

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

        let output = tokio::time::timeout(Duration::from_secs(14), child.wait_with_output())
            .await
            .map_err(|_| "YouTube download timed out (14s)".to_string())?
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

        emit_progress(app, &job_id, "decoding", 80.0, "Conditioning Master WAV...");
        let decode_res =
            processor::decode_and_condition_wav(&downloaded_file, &master_wav_path, max_seconds)
                .await;
        let _ = fs::remove_file(&downloaded_file);
        decode_res?;
    }

    let wav_bytes = fs::metadata(&master_wav_path)
        .map(|m| m.len())
        .unwrap_or(0);
    if wav_bytes <= 176_400 {
        let _ = fs::remove_file(&master_wav_path);
        return Err("Decoded WAV is silent, empty, or too short".to_string());
    }

    emit_progress(app, &job_id, "decoding", 92.0, "Probing waveform duration...");
    let duration_sec = processor::probe_duration_sec(&master_wav_path)
        .await
        .map_err(|e| format!("Invalid WAV file: {e}"))?;

    if duration_sec < 1.5 {
        let _ = fs::remove_file(&master_wav_path);
        return Err(format!("Track too short after silence trim ({duration_sec:.2}s)"));
    }

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