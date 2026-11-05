#[tauri::command]
fn report_smoke(status: String) {
    eprintln!("wavnotes-smoke: {status}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(persistence::Registry::default())
        .setup(|app| {
            quit_guard::install(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            report_smoke,
            persistence::create_project,
            persistence::open_project,
            persistence::save_project
        ])
        .build(tauri::generate_context!())
        .expect("failed to build wavNotes")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if quit_guard::route_to_close(app) {
                    api.prevent_exit();
                }
            }
        });
}
mod persistence;
mod quit_guard;
