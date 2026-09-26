mod agent;
mod pty;
mod shells;
mod state;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Arc::new(pty::PtyState::default()))
        .manage(Arc::new(agent::AgentState::default()))
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_list,
            shells::discover_profiles,
            shells::discover_wsl,
            shells::home_dir,
            agent::agent_spawn,
            agent::agent_send,
            agent::agent_kill,
            state::state_save,
            state::state_load,
            state::scrollback_save,
            state::scrollback_load,
            state::scrollback_prune,
            state::path_exists,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
