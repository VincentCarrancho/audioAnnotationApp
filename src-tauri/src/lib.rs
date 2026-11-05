#[tauri::command]
fn report_smoke(status: String) {
    eprintln!("wavnotes-smoke: {status}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![report_smoke])
        .run(tauri::generate_context!())
        .expect("failed to run wavNotes");
}
