use crate::audio::ExportFormat;
use std::path::{Path, PathBuf};
use tokio::process::Command;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn resolve_sidecar_binary(base_name: &str) -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe()
        .map_err(|e| format!("Failed to get current_exe: {e}"))?
        .parent()
        .ok_or_else(|| "Failed to get executable parent directory".to_string())?
        .to_path_buf();

    let candidates = if cfg!(target_os = "windows") {
        vec![
            exe_dir.join(format!("{base_name}.exe")),
            exe_dir.join(format!("{base_name}-x86_64-pc-windows-msvc.exe")),
            PathBuf::from(format!("src-tauri/binaries/{base_name}-x86_64-pc-windows-msvc.exe")),
            PathBuf::from(format!("binaries/{base_name}-x86_64-pc-windows-msvc.exe")),
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            exe_dir.join(base_name),
            exe_dir.join(format!("{base_name}-aarch64-apple-darwin")),
            exe_dir.join(format!("{base_name}-x86_64-apple-darwin")),
        ]
    } else {
        vec![
            exe_dir.join(base_name),
            exe_dir.join(format!("{base_name}-x86_64-unknown-linux-gnu")),
        ]
    };

    for path in candidates {
        if path.exists() {
            return Ok(path);
        }
    }

    Err(format!("Bundled {base_name} binary not found"))
}

pub fn resolve_ffmpeg_path() -> Result<PathBuf, String> {
    resolve_sidecar_binary("ffmpeg")
}

pub fn resolve_ffprobe_path() -> Result<PathBuf, String> {
    resolve_sidecar_binary("ffprobe")
}

/// Probes exact audio duration in seconds using `ffprobe`.
pub async fn probe_duration_sec(audio_path: &Path) -> Result<f64, String> {
    let ffprobe = resolve_ffprobe_path()?;
    let mut cmd = Command::new(&ffprobe);
    cmd.args([
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
    ])
    .arg(audio_path);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run ffprobe: {e}"))?;

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    raw.parse::<f64>()
        .map_err(|_| format!("Could not parse duration from ffprobe output: '{raw}'"))
}

/// Decodes any downloaded media file into a clean 44.1kHz / 16-bit stereo PCM Master WAV.
pub async fn decode_to_master_wav(input_path: &Path, master_wav_path: &Path) -> Result<(), String> {
    let ffmpeg = resolve_ffmpeg_path()?;
    let mut cmd = Command::new(&ffmpeg);
    cmd.args(["-y", "-i"])
        .arg(input_path)
        .args([
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "44100",
            "-ac",
            "2",
        ])
        .arg(master_wav_path);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to spawn ffmpeg decode: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg decode failed: {}", stderr.lines().last().unwrap_or("unknown error")));
    }

    Ok(())
}

/// Trims `[start_sec, end_sec]` from the Master WAV and exports as WAV or 320kbps CBR MP3.
pub async fn render_trimmed_export(
    master_wav_path: &Path,
    output_path: &Path,
    start_sec: f64,
    end_sec: f64,
    format: &ExportFormat,
) -> Result<(), String> {
    let ffmpeg = resolve_ffmpeg_path()?;
    let duration = (end_sec - start_sec).max(0.1);

    let mut cmd = Command::new(&ffmpeg);
    cmd.args([
        "-y",
        "-ss",
        &format!("{:.3}", start_sec.max(0.0)),
        "-t",
        &format!("{:.3}", duration),
        "-i",
    ])
    .arg(master_wav_path);

    match format {
        ExportFormat::Wav => {
            cmd.args(["-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2"]);
        }
        ExportFormat::Mp3320 => {
            cmd.args(["-codec:a", "libmp3lame", "-b:a", "320k", "-ar", "44100", "-ac", "2"]);
        }
    }

    cmd.arg(output_path);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to spawn ffmpeg export: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg export failed: {}", stderr.lines().last().unwrap_or("unknown error")));
    }

    Ok(())
}