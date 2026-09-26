//! Project tree and git status for the Explorer.
//!
//! Directory listing is shallow: the UI asks for one folder at a time so a
//! huge repository never blocks. Git status comes from `git status --porcelain`,
//! which is fast enough to run per refresh and needs no library.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub hidden: bool,
}

/// Folders never worth walking into from the tree by default.
const NOISE: [&str; 8] = ["node_modules", ".git", "target", "dist", "build", ".next", "__pycache__", ".venv"];

#[tauri::command]
pub fn read_dir(path: String) -> Result<Vec<Entry>, String> {
    let dir = PathBuf::from(&path);
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut out: Vec<Entry> = Vec::new();
    for e in entries.flatten() {
        let meta = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let name = e.file_name().to_string_lossy().into_owned();
        let is_dir = meta.is_dir();
        let hidden = name.starts_with('.') || NOISE.contains(&name.as_str());
        out.push(Entry {
            path: e.path().to_string_lossy().into_owned(),
            name,
            is_dir,
            size: if is_dir { 0 } else { meta.len() },
            hidden,
        });
    }
    // Folders first, then files; case-insensitive within each group.
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

#[derive(Serialize)]
pub struct GitStatus {
    pub root: String,
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    /// path (absolute, forward slashes) -> one of M A D U C R
    pub files: std::collections::HashMap<String, String>,
}

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(dir).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[tauri::command]
pub fn git_status(path: String) -> Option<GitStatus> {
    let dir = PathBuf::from(&path);
    let root = git(&dir, &["rev-parse", "--show-toplevel"])?.trim().to_string();
    if root.is_empty() {
        return None;
    }
    let branch = git(&dir, &["rev-parse", "--abbrev-ref", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let (mut ahead, mut behind) = (0, 0);
    if let Some(counts) = git(&dir, &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]) {
        let nums: Vec<u32> = counts.split_whitespace().filter_map(|n| n.parse().ok()).collect();
        if nums.len() == 2 {
            behind = nums[0];
            ahead = nums[1];
        }
    }

    let mut files = std::collections::HashMap::new();
    if let Some(porcelain) = git(&dir, &["status", "--porcelain", "--no-renames"]) {
        for line in porcelain.lines() {
            if line.len() < 4 {
                continue;
            }
            let code = &line[..2];
            let rel = line[3..].trim_matches('"');
            let letter = match code.trim() {
                c if c.contains('U') || c == "AA" || c == "DD" => "C",
                c if c.starts_with('?') => "U",
                c if c.contains('A') => "A",
                c if c.contains('D') => "D",
                _ => "M",
            };
            let abs = Path::new(&root).join(rel).to_string_lossy().replace('\\', "/");
            files.insert(abs, letter.to_string());
        }
    }
    Some(GitStatus { root: root.replace('\\', "/"), branch, ahead, behind, files })
}

#[tauri::command]
pub fn create_path(path: String, is_dir: bool) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.exists() {
        return Err("Already exists".into());
    }
    if is_dir {
        std::fs::create_dir_all(&p).map_err(|e| e.to_string())
    } else {
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&p, "").map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    if PathBuf::from(&to).exists() {
        return Err("A file with that name already exists".into());
    }
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

/// Delete to the Recycle Bin so a mistake is recoverable.
#[tauri::command]
pub fn trash_path(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let mut cmd = Command::new("explorer.exe");
    if p.is_dir() {
        cmd.arg(&p);
    } else {
        cmd.arg("/select,").arg(&p);
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Read a text file for the editor/preview, refusing anything oversized or binary.
#[tauri::command]
pub fn read_text_file(path: String, max_bytes: Option<u64>) -> Result<String, String> {
    let limit = max_bytes.unwrap_or(2 * 1024 * 1024);
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > limit {
        return Err(format!("File is {} KB; too large to open here", meta.len() / 1024));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.iter().take(8000).any(|b| *b == 0) {
        return Err("Binary file".into());
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}
