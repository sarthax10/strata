# Strata

A Windows development environment where the terminal, an AI agent (Claude Code), the editor, a browser preview, the project tree and Git are views of one project.

Design specification (Phase 1 terminal, Phase 2 agent environment): the Strata design doc in Claude.

## Status

Working today (V1a/V1b slice):

- Native Windows 11 window (custom title bar, Mica), Obsidian and Ivory themes, bundled JetBrains Mono.
- Terminal panes on ConPTY (`portable-pty`) rendered by xterm.js WebGL; shell profiles discovered (PowerShell 7, Windows PowerShell, cmd, Git Bash, WSL).
- Strata shell integration for PowerShell: own two-line prompt, OSC 133 command marks, OSC 7 cwd (new splits inherit cwd; status bar shows cwd; running/failed commands are tracked).
- Tiling: split right/down/left/up, close with 30 s undo, focus by direction and by number, move/swap, keyboard and drag resize, equalize, zoom, animated geometry, `Alt` key hints.
- Rail (projects), title-bar palette field, status bar, command palette with fuzzy search.
- **Agent pane**: the real Claude Code through the Claude Agent SDK (`agent-host/`). Transcript as a work log: user turns, streamed prose, activity rows (Read/Edit/Run/… with verb + object + outcome + duration, expandable to diff/output), thinking rows, turn footer with files/duration/cost, the Now strip, permission decision card (`Enter` allow, `→` always, `Esc` deny), `AskUserQuestion` forms, model pill with effort/mode/context ring, `/` commands (native + Strata), image attachments (paste/drop), `Esc Esc` to stop.

- **Persistence**: projects, workspaces, pane layouts, terminal sessions and agent transcripts are snapshotted to `%LOCALAPPDATA%\Strata` and restored on launch. Restored terminals replay their scrollback above a divider and start a fresh shell in the same directory; agent sessions come back with their Claude session id, so the next prompt resumes the real conversation.
- **Explorer** (`Ctrl+Shift+X`): project tree with per-file git badges, folder rollup dots, branch and ahead/behind, a filter, inline create and rename, delete to the Recycle Bin, and a context menu that hands a path to Claude or opens a terminal there. Files Claude edits light up as it works. A read-only file view opens what you select.

Not yet: editor with diff review and checkpoints, browser pane and MCP bridge, Changes/Tasks views, session manager, notifications, SSH manager, settings UI.

## Install

Download `Strata_0.1.0_x64-setup.exe` from Releases and run it (per-user install, no admin needed).

Requires on the machine:

- **Node.js 20+** — Strata runs the Claude Code agent in a Node process. Without it the terminal works and the Agent pane says what is missing.
- **Claude Code** signed in (`claude`) for the Agent pane.

## Run from source

```bash
npm install
cd agent-host && npm install && npm run build && cd ..
npm run tauri dev       # development
npm run tauri build     # installer in src-tauri/target/release/bundle/nsis
```

Requires Node 20+, Rust 1.85+, and Claude Code signed in.

The debug binary in `src-tauri/target/debug` loads the UI from the Vite dev server, so it only works while `npm run tauri dev` is running — use the installer or `target/release/strata.exe` for a standalone app.

## Layout

- `src-tauri/` — Rust core: `pty.rs` (ConPTY sessions), `shells.rs` (profile discovery + shell integration install), `agent.rs` (agent host processes). `resources/strata.ps1` is the PowerShell integration.
- `agent-host/` — Node process per agent session; wraps `@anthropic-ai/claude-agent-sdk` and speaks JSON lines.
- `src/core/` — `layout.ts` (tiling tree), `terminals.ts` (xterm registry), `pty.ts`, `agent.ts` (SDK stream → transcript reducer), `keymap.ts`, `commands.ts`.
- `src/state/store.ts` — projects, workspaces, panes, sessions.
- `src/components/` — `Canvas`, `TerminalPane`, `AgentPane`, `Chrome` (title bar, rail, status bar), `Palette`.
- `src/styles/` — `tokens.css` (design system), `global.css`, `agent.css`.

## Keyboard

`Ctrl+Shift+T` new terminal · `Ctrl+Shift+A` Claude · `Ctrl+Shift+D/E` split right/down · `Ctrl+Shift+W` close · `Ctrl+Shift+Z` undo close · `Alt+arrows` focus · `Alt+1–9` pane N · `Alt+Shift+arrows` resize · `Ctrl+Alt+arrows` move · `Alt+Z` zoom · `Ctrl+Shift+=` equalize · `Ctrl+Shift+P` palette · `Ctrl+Shift+B` rail · `Ctrl+Shift+1–9` workspace.

Agent pane: `Enter` send · `Shift+Enter` newline · `Alt+M` model · `Esc Esc` stop · decision card `Enter` / `→` / `Esc`.
