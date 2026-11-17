pub mod audio;
pub mod discovery;
pub mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_drag::init())
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
            audio::export_trimmed_sample
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}