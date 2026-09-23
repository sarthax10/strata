//! Agent host manager: spawns the Node agent host (one per agent session),
//! relays JSON lines in both directions as Tauri events / commands.

use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AgentProc {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct AgentState {
    procs: Mutex<HashMap<u32, AgentProc>>,
    next_id: AtomicU32,
}

#[derive(Clone, Serialize)]
struct LineEvent { id: u32, line: String }
#[derive(Clone, Serialize)]
struct ExitEvent { id: u32, code: Option<i32> }

fn host_script(app: &AppHandle) -> Result<PathBuf, String> {
    // Bundled resource in release builds.
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("agent-host").join("index.js");
        if p.exists() { return Ok(p); }
    }
    // Development: sibling folder of src-tauri.
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("agent-host").join("dist").join("index.js");
    if dev.exists() { return Ok(dev); }
    Err("Agent host files are missing from this installation. Reinstall Strata, or run `npm run build` in agent-host when running from source.".into())
}

#[tauri::command]
pub fn agent_spawn(app: AppHandle, state: State<'_, Arc<AgentState>>, cwd: String) -> Result<u32, String> {
    let script = host_script(&app)?;
    let mut cmd = Command::new("node");
    cmd.arg(&script)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Node.js is required to run Claude Code. Install Node 20 or later and reopen Strata.".to_string()
        } else {
            format!("Could not start the agent host: {e}")
        }
    })?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    let id = state.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    state.procs.lock().insert(id, AgentProc { child, stdin });

    let app_out = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = app_out.emit("agent-line", LineEvent { id, line });
        }
    });
    let app_err = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = app_err.emit("agent-stderr", LineEvent { id, line });
        }
    });
    let app_exit = app.clone();
    let st = Arc::clone(&state);
    std::thread::spawn(move || {
        // Poll for exit without holding the lock for long.
        loop {
            std::thread::sleep(std::time::Duration::from_millis(250));
            let mut procs = st.procs.lock();
            match procs.get_mut(&id) {
                Some(p) => match p.child.try_wait() {
                    Ok(Some(status)) => {
                        procs.remove(&id);
                        drop(procs);
                        let _ = app_exit.emit("agent-exit", ExitEvent { id, code: status.code() });
                        break;
                    }
                    Ok(None) => {}
                    Err(_) => { procs.remove(&id); break; }
                },
                None => break,
            }
        }
    });
    Ok(id)
}

#[tauri::command]
pub fn agent_send(state: State<'_, Arc<AgentState>>, id: u32, line: String) -> Result<(), String> {
    let mut procs = state.procs.lock();
    let p = procs.get_mut(&id).ok_or("no such agent")?;
    p.stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    p.stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    p.stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn agent_kill(state: State<'_, Arc<AgentState>>, id: u32) -> Result<(), String> {
    if let Some(mut p) = state.procs.lock().remove(&id) {
        let _ = p.child.kill();
    }
    Ok(())
}
