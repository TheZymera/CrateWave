pub mod downloader;
pub mod processor;

use crate::discovery::{DigMode, SampleCandidate};
use crate::logger::SessionLogger;
use crate::storage::{build_sample_output_path, resolve_samples_dir};
use serde::{Deserialize, Serialize};
use std::io::SeekFrom;
use std::path::PathBuf;
use tauri::{AppHandle, State};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::OnceCell;

static AUDIO_SERVER_PORT: OnceCell<u16> = OnceCell::const_new();

fn url_encode_path(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 2);
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn url_decode_path(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex_str) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(val) = u8::from_str_radix(hex_str, 16) {
                    out.push(val);
                    i += 3;
                    continue;
                }
            }
        } else if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

async fn handle_audio_http_client(mut stream: TcpStream) {
    let mut req_buf = Vec::with_capacity(2048);
    let mut tmp = [0u8; 1024];

    loop {
        match stream.read(&mut tmp).await {
            Ok(0) | Err(_) => return,
            Ok(n) => {
                req_buf.extend_from_slice(&tmp[..n]);
                if req_buf.windows(4).any(|w| w == b"\r\n\r\n") || req_buf.len() > 8192 {
                    break;
                }
            }
        }
    }

    let req_str = String::from_utf8_lossy(&req_buf);
    let first_line = req_str.lines().next().unwrap_or("");
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");

    if method == "OPTIONS" {
        let resp = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\nConnection: close\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes()).await;
        return;
    }

    if method != "GET" && method != "HEAD" {
        let _ = stream
            .write_all(b"HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n")
            .await;
        return;
    }

    let encoded_file = target
        .split_once("path=")
        .map(|(_, p)| p.split('&').next().unwrap_or(""))
        .unwrap_or("");
    let file_path = PathBuf::from(url_decode_path(encoded_file));

    let mut file = match File::open(&file_path).await {
        Ok(f) => f,
        Err(_) => {
            let _ = stream
                .write_all(b"HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n")
                .await;
            return;
        }
    };

    let total_len = match file.metadata().await {
        Ok(m) if m.len() > 0 => m.len(),
        _ => {
            let _ = stream
                .write_all(b"HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n")
                .await;
            return;
        }
    };

    let content_type = if file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("mp3"))
        .unwrap_or(false)
    {
        "audio/mpeg"
    } else {
        "audio/wav"
    };

    let range_header = req_str.lines().find_map(|line| {
        let (k, v) = line.split_once(':')?;
        if k.trim().eq_ignore_ascii_case("range") {
            Some(v.trim())
        } else {
            None
        }
    });

    let (status_line, start, end, extra_header) = if let Some(r) = range_header {
        let spec = r.strip_prefix("bytes=").unwrap_or("");
        let (s_str, e_str) = spec.split_once('-').unwrap_or(("0", ""));
        let s = s_str.parse::<u64>().unwrap_or(0).min(total_len - 1);
        let e = if e_str.is_empty() {
            total_len - 1
        } else {
            e_str.parse::<u64>().unwrap_or(total_len - 1).min(total_len - 1)
        };
        let e = e.max(s);
        (
            "HTTP/1.1 206 Partial Content",
            s,
            e,
            format!("Content-Range: bytes {}-{}/{}\r\n", s, e, total_len),
        )
    } else {
        ("HTTP/1.1 200 OK", 0, total_len - 1, String::new())
    };

    let content_len = end - start + 1;
    let headers = format!(
        "{}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\n{}Access-Control-Allow-Origin: *\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
        status_line, content_type, content_len, extra_header
    );

    if stream.write_all(headers.as_bytes()).await.is_err() {
        return;
    }

    if method == "HEAD" {
        return;
    }

    if file.seek(SeekFrom::Start(start)).await.is_err() {
        return;
    }

    let mut remaining = content_len;
    let mut chunk = vec![0u8; 32 * 1024];
    while remaining > 0 {
        let to_read = (remaining as usize).min(chunk.len());
        match file.read(&mut chunk[..to_read]).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if stream.write_all(&chunk[..n]).await.is_err() {
                    break;
                }
                remaining -= n as u64;
            }
        }
    }
}

