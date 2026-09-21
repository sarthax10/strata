import { create } from "zustand";
import * as L from "../core/layout";
import * as T from "../core/terminals";
import type { Profile } from "../core/pty";
import { useAgents } from "../core/agent";

export type PaneType = "terminal" | "agent" | "empty";

export interface Pane { id: string; type: PaneType; sessionId?: string; agentId?: string }
export interface Session {
  id: string; profileId: string; title: string; cwd?: string;
  running: boolean; exited: boolean; exitCode: number | null; failed: boolean;
}
export interface Workspace {
  id: string; name: string; tree: L.LayoutNode | null; focusedPaneId: string | null; zoomedPaneId: string | null;
}
export interface Project { id: string; name: string; color: string; root?: string; workspaceIds: string[]; activeWorkspaceId: string }

export interface Toast { id: string; title: string; sub?: string; kind: "info" | "success" | "error"; onClick?: () => void }

interface ClosedPane { pane: Pane; session?: Session; tree: L.LayoutNode | null; workspaceId: string; at: number }

const HUES = ["#7AA2F7", "#7ECB8F", "#E5B567", "#F07178", "#C39AF0", "#6FD3E0", "#F49BA1", "#9DBCFF", "#E0A458", "#95E3ED", "#B9A7F5", "#A2A7B3"];
let idSeq = 0;
const uid = (p: string) => `${p}${++idSeq}_${Date.now().toString(36)}`;

export interface AppState {
  profiles: Profile[];
  defaultProfileId: string | null;
  homeDir: string;
  projects: Record<string, Project>;
  projectOrder: string[];
  activeProjectId: string | null;
  workspaces: Record<string, Workspace>;
  panes: Record<string, Pane>;
  sessions: Record<string, Session>;
  closed: ClosedPane[];
  toasts: Toast[];
  ui: { railExpanded: boolean; railPinned: boolean; paletteOpen: boolean; hints: boolean; theme: "obsidian" | "ivory"; maximized: boolean; runningCount: number; statusHint: string | null };

  init(profiles: Profile[], home: string): void;
  activeWorkspace(): Workspace | null;
  newProject(name: string, root?: string): string;
  switchProject(id: string): void;
  newWorkspace(name?: string): string;
  switchWorkspace(indexOrId: number | string): void;
  newTerminal(opts?: { dir?: L.Dir; profileId?: string; cwd?: string }): void;
  splitPane(dir: L.Dir): void;
  newAgent(opts?: { cwd?: string }): void;
  focusAgent(): void;
  closePane(paneId?: string): void;
  undoClose(): void;
  focusPane(paneId: string): void;
  focusDir(dir: L.Dir): void;
  focusIndex(i: number): void;
  movePane(dir: L.Dir): void;
  resizePane(dir: L.Dir, frac?: number): void;
  setRatio(nodeId: string, index: number, delta: number): void;
  equalize(): void;
  toggleZoom(): void;
  setRail(expanded: boolean, pinned?: boolean): void;
  setPalette(open: boolean): void;
  setHints(on: boolean): void;
  setTheme(t: "obsidian" | "ivory"): void;
  setMaximized(m: boolean): void;
  toast(t: Omit<Toast, "id">, ms?: number): void;
  setStatusHint(s: string | null): void;
  updateSession(id: string, patch: Partial<Session>): void;
}

