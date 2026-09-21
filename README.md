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

Not yet: persistence/restore, Explorer, Editor/diff review with checkpoints, Browser pane and MCP bridge, Changes/Tasks, session manager, notifications, SSH manager, settings UI.

## Run

```bash
npm install
cd agent-host && npm install && npm run build && cd ..
npm run tauri dev
```

Requires Node 22+, Rust 1.85+, and Claude Code installed and signed in (`claude`).

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
