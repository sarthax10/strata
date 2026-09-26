// Persistence: snapshot the workspace model to disk and restore it on launch.
//
// Layer 0/1 (frame + layout) come from state.json and are applied before the
// first paint. Layer 3 (terminals) replays each session's scrollback and
// starts a fresh shell in the last cwd. Layer 4 (agents) restores transcripts
// from the snapshot; the Claude Code process resumes lazily on the next prompt.

import { invoke } from "@tauri-apps/api/core";
import type { Pane, Project, Session, Workspace } from "../state/store";
import type { AgentSession, Turn } from "./agent";
import type { LayoutNode } from "./layout";

export const SCHEMA = 1;

export interface Snapshot {
  schema: number;
  savedAt: number;
  theme: "obsidian" | "ivory";
  railPinned: boolean;
  activeProjectId: string | null;
  projectOrder: string[];
  projects: Record<string, Project>;
  workspaces: Record<string, Omit<Workspace, "tree"> & { tree: LayoutNode | null }>;
  panes: Record<string, Pane>;
  sessions: Record<string, Pick<Session, "id" | "profileId" | "title" | "cwd">>;
  agents: Record<string, PersistedAgent>;
  agentOrder: string[];
}

export interface PersistedAgent {
  id: string; cwd: string; title: string; claudeSessionId?: string;
  model: string; effort: string; mode: AgentSession["mode"];
  turns: Turn[]; costUsd: number; context: { used: number; window: number };
  draft: string; endedAt: number;
}

export const saveState = (s: Snapshot) => invoke("state_save", { json: JSON.stringify(s) });

export async function loadState(): Promise<Snapshot | null> {
  try {
    const raw = await invoke<string | null>("state_load");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snapshot;
    return parsed.schema === SCHEMA ? parsed : null;
  } catch {
    return null;
  }
}

export const saveScrollback = (id: string, text: string) => invoke("scrollback_save", { id, text });
export const loadScrollback = (id: string) => invoke<string | null>("scrollback_load", { id });
export const pruneScrollback = (keep: string[]) => invoke("scrollback_prune", { keep });
export const pathExists = (path: string) => invoke<boolean>("path_exists", { path });

/** Strip attachment data URLs and huge tool payloads before writing to disk. */
export function trimTurns(turns: Turn[]): Turn[] {
  return turns.slice(-60).map((t) => ({
    ...t,
    images: t.images.map((i) => ({ ...i, data: "", url: "" })),
    items: t.items.map((it) =>
      it.kind === "tool"
        ? { ...it, result: it.result ? it.result.slice(0, 4000) : undefined, structured: undefined }
        : it),
  }));
}
