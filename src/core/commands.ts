// Command registry: every action reachable from the palette and keymap.
import { useStore } from "../state/store";

export interface Command {
  id: string;
  title: string;
  category: "Pane" | "Workspace" | "Project" | "Terminal" | "Appearance" | "Session" | "Agent";
  shortcut?: string;
  run: () => void;
  when?: () => boolean;
}

export function commands(): Command[] {
  const s = useStore.getState();
  const hasPane = () => !!useStore.getState().activeWorkspace()?.focusedPaneId;
  const list: Command[] = [
    { id: "agent.focus", title: "Ask Claude", category: "Agent", shortcut: "Ctrl+Shift+A", run: () => s.focusAgent() },
    { id: "agent.new", title: "New Claude session", category: "Agent", shortcut: "Ctrl+Shift+Alt+A", run: () => s.newAgent() },
    { id: "terminal.new", title: "New terminal", category: "Terminal", shortcut: "Ctrl+Shift+T", run: () => s.newTerminal() },
    { id: "pane.splitRight", title: "Split right", category: "Pane", shortcut: "Ctrl+Shift+D", run: () => s.splitPane("right"), when: hasPane },
    { id: "pane.splitDown", title: "Split down", category: "Pane", shortcut: "Ctrl+Shift+E", run: () => s.splitPane("down"), when: hasPane },
    { id: "pane.splitLeft", title: "Split left", category: "Pane", shortcut: "Ctrl+Shift+Alt+D", run: () => s.splitPane("left"), when: hasPane },
    { id: "pane.splitUp", title: "Split up", category: "Pane", shortcut: "Ctrl+Shift+Alt+E", run: () => s.splitPane("up"), when: hasPane },
    { id: "pane.close", title: "Close pane", category: "Pane", shortcut: "Ctrl+Shift+W", run: () => s.closePane(), when: hasPane },
    { id: "pane.undoClose", title: "Reopen closed pane", category: "Pane", shortcut: "Ctrl+Shift+Z", run: () => s.undoClose() },
    { id: "pane.zoom", title: "Zoom pane", category: "Pane", shortcut: "Alt+Z", run: () => s.toggleZoom(), when: hasPane },
    { id: "pane.equalize", title: "Equalize panes", category: "Pane", shortcut: "Ctrl+Shift+=", run: () => s.equalize(), when: hasPane },
    { id: "pane.focusLeft", title: "Focus pane left", category: "Pane", shortcut: "Alt+←", run: () => s.focusDir("left"), when: hasPane },
    { id: "pane.focusRight", title: "Focus pane right", category: "Pane", shortcut: "Alt+→", run: () => s.focusDir("right"), when: hasPane },
    { id: "pane.focusUp", title: "Focus pane up", category: "Pane", shortcut: "Alt+↑", run: () => s.focusDir("up"), when: hasPane },
    { id: "pane.focusDown", title: "Focus pane down", category: "Pane", shortcut: "Alt+↓", run: () => s.focusDir("down"), when: hasPane },
    { id: "workspace.new", title: "New workspace", category: "Workspace", shortcut: "Ctrl+Shift+Alt+N", run: () => s.newWorkspace() },
    { id: "project.new", title: "New project", category: "Project", run: () => { const id = s.newProject(`Project ${s.projectOrder.length + 1}`); s.switchProject(id); s.newTerminal(); } },
    { id: "rail.toggle", title: "Toggle rail", category: "Appearance", shortcut: "Ctrl+Shift+B", run: () => { const u = useStore.getState().ui; s.setRail(!u.railPinned, !u.railPinned); } },
    { id: "theme.obsidian", title: "Theme: Obsidian (dark)", category: "Appearance", run: () => s.setTheme("obsidian") },
    { id: "theme.ivory", title: "Theme: Ivory (light)", category: "Appearance", run: () => s.setTheme("ivory") },
  ];
  // workspaces of the active project
  const p = s.activeProjectId ? s.projects[s.activeProjectId] : null;
  p?.workspaceIds.forEach((id, i) => {
    const w = s.workspaces[id];
    list.push({ id: `workspace.go.${id}`, title: `Go to workspace: ${w.name}`, category: "Workspace", shortcut: i < 9 ? `Ctrl+Shift+${i + 1}` : undefined, run: () => s.switchWorkspace(id) });
  });
  s.projectOrder.forEach((id) => {
    const pr = s.projects[id];
    if (id !== s.activeProjectId) list.push({ id: `project.go.${id}`, title: `Go to project: ${pr.name}`, category: "Project", run: () => s.switchProject(id) });
  });
  s.profiles.forEach((pr) => {
    list.push({ id: `profile.${pr.id}`, title: `New terminal: ${pr.name}`, category: "Terminal", run: () => s.newTerminal({ profileId: pr.id }) });
  });
  return list.filter((c) => !c.when || c.when());
}

/** Simple subsequence fuzzy score; higher is better, -1 = no match. */
export function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase(), t = text.toLowerCase();
  if (!q) return 0;
  if (t.startsWith(q)) return 100 + q.length;
  if (t.includes(q)) return 60 + q.length;
  let qi = 0, score = 0, streak = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) { qi++; streak++; score += 2 + streak; if (i === 0 || t[i - 1] === " ") score += 4; }
    else streak = 0;
  }
  return qi === q.length ? score : -1;
}