async fn ensure_audio_server() -> Result<u16, String> {
    let port = AUDIO_SERVER_PORT
        .get_or_try_init(|| async {
            let listener = TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| format!("Failed to bind local audio server: {e}"))?;
            let bound_port = listener
                .local_addr()
                .map_err(|e| format!("Failed to read local audio port: {e}"))?
                .port();

            tokio::spawn(async move {
                while let Ok((stream, _)) = listener.accept().await {
                    tokio::spawn(handle_audio_http_client(stream));
                }
            });

            Ok::<u16, String>(bound_port)
        })
        .await?;

    Ok(*port)
}

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
    #[serde(default)]
    pub stream_url: String,
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
    logger: State<'_, SessionLogger>,
) -> Result<ActiveSample, String> {
    logger.write_line(
        "INFO",
        "RUST",
        "TASK:CHOP",
        "Downloading & preparing sample",
        Some(&format!(
            "id={} source={} mode={:?} fmt={:?}",
            candidate.id, candidate.source, mode, format
        )),
    );

    let mut sample =
        match downloader::download_and_prepare_sample(&app, &candidate, &mode, &format).await {
            Ok(s) => s,
            Err(e) => {
                let lower_e = e.to_lowercase();
                let is_permanent_media_err = lower_e.contains("http 404")
                    || lower_e.contains("http 410")
                    || lower_e.contains("http 403")
                    || lower_e.contains("silent")
                    || lower_e.contains("too short")
                    || lower_e.contains("invalid wav")
                    || lower_e.contains("ffmpeg decode failed")
                    || lower_e.contains("no downloadable audio");

                if is_permanent_media_err {
                    let _ = crate::storage::quarantine_id(&app, &candidate.id);
                    logger.write_line(
                        "WARN",
                        "RUST",
                        "QUARANTINE",
                        "Blacklisted unplayable/silent candidate",
                        Some(&format!(
                            "id={} source={} err={}",
                            candidate.id, candidate.source, e
                        )),
                    );
                } else {
                    logger.write_line(
                        "WARN",
                        "RUST",
                        "CHOP_TRANSIENT_ERR",
                        &e,
                        Some(&candidate.id),
                    );
                }
                return Err(e);
            }
        };

    let port = match ensure_audio_server().await {
        Ok(p) => p,
        Err(e) => {
            logger.write_line("ERROR", "RUST", "AUDIO_SRV_ERR", &e, None);
            return Err(e);
        }
    };

    sample.stream_url = format!(
        "http://127.0.0.1:{}/stream?path={}",
        port,
        url_encode_path(&sample.master_wav_path)
    );

    logger.write_line(
        "INFO",
        "RUST",
        "CHOP_OK",
        &format!("Sample ready ({:.2}s)", sample.duration_sec),
        Some(&format!("id={} port={}", candidate.id, port)),
    );

    Ok(sample)
}

#[tauri::command]
pub async fn export_trimmed_sample(
    master_wav_path: String,
    title: String,
    mode: DigMode,
    start_sec: f64,
    end_sec: f64,
    format: ExportFormat,
    logger: State<'_, SessionLogger>,
) -> Result<String, String> {
    logger.write_line(
        "INFO",
        "RUST",
        "TASK:EXPORT",
        "Rendering trimmed export",
        Some(&format!(
            "title='{}' range={:.2}s..{:.2}s fmt={:?}",
            title, start_sec, end_sec, format
        )),
    );

    let samples_dir = match resolve_samples_dir() {
        Ok(dir) => dir,
        Err(e) => {
            logger.write_line("ERROR", "RUST", "EXPORT_DIR_ERR", &e, None);
            return Err(e);
        }
    };

    let output_path = build_sample_output_path(
        &samples_dir,
        &mode,
        &title,
        start_sec,
        end_sec,
        &format,
    );

    if let Err(e) = processor::render_trimmed_export(
        &PathBuf::from(&master_wav_path),
        &output_path,
        start_sec,
        end_sec,
        &format,
    )
    .await
    {
        logger.write_line("ERROR", "RUST", "EXPORT_ERR", &e, Some(&title));
        return Err(e);
    }

    let out_str = output_path.to_string_lossy().to_string();
    logger.write_line(
        "INFO",
        "RUST",
        "EXPORT_OK",
        "Exported trimmed slice",
        Some(&out_str),
    );

    Ok(out_str)
}

#[tauri::command]
pub async fn extend_sample_audio(
    app: tauri::AppHandle,
    candidate: crate::discovery::SampleCandidate,
    mode: crate::discovery::DigMode,
    format: ExportFormat,
    logger: State<'_, SessionLogger>,
) -> Result<ActiveSample, String> {
    logger.write_line(
        "INFO",
        "RUST",
        "TASK:EXTEND",
        "Extending sample beyond initial capture",
        Some(&format!("id={} source={}", candidate.id, candidate.source)),
    );

    let mut sample =
        match downloader::extend_and_prepare_full_sample(&app, &candidate, &mode, &format).await {
            Ok(s) => s,
            Err(e) => {
                logger.write_line("WARN", "RUST", "EXTEND_WARN", &e, Some(&candidate.id));
                return Err(e);
            }
        };

    let port = match ensure_audio_server().await {
        Ok(p) => p,
        Err(e) => {
            logger.write_line("ERROR", "RUST", "AUDIO_SRV_ERR", &e, None);
            return Err(e);
        }
    };

    sample.stream_url = format!(
        "http://127.0.0.1:{}/stream?path={}",
        port,
        url_encode_path(&sample.master_wav_path)
    );

    logger.write_line(
        "INFO",
        "RUST",
        "EXTEND_OK",
        &format!("Extended sample ready ({:.2}s)", sample.duration_sec),
        Some(&candidate.id),
    );

    Ok(sample)
}