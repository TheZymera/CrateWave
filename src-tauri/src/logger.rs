use chrono::Local;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

const MAX_LOG_SESSIONS: usize = 10;

pub struct SessionLogger {
    file: Mutex<File>,
    pub log_path: PathBuf,
    pub logs_dir: PathBuf,
}

impl SessionLogger {
    pub fn init(app: &AppHandle) -> Result<Self, String> {
        let logs_dir = app
            .path()
            .app_log_dir()
            .map_err(|e| format!("Failed to resolve log dir: {e}"))?;
        fs::create_dir_all(&logs_dir)
            .map_err(|e| format!("Failed to create log dir: {e}"))?;

        prune_old_logs(&logs_dir, MAX_LOG_SESSIONS - 1);

        let filename = format!(
            "cratewave_{}.log",
            Local::now().format("%Y-%m-%d_%H-%M-%S")
        );
        let log_path = logs_dir.join(filename);

        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| format!("Failed to open session log: {e}"))?;

        let logger = Self {
            file: Mutex::new(file),
            log_path,
            logs_dir,
        };

        let online = check_internet_connectivity();
        let sys_info = format!(
            "app={} os={} arch={} internet={}",
            app.package_info().version,
            std::env::consts::OS,
            std::env::consts::ARCH,
            if online { "ONLINE" } else { "OFFLINE" }
        );
        logger.write_line("INFO", "RUST", "SESSION_START", &sys_info, None);

        Ok(logger)
    }

    pub fn write_line(
        &self,
        level: &str,
        source: &str,
        category: &str,
        message: &str,
        meta: Option<&str>,
    ) {
        let ts = Local::now().format("%H:%M:%S%.3f");
        let clean_msg = message.replace('\n', " | ");
        let line = match meta {
            Some(m) if !m.is_empty() => format!(
                "[{ts}] [{level:<5}] [{source:<5}] [{category}] {clean_msg} :: {}\n",
                m.replace('\n', " | ")
            ),
            _ => format!("[{ts}] [{level:<5}] [{source:<5}] [{category}] {clean_msg}\n"),
        };

        if let Ok(mut f) = self.file.lock() {
            let _ = f.write_all(line.as_bytes());
            let _ = f.flush();
        }
    }

    /// Reads the current log and strips local OS usernames from file paths before sharing
    pub fn read_sanitized_current_log(&self) -> Result<String, String> {
        let raw = fs::read_to_string(&self.log_path)
            .map_err(|e| format!("Failed to read log: {e}"))?;
        Ok(sanitize_sensitive_paths(&raw))
    }
}

fn prune_old_logs(dir: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut log_files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| n.starts_with("cratewave_") && n.ends_with(".log"))
                    .unwrap_or(false)
        })
        .collect();

    // Filenames contain YYYY-MM-DD_HH-MM-SS so lexicographical sort == chronological sort
    log_files.sort();
    if log_files.len() > keep {
        let to_remove = log_files.len() - keep;
        for old_path in log_files.into_iter().take(to_remove) {
            let _ = fs::remove_file(old_path);
        }
    }
}

pub fn check_internet_connectivity() -> bool {
    // Fast non-HTTP TCP check to Cloudflare & Google DNS (no payload, <400ms timeout)
    let targets = ["1.1.1.1:443", "8.8.8.8:53"];
    targets.iter().any(|addr| {
        addr.parse()
            .map(|sock| TcpStream::connect_timeout(&sock, Duration::from_millis(450)).is_ok())
            .unwrap_or(false)
    })
}

fn sanitize_sensitive_paths(input: &str) -> String {
    let mut out = input.to_string();
    if let Ok(user) = std::env::var("USERNAME").or_else(|_| std::env::var("USER")) {
        if !user.is_empty() {
            out = out.replace(&user, "<USER>");
        }
    }
    out
}

#[tauri::command]
pub fn log_event(
    logger: State<'_, SessionLogger>,
    level: String,
    source: String,
    category: String,
    message: String,
    meta: Option<String>,
) {
    logger.write_line(
        &level.to_uppercase(),
        &source.to_uppercase(),
        &category.to_uppercase(),
        &message,
        meta.as_deref(),
    );
}

#[tauri::command]
pub fn check_network_status(logger: State<'_, SessionLogger>) -> bool {
    let online = check_internet_connectivity();
    logger.write_line(
        if online { "INFO" } else { "WARN" },
        "RUST",
        "NET_CHECK",
        if online { "Internet reachable" } else { "No internet connection" },
        None,
    );
    online
}

#[tauri::command]
pub fn get_sanitized_session_log(logger: State<'_, SessionLogger>) -> Result<String, String> {
    logger.read_sanitized_current_log()
}

#[tauri::command]
pub fn open_logs_folder(logger: State<'_, SessionLogger>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&logger.logs_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&logger.logs_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&logger.logs_dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}