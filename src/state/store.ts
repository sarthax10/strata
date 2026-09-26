import { create } from "zustand";
import * as L from "../core/layout";
import * as T from "../core/terminals";
import type { Profile } from "../core/pty";
import { useAgents } from "../core/agent";
import * as P from "../core/persist";

export type PaneType = "terminal" | "agent" | "explorer" | "file" | "empty";

export interface Pane { id: string; type: PaneType; sessionId?: string; agentId?: string; filePath?: string }
export interface Session {
  id: string; profileId: string; title: string; cwd?: string;
  running: boolean; exited: boolean; exitCode: number | null; failed: boolean;
  restored?: boolean;
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

  init(profiles: Profile[], home: string, snapshot: P.Snapshot | null): void;
  snapshot(): P.Snapshot;
  restoring: boolean;
  initialized: boolean;
  addProfiles(profiles: Profile[]): void;
  activeWorkspace(): Workspace | null;
  newProject(name: string, root?: string): string;
  switchProject(id: string): void;
  newWorkspace(name?: string): string;
  switchWorkspace(indexOrId: number | string): void;
  newTerminal(opts?: { dir?: L.Dir; profileId?: string; cwd?: string }): void;
  splitPane(dir: L.Dir): void;
  newAgent(opts?: { cwd?: string }): void;
  focusAgent(): void;
  openFolder(path: string, name?: string): string;
  toggleExplorer(): void;
  openFile(path: string): void;
  askClaudeAbout(path: string): void;
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
  workspaces: {}, panes: {}, sessions: {}, closed: [], toasts: [], restoring: false, initialized: false,
  ui: { railExpanded: false, railPinned: false, paletteOpen: false, hints: false, theme: "obsidian", maximized: false, runningCount: 0, statusHint: null },

  init(profiles, home, snapshot) {
    if (get().initialized) return;
    const def = profiles.find((p) => p.id === "pwsh") ?? profiles.find((p) => p.id === "powershell") ?? profiles[0] ?? null;
    set({ profiles, defaultProfileId: def?.id ?? null, homeDir: home, initialized: true });

    if (snapshot && snapshot.projectOrder.length) {
      // Sessions restore as replayed panes: scrollback is written back into a
      // fresh shell started in the same directory (see TerminalPane).
      const sessions: Record<string, Session> = {};
      for (const [id, s] of Object.entries(snapshot.sessions)) {
        sessions[id] = { ...s, running: false, exited: false, exitCode: null, failed: false, restored: true };
      }
      set({
        projects: snapshot.projects,
        projectOrder: snapshot.projectOrder,
        activeProjectId: snapshot.activeProjectId ?? snapshot.projectOrder[0],
        workspaces: snapshot.workspaces as Record<string, Workspace>,
        panes: snapshot.panes,
        sessions,
        restoring: true,
      });
      useAgents.getState().hydrate(snapshot.agents, snapshot.agentOrder);
      if (snapshot.theme !== get().ui.theme) get().setTheme(snapshot.theme);
      if (snapshot.railPinned) get().setRail(true, true);
      const counts = { panes: Object.keys(snapshot.panes).length, agents: snapshot.agentOrder.length };
      if (counts.panes) {
        get().setStatusHint(`Restored ${counts.panes} pane${counts.panes > 1 ? "s" : ""}${counts.agents ? ` · ${counts.agents} Claude session${counts.agents > 1 ? "s" : ""}` : ""}`);
      }
      setTimeout(() => set({ restoring: false }), 1500);
      P.pruneScrollback(Object.keys(sessions)).catch(() => {});
      return;
    }

    const pid = get().newProject("Home", home);
    get().switchProject(pid);
    get().newTerminal({ cwd: home });
  },

  snapshot() {
    const st = get();
    const sessions: P.Snapshot["sessions"] = {};
    for (const [id, s] of Object.entries(st.sessions)) {
      if (s.exited) continue;
      sessions[id] = { id: s.id, profileId: s.profileId, title: s.title, cwd: s.cwd };
    }
    // Drop panes whose session is gone so a restore never shows an empty plate.
    const panes: Record<string, Pane> = {};
    for (const [id, p] of Object.entries(st.panes)) {
      if (p.type === "terminal" && (!p.sessionId || !sessions[p.sessionId])) continue;
      if (p.type === "agent" && (!p.agentId || !useAgents.getState().sessions[p.agentId])) continue;
      panes[id] = p;
    }
    const workspaces: P.Snapshot["workspaces"] = {};
    for (const [id, w] of Object.entries(st.workspaces)) {
      const tree = w.tree ? L.prune(w.tree, (paneId) => !!panes[paneId]) : null;
      workspaces[id] = { ...w, tree, zoomedPaneId: null, focusedPaneId: w.focusedPaneId && panes[w.focusedPaneId] ? w.focusedPaneId : null };
    }
    const A = useAgents.getState();
    const agents: Record<string, P.PersistedAgent> = {};
    for (const id of A.order) {
      const a = A.sessions[id];
      if (!a) continue;
      agents[id] = {
        id: a.id, cwd: a.cwd, title: a.title, claudeSessionId: a.claudeSessionId,
        model: a.model, effort: a.effort, mode: a.mode, turns: P.trimTurns(a.turns),
        costUsd: a.costUsd, context: a.context, draft: a.draft, endedAt: Date.now(),
      };
    }
    return {
      schema: P.SCHEMA, savedAt: Date.now(), theme: st.ui.theme, railPinned: st.ui.railPinned,
      activeProjectId: st.activeProjectId, projectOrder: st.projectOrder, projects: st.projects,
      workspaces, panes, sessions, agents, agentOrder: A.order.filter((id) => agents[id]),
    };
  },

