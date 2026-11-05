#[tauri::command]
fn report_smoke(status: String) {
    eprintln!("wavnotes-smoke: {status}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(persistence::Registry::default())
        .invoke_handler(tauri::generate_handler![
            report_smoke,
            persistence::create_project,
            persistence::open_project,
            persistence::save_project
        ])
        .run(tauri::generate_context!())
        .expect("failed to run wavNotes");
}
mod persistence;
