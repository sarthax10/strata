// Bridge to the Rust PTY session manager.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Profile { id: string; name: string; shell: string; args: string[]; icon: string; kind: string }

type OutputHandler = (bytes: Uint8Array) => void;
type ExitHandler = (code: number | null) => void;

const outputHandlers = new Map<number, OutputHandler>();
const exitHandlers = new Map<number, ExitHandler>();
let listening = false;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function ensureListeners() {
  if (listening) return;
  listening = true;
  await listen<{ id: number; data: string }>("pty-output", (e) => {
    outputHandlers.get(e.payload.id)?.(b64ToBytes(e.payload.data));
  });
  await listen<{ id: number; code: number | null }>("pty-exit", (e) => {
    exitHandlers.get(e.payload.id)?.(e.payload.code);
    outputHandlers.delete(e.payload.id);
    exitHandlers.delete(e.payload.id);
  });
}

export async function spawn(opts: {
  shell: string; args: string[]; cwd?: string; cols: number; rows: number; env?: Record<string, string>;
  onOutput: OutputHandler; onExit: ExitHandler;
}): Promise<{ id: number; pid: number | null }> {
  await ensureListeners();
  const res = await invoke<{ id: number; pid: number | null }>("pty_spawn", {
    shell: opts.shell, args: opts.args, cwd: opts.cwd ?? null, cols: opts.cols, rows: opts.rows, env: opts.env ?? null,
  });
  outputHandlers.set(res.id, opts.onOutput);
  exitHandlers.set(res.id, opts.onExit);
  return res;
}

export const write = (id: number, data: string) => invoke("pty_write", { id, data });
export const resize = (id: number, cols: number, rows: number) => invoke("pty_resize", { id, cols, rows });
export const kill = (id: number) => invoke("pty_kill", { id });
export const discoverProfiles = () => invoke<Profile[]>("discover_profiles");
export const homeDir = () => invoke<string>("home_dir");
