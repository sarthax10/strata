//! PTY session manager: owns ConPTY handles and streams output to the UI.
//!
//! Each session is a shell process attached to a pseudo-terminal. Output is
//! read on a dedicated thread and emitted as `pty-output` events (base64 so
//! arbitrary bytes survive JSON). Exit is emitted as `pty-exit`.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

pub struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<u32, Session>>,
    next_id: AtomicU32,
}

#[derive(Clone, Serialize)]
struct OutputEvent {
    id: u32,
    data: String,
}

#[derive(Clone, Serialize)]
struct ExitEvent {
    id: u32,
    code: Option<u32>,
}

#[derive(Serialize)]
pub struct SpawnResult {
    pub id: u32,
    pub pid: Option<u32>,
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, Arc<PtyState>>,
    shell: String,
    args: Vec<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    env: Option<HashMap<String, String>>,
) -> Result<SpawnResult, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.args(&args);
    if let Some(dir) = cwd.as_deref().filter(|d| !d.is_empty()) {
        cmd.cwd(dir);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Strata");
    if let Some(env) = env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let pid = child.process_id();

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = state.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    state.sessions.lock().insert(
        id,
        Session { master: pair.master, writer, child },
    );

    // Reader thread: coalesce into chunks and emit.
    let app_reader = app.clone();
    let state_reader = Arc::clone(&state);
    std::thread::Builder::new()
        .name(format!("pty-reader-{id}"))
        .spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let _ = app_reader.emit(
                            "pty-output",
                            OutputEvent { id, data: B64.encode(&buf[..n]) },
                        );
                    }
                    Err(_) => break,
                }
            }
            // Reap the child and report exit.
            let code = {
                let mut sessions = state_reader.sessions.lock();
                match sessions.get_mut(&id) {
                    Some(s) => s.child.wait().ok().map(|st| st.exit_code()),
                    None => None,
                }
            };
            state_reader.sessions.lock().remove(&id);
            let _ = app_reader.emit("pty-exit", ExitEvent { id, code });
        })
        .map_err(|e| e.to_string())?;

    Ok(SpawnResult { id, pid })
}

#[tauri::command]
pub fn pty_write(state: State<'_, Arc<PtyState>>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock();
    let s = sessions.get_mut(&id).ok_or("no such session")?;
    s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    s.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, Arc<PtyState>>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.sessions.lock();
    let s = sessions.get(&id).ok_or("no such session")?;
    s.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, Arc<PtyState>>, id: u32) -> Result<(), String> {
    let mut sessions = state.sessions.lock();
    if let Some(s) = sessions.get_mut(&id) {
        let _ = s.child.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn pty_list(state: State<'_, Arc<PtyState>>) -> Vec<u32> {
    state.sessions.lock().keys().copied().collect()
}
