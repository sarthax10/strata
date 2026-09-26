// Terminal instance registry: xterm objects outlive React components so
// panes can be moved, hidden and restored without losing state.
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as pty from "./pty";

export interface TermInstance {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  serializer: SerializeAddon;
  ptyId: number | null;
  exited: boolean;
  exitCode: number | null;
  title: string;
  onTitle?: (t: string) => void;
  onExit?: (code: number | null) => void;
  onCwd?: (cwd: string) => void;
  onCommand?: (ev: { kind: "start" | "end"; exit?: number }) => void;
}

const registry = new Map<string, TermInstance>();

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function themeFromTokens(): ITheme {
  return {
    background: "rgba(0,0,0,0)", foreground: cssVar("--t-fg"), cursor: cssVar("--t-cursor"),
    cursorAccent: cssVar("--t-bg"), selectionBackground: cssVar("--selection"),
    black: cssVar("--t-black"), red: cssVar("--t-red"), green: cssVar("--t-green"), yellow: cssVar("--t-yellow"),
    blue: cssVar("--t-blue"), magenta: cssVar("--t-magenta"), cyan: cssVar("--t-cyan"), white: cssVar("--t-white"),
    brightBlack: cssVar("--t-bblack"), brightRed: cssVar("--t-bred"), brightGreen: cssVar("--t-bgreen"),
    brightYellow: cssVar("--t-byellow"), brightBlue: cssVar("--t-bblue"), brightMagenta: cssVar("--t-bmagenta"),
    brightCyan: cssVar("--t-bcyan"), brightWhite: cssVar("--t-bwhite"),
  };
}

export function get(sessionId: string) { return registry.get(sessionId); }

export function create(sessionId: string): TermInstance {
  const term = new Terminal({
    allowProposedApi: true,
    fontFamily: cssVar("--font-mono"),
    fontSize: 13,
    lineHeight: 1.35,
    letterSpacing: 0,
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 2,
    scrollback: 50000,
    minimumContrastRatio: 4.5,
    theme: themeFromTokens(),
    allowTransparency: true,
    windowsPty: { backend: "conpty" },
    smoothScrollDuration: 0,
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  const serializer = new SerializeAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(serializer);
  term.loadAddon(new WebLinksAddon((_e, uri) => { openUrl(uri); }));

  const inst: TermInstance = { term, fit, search, serializer, ptyId: null, exited: false, exitCode: null, title: "" };

  term.onTitleChange((t) => { inst.title = t; inst.onTitle?.(t); });
  term.onData((d) => { if (inst.ptyId != null && !inst.exited) pty.write(inst.ptyId, d); });
  term.onBinary((d) => { if (inst.ptyId != null && !inst.exited) pty.write(inst.ptyId, d); });
  term.onResize(({ cols, rows }) => { if (inst.ptyId != null && !inst.exited) pty.resize(inst.ptyId, cols, rows); });

  // OSC 7: cwd reporting. OSC 133: shell integration prompt marks.
  term.parser.registerOscHandler(7, (data) => {
    try {
      const u = new URL(data);
      let p = decodeURIComponent(u.pathname);
      if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1).replace(/\//g, "\\");
      inst.onCwd?.(p);
    } catch { /* ignore */ }
    return true;
  });
  term.parser.registerOscHandler(133, (data) => {
    const [code, arg] = data.split(";");
    if (code === "C") inst.onCommand?.({ kind: "start" });
    if (code === "D") inst.onCommand?.({ kind: "end", exit: arg ? Number(arg) : undefined });
    return true;
  });

  registry.set(sessionId, inst);
  return inst;
}

export function attach(inst: TermInstance, el: HTMLElement) {
  if (!inst.term.element) {
    inst.term.open(el);
    try { inst.term.loadAddon(new WebglAddon()); } catch { /* fall back to canvas/dom */ }
  } else if (inst.term.element.parentElement !== el) {
    el.appendChild(inst.term.element);
  }
  inst.fit.fit();
}

export async function start(inst: TermInstance, profile: pty.Profile, cwd?: string) {
  const { cols, rows } = inst.term;
  const res = await pty.spawn({
    shell: profile.shell, args: profile.args, cwd, cols, rows,
    onOutput: (bytes) => inst.term.write(bytes),
    onExit: (code) => { inst.exited = true; inst.exitCode = code; inst.onExit?.(code); },
  });
  inst.ptyId = res.id;
  pty.resize(res.id, inst.term.cols, inst.term.rows);
}

/** Text of a session's recent scrollback, with colors, for persistence. */
export function serialize(sessionId: string, scrollback = 2000): string | null {
  const inst = registry.get(sessionId);
  if (!inst) return null;
  try { return inst.serializer.serialize({ scrollback }); } catch { return null; }
}

/** Write restored history above a divider, then let the fresh shell take over. */
export function replay(inst: TermInstance, text: string) {
  const ESC = String.fromCharCode(27);
  const CRLF = String.fromCharCode(13, 10);
  inst.term.write(text.replace(/[\r\n]+$/, ""));
  inst.term.write(CRLF + ESC + "[38;2;108;115;130m── restored · shell restarted ──" + ESC + "[0m" + CRLF);
}

export function dispose(sessionId: string) {
  const inst = registry.get(sessionId);
  if (!inst) return;
  if (inst.ptyId != null && !inst.exited) pty.kill(inst.ptyId);
  inst.term.dispose();
  registry.delete(sessionId);
}

export function retheme() {
  const theme = themeFromTokens();
  for (const inst of registry.values()) inst.term.options.theme = theme;
}
