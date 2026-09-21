//! Shell profile discovery for Windows: PowerShell 7, Windows PowerShell,
//! cmd, Git Bash and WSL distributions. Returns ready-to-spawn profiles.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

const PWSH_INTEGRATION: &str = include_str!("../resources/strata.ps1");

/// Writes the bundled shell-integration scripts to a stable local path and
/// returns that directory. Rewritten on every launch so updates propagate.
fn integration_dir() -> Option<PathBuf> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    let dir = PathBuf::from(base).join("Strata").join("integration");
    std::fs::create_dir_all(&dir).ok()?;
    std::fs::write(dir.join("strata.ps1"), PWSH_INTEGRATION).ok()?;
    Some(dir)
}

fn pwsh_args(dir: &Option<PathBuf>) -> Vec<String> {
    let mut v: Vec<String> = vec!["-NoLogo".into(), "-NoProfile".into(), "-ExecutionPolicy".into(), "Bypass".into()];
    if let Some(d) = dir {
        v.push("-NoExit".into());
        v.push("-File".into());
        v.push(d.join("strata.ps1").to_string_lossy().into_owned());
    }
    v
}

#[derive(Serialize, Clone)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub shell: String,
    pub args: Vec<String>,
    pub icon: String,
    pub kind: String,
}

fn exists(p: &str) -> bool {
    Path::new(p).exists()
}

fn program_files() -> Vec<String> {
    let mut v = Vec::new();
    for key in ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"] {
        if let Ok(p) = std::env::var(key) {
            v.push(p);
        }
    }
    v
}

#[tauri::command]
pub fn discover_profiles() -> Vec<Profile> {
    let mut out = Vec::new();
    let integ = integration_dir();

    // PowerShell 7
    for base in program_files() {
        let p = format!("{base}\\PowerShell\\7\\pwsh.exe");
        if exists(&p) {
            out.push(Profile {
                id: "pwsh".into(),
                name: "PowerShell".into(),
                shell: p,
                args: pwsh_args(&integ),
                icon: "pwsh".into(),
                kind: "local".into(),
            });
            break;
        }
    }
    if !out.iter().any(|p| p.id == "pwsh") {
        // pwsh on PATH (winget/store installs)
        if which("pwsh.exe").is_some() {
            out.push(Profile {
                id: "pwsh".into(),
                name: "PowerShell".into(),
                shell: "pwsh.exe".into(),
                args: pwsh_args(&integ),
                icon: "pwsh".into(),
                kind: "local".into(),
            });
        }
    }

    // Windows PowerShell
    let wps = format!(
        "{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into())
    );
    if exists(&wps) {
        out.push(Profile {
            id: "powershell".into(),
            name: "Windows PowerShell".into(),
            shell: wps,
            args: pwsh_args(&integ),
            icon: "powershell".into(),
            kind: "local".into(),
        });
    }

    // cmd
    let cmd = format!(
        "{}\\System32\\cmd.exe",
        std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into())
    );
    if exists(&cmd) {
        out.push(Profile {
            id: "cmd".into(),
            name: "Command Prompt".into(),
            shell: cmd,
            args: vec![],
            icon: "cmd".into(),
            kind: "local".into(),
        });
    }

    // Git Bash
    for base in program_files() {
        let p = format!("{base}\\Git\\bin\\bash.exe");
        if exists(&p) {
            out.push(Profile {
                id: "gitbash".into(),
                name: "Git Bash".into(),
                shell: p,
                args: vec!["--login".into(), "-i".into()],
                icon: "bash".into(),
                kind: "local".into(),
            });
            break;
        }
    }

    out
}

/// WSL distributions, discovered separately because `wsl -l` can take seconds cold.
#[tauri::command]
pub fn discover_wsl() -> Vec<Profile> {
    let mut out = Vec::new();
    if let Ok(output) = Command::new("wsl.exe").args(["-l", "-q"]).output() {
        // wsl -l outputs UTF-16LE
        let text: String = if output.stdout.len() >= 2 {
            let u16s: Vec<u16> = output
                .stdout
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&u16s)
        } else {
            String::new()
        };
        for line in text.lines() {
            let name = line.trim().trim_matches('\0');
            if name.is_empty() || name.contains("docker") {
                continue;
            }
            out.push(Profile {
                id: format!("wsl-{}", name.to_lowercase()),
                name: format!("{name} (WSL)"),
                shell: "wsl.exe".into(),
                args: vec!["-d".into(), name.to_string()],
                icon: "linux".into(),
                kind: "wsl".into(),
            });
        }
    }

    out
}

fn which(name: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let p = dir.join(name);
        if p.exists() {
            return Some(p.to_string_lossy().into_owned());
        }
    }
    None
}

#[tauri::command]
pub fn home_dir() -> String {
    std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".into())
}
