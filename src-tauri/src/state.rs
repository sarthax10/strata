//! Persisted app state and scrollback.
//!
//! State is one JSON document in %LOCALAPPDATA%\Strata\state.json, written
//! atomically (temp file + rename) so a crash never leaves it torn.
//! Scrollback is one file per terminal session under scrollback\.

use std::path::PathBuf;

fn strata_dir() -> Result<PathBuf, String> {
    let base = std::env::var("LOCALAPPDATA").map_err(|_| "LOCALAPPDATA not set")?;
    let dir = PathBuf::from(base).join("Strata");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn write_atomic(path: &PathBuf, contents: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn state_save(json: String) -> Result<(), String> {
    write_atomic(&strata_dir()?.join("state.json"), &json)
}

#[tauri::command]
pub fn state_load() -> Result<Option<String>, String> {
    let path = strata_dir()?.join("state.json");
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn scrollback_path(id: &str) -> Result<PathBuf, String> {
    let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
    if safe.is_empty() {
        return Err("invalid session id".into());
    }
    let dir = strata_dir()?.join("scrollback");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{safe}.txt")))
}

/// Persist a terminal's visible history so a restored pane shows what was there.
#[tauri::command]
pub fn scrollback_save(id: String, text: String) -> Result<(), String> {
    write_atomic(&scrollback_path(&id)?, &text)
}

#[tauri::command]
pub fn scrollback_load(id: String) -> Result<Option<String>, String> {
    match std::fs::read_to_string(scrollback_path(&id)?) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Remove scrollback files whose session ids are no longer in `keep`.
#[tauri::command]
pub fn scrollback_prune(keep: Vec<String>) -> Result<(), String> {
    let dir = strata_dir()?.join("scrollback");
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(()) };
    for entry in entries.flatten() {
        let path = entry.path();
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        if !keep.iter().any(|k| k == &stem) {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    !path.is_empty() && std::path::Path::new(&path).exists()
}