export const useStore = create<AppState>((set, get) => ({
  profiles: [], defaultProfileId: null, homeDir: "",
  projects: {}, projectOrder: [], activeProjectId: null,
  workspaces: {}, panes: {}, sessions: {}, closed: [], toasts: [],
  ui: { railExpanded: false, railPinned: false, paletteOpen: false, hints: false, theme: "obsidian", maximized: false, runningCount: 0, statusHint: null },

  init(profiles, home) {
    const def = profiles.find((p) => p.id === "pwsh") ?? profiles.find((p) => p.id === "powershell") ?? profiles[0] ?? null;
    set({ profiles, defaultProfileId: def?.id ?? null, homeDir: home });
    if (get().projectOrder.length === 0) {
      const pid = get().newProject("Home", home);
      get().switchProject(pid);
      get().newTerminal({ cwd: home });
    }
  },

  activeWorkspace() {
    const p = get().activeProjectId ? get().projects[get().activeProjectId!] : null;
    return p ? get().workspaces[p.activeWorkspaceId] ?? null : null;
  },

  newProject(name, root) {
    const id = uid("p");
    const wsId = uid("w");
    const color = HUES[get().projectOrder.length % HUES.length];
    set((s) => ({
      workspaces: { ...s.workspaces, [wsId]: { id: wsId, name: "Main", tree: null, focusedPaneId: null, zoomedPaneId: null } },
      projects: { ...s.projects, [id]: { id, name, color, root, workspaceIds: [wsId], activeWorkspaceId: wsId } },
      projectOrder: [...s.projectOrder, id],
    }));
    return id;
  },

  switchProject(id) { set({ activeProjectId: id }); },

  newWorkspace(name) {
    const pid = get().activeProjectId!;
    const wsId = uid("w");
    set((s) => {
      const p = s.projects[pid];
      return {
        workspaces: { ...s.workspaces, [wsId]: { id: wsId, name: name ?? `Workspace ${p.workspaceIds.length + 1}`, tree: null, focusedPaneId: null, zoomedPaneId: null } },
        projects: { ...s.projects, [pid]: { ...p, workspaceIds: [...p.workspaceIds, wsId], activeWorkspaceId: wsId } },
      };
    });
    get().newTerminal();
    return wsId;
  },

  switchWorkspace(indexOrId) {
    const pid = get().activeProjectId!;
    const p = get().projects[pid];
    const wsId = typeof indexOrId === "number" ? p.workspaceIds[indexOrId] : indexOrId;
    if (!wsId || !get().workspaces[wsId]) return;
    set((s) => ({ projects: { ...s.projects, [pid]: { ...s.projects[pid], activeWorkspaceId: wsId } } }));
  },

  newTerminal(opts = {}) {
    const st = get();
    const ws = st.activeWorkspace();
    if (!ws) return;
    const profile = st.profiles.find((p) => p.id === (opts.profileId ?? st.defaultProfileId));
    if (!profile) { st.toast({ title: "No shell found", sub: "Install PowerShell 7 or check your profiles.", kind: "error" }); return; }
    const sessionId = uid("s");
    const paneId = uid("pane");
    const project = st.projects[st.activeProjectId!];
    const focusedSession = ws.focusedPaneId ? st.sessions[st.panes[ws.focusedPaneId]?.sessionId ?? ""] : undefined;
    const cwd = opts.cwd ?? focusedSession?.cwd ?? project.root ?? st.homeDir;

    const session: Session = { id: sessionId, profileId: profile.id, title: profile.name, cwd, running: false, exited: false, exitCode: null, failed: false };
    const inst = T.create(sessionId);
    inst.onTitle = (t) => get().updateSession(sessionId, { title: t || profile.name });
    inst.onCwd = (c) => get().updateSession(sessionId, { cwd: c });
    inst.onCommand = (ev) => {
      const s = get().sessions[sessionId]; if (!s) return;
      if (ev.kind === "start") get().updateSession(sessionId, { running: true, failed: false });
      else get().updateSession(sessionId, { running: false, failed: (ev.exit ?? 0) !== 0 });
    };
    inst.onExit = (code) => {
      get().updateSession(sessionId, { exited: true, exitCode: code, running: false });
      if (code === 0 || code == null) setTimeout(() => { if (get().panes[paneId]) get().closePane(paneId); }, 1200);
    };
    // Start the process once the pane has been laid out (TerminalPane attaches and calls start).

    let tree: L.LayoutNode | null;
    let dir = opts.dir;
    if (!ws.tree || !ws.focusedPaneId) {
      tree = L.leaf(paneId);
    } else {
      if (!dir) {
        // direction with the most space
        const el = document.querySelector<HTMLElement>(`[data-pane="${ws.focusedPaneId}"]`);
        dir = el && el.offsetHeight > el.offsetWidth * 0.9 ? "down" : "right";
      }
      tree = L.split(ws.tree, ws.focusedPaneId, paneId, dir);
    }
    set((s) => ({
      sessions: { ...s.sessions, [sessionId]: session },
      panes: { ...s.panes, [paneId]: { id: paneId, type: "terminal", sessionId } },
      workspaces: { ...s.workspaces, [ws.id]: { ...ws, tree, focusedPaneId: paneId, zoomedPaneId: null } },
    }));
  },

  splitPane(dir) { get().newTerminal({ dir }); },

  newAgent(opts = {}) {
    const st = get();
    const ws = st.activeWorkspace(); if (!ws) return;
    const project = st.projects[st.activeProjectId!];
    const focusedSession = ws.focusedPaneId ? st.sessions[st.panes[ws.focusedPaneId]?.sessionId ?? ""] : undefined;
    const cwd = opts.cwd ?? focusedSession?.cwd ?? project.root ?? st.homeDir;
    const agentId = useAgents.getState().create(cwd);
    const paneId = uid("pane");
    let tree: L.LayoutNode;
    if (!ws.tree) tree = L.leaf(paneId);
    else tree = L.appendColumn(ws.tree, paneId, 0.38);
    set((s) => ({
      panes: { ...s.panes, [paneId]: { id: paneId, type: "agent", agentId } },
      workspaces: { ...s.workspaces, [ws.id]: { ...ws, tree, focusedPaneId: paneId, zoomedPaneId: null } },
    }));
  },

  focusAgent() {
    const st = get();
    const ws = st.activeWorkspace(); if (!ws?.tree) { st.newAgent(); return; }
    const agentLeaf = L.leaves(ws.tree).find((l) => st.panes[l.paneId]?.type === "agent");
    if (agentLeaf) st.focusPane(agentLeaf.paneId); else st.newAgent();
  },

  closePane(paneId) {
    const st = get();
    const ws = st.activeWorkspace();
    if (!ws) return;
    const id = paneId ?? ws.focusedPaneId;
    if (!id) return;
    const pane = st.panes[id];
    const session = pane?.sessionId ? st.sessions[pane.sessionId] : undefined;
    const prevTree = ws.tree;
    const tree = ws.tree ? L.remove(ws.tree, id) : null;
    // choose next focus: geometric neighbor if possible, else first leaf
    let nextFocus: string | null = null;
    if (tree) {
      const ls = L.leaves(tree);
      nextFocus = ls[Math.max(0, Math.min(ls.length - 1, L.leaves(prevTree!).findIndex((l) => l.paneId === id)))]?.paneId ?? ls[0].paneId;
    }
    const closed: ClosedPane = { pane, session, tree: prevTree, workspaceId: ws.id, at: Date.now() };
    set((s) => {
      const panes = { ...s.panes }; delete panes[id];
      return {
        panes,
        closed: [...s.closed.filter((c) => Date.now() - c.at < 30000), closed],
        workspaces: { ...s.workspaces, [ws.id]: { ...ws, tree, focusedPaneId: nextFocus, zoomedPaneId: null } },
      };
    });
    // Keep the session alive for 30 s for undo; then dispose.
    if (session) {
      setTimeout(() => {
        const stillClosed = get().closed.find((c) => c.pane.id === id);
        if (stillClosed) {
          T.dispose(session.id);
          set((s) => { const sessions = { ...s.sessions }; delete sessions[session.id]; return { sessions, closed: s.closed.filter((c) => c.pane.id !== id) }; });
        }
      }, 30000);
      if (!session.exited) get().setStatusHint("Pane closed · Ctrl+Shift+Z to undo");
    }
  },

  undoClose() {
    const st = get();
    const last = st.closed[st.closed.length - 1];
    if (!last || Date.now() - last.at > 30000) return;
    const ws = st.workspaces[last.workspaceId];
    if (!ws) return;
    set((s) => ({
      closed: s.closed.slice(0, -1),
      panes: { ...s.panes, [last.pane.id]: last.pane },
      workspaces: { ...s.workspaces, [ws.id]: { ...ws, tree: last.tree, focusedPaneId: last.pane.id, zoomedPaneId: null } },
    }));
    get().setStatusHint(null);
  },

  focusPane(paneId) {
    const ws = get().activeWorkspace(); if (!ws) return;
    set((s) => ({ workspaces: { ...s.workspaces, [ws.id]: { ...ws, focusedPaneId: paneId, zoomedPaneId: ws.zoomedPaneId === paneId ? ws.zoomedPaneId : null } } }));
  },

  focusDir(dir) {
    const ws = get().activeWorkspace(); if (!ws?.tree || !ws.focusedPaneId) return;
    const area = { x: 0, y: 0, w: 1000, h: 1000 };
    const { panes } = L.layout(ws.tree, area, 6);
    const n = L.neighbor(panes, ws.focusedPaneId, dir);
    if (n) get().focusPane(n);
  },

  focusIndex(i) {
    const ws = get().activeWorkspace(); if (!ws?.tree) return;
    const ls = L.leaves(ws.tree);
    if (ls[i]) get().focusPane(ls[i].paneId);
  },

  movePane(dir) {
    const ws = get().activeWorkspace(); if (!ws?.tree || !ws.focusedPaneId) return;
    const { panes } = L.layout(ws.tree, { x: 0, y: 0, w: 1000, h: 1000 }, 6);
    const n = L.neighbor(panes, ws.focusedPaneId, dir);
    if (!n) return;
    set((s) => ({ workspaces: { ...s.workspaces, [ws.id]: { ...ws, tree: L.swap(ws.tree!, ws.focusedPaneId!, n) } } }));
  },

  resizePane(dir, frac = 0.04) {
    const ws = get().activeWorkspace(); if (!ws?.tree || !ws.focusedPaneId) return;
    set((s) => ({ workspaces: { ...s.workspaces, [ws.id]: { ...ws, tree: L.resize(ws.tree!, ws.focusedPaneId!, dir, frac) } } }));
  },

  setRatio(nodeId, index, delta) {
    const ws = get().activeWorkspace(); if (!ws?.tree) return;
    set((s) => ({ workspaces: { ...s.workspaces, [ws.id]: { ...ws, tree: L.setRatio(ws.tree!, nodeId, index, delta) } } }));
  },

  equalize() {
    const ws = get().activeWorkspace(); if (!ws?.tree) return;
    set((s) => ({ workspaces: { ...s.workspaces, [ws.id]: { ...ws, tree: L.equalize(ws.tree!) } } }));
  },

  toggleZoom() {
    const ws = get().activeWorkspace(); if (!ws?.focusedPaneId) return;
    const z = ws.zoomedPaneId ? null : ws.focusedPaneId;
    set((s) => ({ workspaces: { ...s.workspaces, [ws.id]: { ...ws, zoomedPaneId: z } } }));
    get().setStatusHint(z ? "Zoomed · Alt+Z to restore" : null);
  },

  setRail(expanded, pinned) { set((s) => ({ ui: { ...s.ui, railExpanded: expanded, railPinned: pinned ?? s.ui.railPinned } })); },
  setPalette(open) { set((s) => ({ ui: { ...s.ui, paletteOpen: open } })); },
  setHints(on) { set((s) => ({ ui: { ...s.ui, hints: on } })); },
  setTheme(t) {
    document.documentElement.dataset.theme = t;
    set((s) => ({ ui: { ...s.ui, theme: t } }));
    requestAnimationFrame(() => T.retheme());
  },
  setMaximized(m) { set((s) => ({ ui: { ...s.ui, maximized: m } })); },
  toast(t, ms = 6000) {
    const id = uid("t");
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), ms);
  },
  setStatusHint(hint) {
    set((s) => ({ ui: { ...s.ui, statusHint: hint } }));
    if (hint) setTimeout(() => { if (get().ui.statusHint === hint) set((s) => ({ ui: { ...s.ui, statusHint: null } })); }, 5000);
  },
  updateSession(id, patch) {
    set((s) => {
      const cur = s.sessions[id]; if (!cur) return {};
      const sessions = { ...s.sessions, [id]: { ...cur, ...patch } };
      const runningCount = Object.values(sessions).filter((x) => x.running).length;
      return { sessions, ui: { ...s.ui, runningCount } };
    });
  },
}));