  addProfiles(profiles) { set((s) => ({ profiles: [...s.profiles, ...profiles.filter((p) => !s.profiles.some((q) => q.id === p.id))] })); },

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
    // Shells often report their own exe path as the OSC title; that is noise.
    inst.onTitle = (t) => {
      const clean = t && !/\.exe$/i.test(t.trim()) && !t.includes("\\") ? t.trim() : "";
      get().updateSession(sessionId, { title: clean || profile.name });
    };
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

  openFolder(path, name) {
    const clean = path.replace(/[\\/]+$/, "");
    const label = name ?? clean.replace(/\\/g, "/").split("/").filter(Boolean).slice(-1)[0] ?? "Project";
    const existing = get().projectOrder.find((id) => get().projects[id].root?.toLowerCase() === clean.toLowerCase());
    if (existing) { get().switchProject(existing); return existing; }
    const id = get().newProject(label, clean);
    get().switchProject(id);
    get().newTerminal({ cwd: clean });
    get().toggleExplorer();
    return id;
  },

  toggleExplorer() {
    const st = get();
    const ws = st.activeWorkspace(); if (!ws) return;
    const existing = ws.tree ? L.leaves(ws.tree).find((l) => st.panes[l.paneId]?.type === "explorer") : undefined;
    if (existing) { st.closePane(existing.paneId); return; }
    const paneId = uid("pane");
    const tree = ws.tree ? L.prependColumn(ws.tree, paneId, 0.2) : L.leaf(paneId);
    set((s) => ({
      panes: { ...s.panes, [paneId]: { id: paneId, type: "explorer" } },
      workspaces: { ...s.workspaces, [ws.id]: { ...ws, tree, zoomedPaneId: null } },
    }));
  },

  openFile(path) {
    const st = get();
    const ws = st.activeWorkspace(); if (!ws) return;
    // Reuse the file pane if one is open, so browsing does not pile up panes.
    const existing = ws.tree ? L.leaves(ws.tree).find((l) => st.panes[l.paneId]?.type === "file") : undefined;
    if (existing) {
      set((s) => ({
        panes: { ...s.panes, [existing.paneId]: { ...s.panes[existing.paneId], filePath: path } },
        workspaces: { ...s.workspaces, [ws.id]: { ...ws, focusedPaneId: existing.paneId } },
      }));
      return;
    }
    const paneId = uid("pane");
    let tree: L.LayoutNode;
    if (!ws.tree) tree = L.leaf(paneId);
    else {
      // Open beside the explorer if there is one, otherwise split the focus.
      const anchor = L.leaves(ws.tree).find((l) => st.panes[l.paneId]?.type === "explorer")?.paneId
        ?? ws.focusedPaneId ?? L.leaves(ws.tree)[0].paneId;
      tree = L.split(ws.tree, anchor, paneId, "right");
    }
    set((s) => ({
      panes: { ...s.panes, [paneId]: { id: paneId, type: "file", filePath: path } },
      workspaces: { ...s.workspaces, [ws.id]: { ...ws, tree, focusedPaneId: paneId, zoomedPaneId: null } },
    }));
  },

  askClaudeAbout(path) {
    const st = get();
    const ws = st.activeWorkspace(); if (!ws) return;
    const A = useAgents.getState();
    let agentId = ws.tree
      ? L.leaves(ws.tree).map((l) => st.panes[l.paneId]).find((p) => p?.type === "agent")?.agentId
      : undefined;
    if (!agentId) { st.newAgent(); agentId = useAgents.getState().order[useAgents.getState().order.length - 1]; }
    if (!agentId) return;
    const rel = path.replace(/\\/g, "/");
    const cur = useAgents.getState().sessions[agentId]?.draft ?? "";
    A.setDraft(agentId, `${cur}${cur && !cur.endsWith(" ") ? " " : ""}@${rel} `);
    st.focusAgent();
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
