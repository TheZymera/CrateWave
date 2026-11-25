pub mod audio;
pub mod discovery;
pub mod storage;
mod logger;
use logger::SessionLogger;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_drag::init())
        .setup(|app| {
            let session_logger = SessionLogger::init(app.handle())
                .expect("Failed to initialize session logger");
            let panic_log_path = session_logger.log_path.clone();

            // Write any Rust thread panic directly into the active session log before exit
            let default_hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .append(true)
                    .open(&panic_log_path)
                {
                    use std::io::Write;
                    let ts = chrono::Local::now().format("%H:%M:%S%.3f");
                    let _ = writeln!(f, "[{ts}] [FATAL] [RUST ] [PANIC] {info}");
                }
                default_hook(info);
            }));

            app.manage(session_logger);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            storage::init_storage,
            storage::get_drag_icon_path,
            storage::open_samples_folder,
            discovery::roll_crate,
            discovery::query_builder::get_queries_file_path,
            discovery::query_builder::get_query_dictionary,
            discovery::query_builder::save_query_dictionary,
            discovery::ytdlp_search::update_ytdlp_binary,
            audio::load_and_chop_sample,
            audio::extend_sample_audio,
            audio::export_trimmed_sample,
            logger::log_event,
            logger::check_network_status,
            logger::get_sanitized_session_log,
            logger::open_logs_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}