// Agent session model: drives one agent-host process and reduces the SDK
// stream into turns, activity items, a "now" state and permission requests.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

export type ToolFamily = "read" | "edit" | "run" | "browser" | "web" | "agent" | "plan" | "question" | "mcp" | "other";
export type ToolStatus = "running" | "done" | "failed" | "denied";

export interface TextItem { kind: "text"; id: string; text: string; live?: boolean }
export interface ThinkingItem { kind: "thinking"; id: string; text: string; startedAt: number; endedAt?: number }
export interface ToolItem {
  kind: "tool"; id: string; toolUseId: string; name: string; family: ToolFamily; input: Record<string, unknown>;
  status: ToolStatus; startedAt: number; endedAt?: number; result?: string; resultIsError?: boolean; structured?: unknown;
  parentToolUseId?: string | null;
}
export interface DividerItem { kind: "divider"; id: string; text: string }
export type Item = TextItem | ThinkingItem | ToolItem | DividerItem;

export interface Turn {
  id: string; userText: string; images: ImageAttachment[]; items: Item[];
  startedAt: number; endedAt?: number; status: "running" | "done" | "error" | "interrupted";
  result?: { costUsd?: number; durationMs?: number; error?: string; filesChanged: string[] };
}

export interface ImageAttachment { id: string; name: string; mediaType: string; data: string /* base64 */; url: string }

export interface PermissionRequest {
  requestId: string; toolName: string; input: Record<string, unknown>; suggestions: unknown[]; family: ToolFamily; at: number;
}

export interface Now { kind: "idle" | "thinking" | "tool" | "permission" | "question" | "compacting" | "error"; label: string; since: number; toolId?: string }

export interface ModelInfo { value: string; displayName: string; description: string; supportsEffort?: boolean; supportedEffortLevels?: string[]; resolvedModel?: string }
export interface SlashCommand { name: string; description: string; argumentHint?: string }

export interface AgentSession {
  id: string; hostId: number | null; cwd: string; title: string; claudeSessionId?: string;
  model: string; effort: string; mode: "default" | "acceptEdits" | "plan";
  turns: Turn[]; now: Now; permissions: PermissionRequest[];
  context: { used: number; window: number }; costUsd: number;
  models: ModelInfo[]; commands: SlashCommand[]; account?: { email?: string; subscriptionType?: string };
  status: "new" | "starting" | "working" | "needs-you" | "idle" | "failed" | "ended";
  error?: string; draft: string; tray: ImageAttachment[]; unread: boolean; restored?: boolean;
}

let seq = 0;
const uid = (p: string) => `${p}${++seq}_${Date.now().toString(36)}`;

export function familyOf(name: string): ToolFamily {
  if (["Read", "Glob", "Grep", "LS", "NotebookRead"].includes(name)) return "read";
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(name)) return "edit";
  if (name === "Bash" || name === "PowerShell") return "run";
  if (["WebFetch", "WebSearch"].includes(name)) return "web";
  if (name === "Task" || name === "Agent") return "agent";
  if (name === "TodoWrite" || name === "ExitPlanMode" || name === "EnterPlanMode") return "plan";
  if (name === "AskUserQuestion") return "question";
  if (name.startsWith("mcp__")) return name.includes("browser") ? "browser" : "mcp";
  return "other";
}

/** Verb + object label for an activity row. */
export function describeTool(t: { name: string; input: Record<string, unknown>; status?: ToolStatus }): { verb: string; object: string } {
  const i = t.input as any;
  const base = (p?: string) => (p ? String(p).replace(/\\/g, "/").split("/").slice(-2).join("/") : "");
  switch (t.name) {
    case "Read": return { verb: "Read", object: base(i.file_path) };
    case "Glob": return { verb: "Searched files", object: String(i.pattern ?? "") };
    case "Grep": return { verb: "Searched", object: `"${i.pattern ?? ""}"` };
    case "LS": return { verb: "Listed", object: base(i.path) };
    case "Edit": case "MultiEdit": return { verb: t.status === "running" ? "Editing" : "Edited", object: base(i.file_path) };
    case "Write": return { verb: t.status === "running" ? "Writing" : "Wrote", object: base(i.file_path) };
    case "NotebookEdit": return { verb: "Edited notebook", object: base(i.notebook_path) };
    case "Bash": case "PowerShell": return { verb: t.status === "running" ? "Running" : "Ran", object: String(i.command ?? "").split("\n")[0].slice(0, 120) };
    case "WebFetch": return { verb: "Fetched", object: String(i.url ?? "") };
    case "WebSearch": return { verb: "Searched web", object: `"${i.query ?? ""}"` };
    case "Task": case "Agent": return { verb: "Delegated", object: String(i.description ?? i.prompt ?? "").slice(0, 80) };
    case "TodoWrite": return { verb: "Updated plan", object: `${(i.todos ?? []).length} items` };
    case "AskUserQuestion": return { verb: "Asked you", object: "" };
    case "ExitPlanMode": return { verb: "Proposed plan", object: "" };
    default: return { verb: t.name.replace(/^mcp__/, "").replace(/__/g, ": "), object: "" };
  }
}

interface AgentsState {
  sessions: Record<string, AgentSession>;
  order: string[];
  create(cwd: string, title?: string): string;
  send(id: string, text: string, images?: ImageAttachment[]): Promise<void>;
  decide(id: string, requestId: string, behavior: "allow" | "deny", extra?: { message?: string; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] }): void;
  interrupt(id: string): void;
  setModel(id: string, model: string): void;
  setEffort(id: string, effort: string): void;
  setMode(id: string, mode: AgentSession["mode"]): void;
  setDraft(id: string, draft: string): void;
  addTray(id: string, att: ImageAttachment): void;
  removeTray(id: string, attId: string): void;
  rename(id: string, title: string): void;
  markRead(id: string): void;
  remove(id: string): void;
  hydrate(agents: Record<string, any>, order: string[]): void;
  _patch(id: string, fn: (s: AgentSession) => Partial<AgentSession> | void): void;
}

const hostToSession = new Map<number, string>();
let listening = false;

async function ensureListeners() {
  if (listening) return; listening = true;
  await listen<{ id: number; line: string }>("agent-line", (e) => {
    const sid = hostToSession.get(e.payload.id); if (!sid) return;
    let msg: any; try { msg = JSON.parse(e.payload.line); } catch { return; }
    handleHostMessage(sid, msg);
  });
  await listen<{ id: number; line: string }>("agent-stderr", (e) => {
    const sid = hostToSession.get(e.payload.id); if (!sid) return;
    if (/error/i.test(e.payload.line)) console.warn("[agent]", e.payload.line);
  });
  await listen<{ id: number; code: number | null }>("agent-exit", (e) => {
    const sid = hostToSession.get(e.payload.id); if (!sid) return;
    hostToSession.delete(e.payload.id);
    useAgents.getState()._patch(sid, (s) => ({
      hostId: null,
      status: s.status === "failed" ? "failed" : "ended",
      now: { kind: "idle", label: "", since: Date.now() },
      turns: s.turns.map((t) => (t.status === "running" ? { ...t, status: "interrupted", endedAt: Date.now() } : t)),
    }));
  });
}

const send = (hostId: number, obj: unknown) => invoke("agent_send", { id: hostId, line: JSON.stringify(obj) });

export const useAgents = create<AgentsState>((set, get) => ({
  sessions: {}, order: [],

  create(cwd, title) {
    const id = uid("a");
    const s: AgentSession = {
      id, hostId: null, cwd, title: title ?? "New session", model: "", effort: "", mode: "default",
      turns: [], now: { kind: "idle", label: "", since: Date.now() }, permissions: [],
      context: { used: 0, window: 200000 }, costUsd: 0, models: [], commands: [], status: "new", draft: "", tray: [], unread: false,
    };
    set((st) => ({ sessions: { ...st.sessions, [id]: s }, order: [...st.order, id] }));
    return id;
  },

  async send(id, text, images = []) {
    const s = get().sessions[id]; if (!s) return;
    const turn: Turn = { id: uid("t"), userText: text, images, items: [], startedAt: Date.now(), status: "running" };
    const imgs = images.map((i) => ({ mediaType: i.mediaType, data: i.data }));
    if (s.hostId == null) {
      await ensureListeners();
      get()._patch(id, () => ({ status: "starting", turns: [...s.turns, turn], draft: "", tray: [], title: s.turns.length === 0 && s.title === "New session" ? text.slice(0, 48) : s.title, now: { kind: "thinking", label: "Starting Claude Code…", since: Date.now() } }));
      try {
        const hostId = await invoke<number>("agent_spawn", { cwd: s.cwd });
        hostToSession.set(hostId, id);
        get()._patch(id, () => ({ hostId }));
        await send(hostId, { type: "start", cwd: s.cwd, prompt: text, images: imgs, model: s.model || undefined, effort: s.effort || undefined, permissionMode: s.mode, resume: s.claudeSessionId });
      } catch (e: any) {
        const msg = String(e?.message ?? e).replace(/^Error:\s*/, "");
        get()._patch(id, () => ({ status: "failed", error: msg, now: { kind: "error", label: msg, since: Date.now() } }));
      }
    } else {
      get()._patch(id, (cur) => ({ status: "working", turns: [...cur.turns, turn], draft: "", tray: [], now: { kind: "thinking", label: "Thinking…", since: Date.now() } }));
      await send(s.hostId, { type: "prompt", text, images: imgs });
    }
  },

  decide(id, requestId, behavior, extra = {}) {
    const s = get().sessions[id]; if (!s || s.hostId == null) return;
    send(s.hostId, { type: "permission", requestId, behavior, ...extra });
    get()._patch(id, (cur) => {
      const permissions = cur.permissions.filter((p) => p.requestId !== requestId);
      // mark the matching tool row
      const turns = cur.turns.map((t) => ({
        ...t, items: t.items.map((it) => (it.kind === "tool" && it.status === "running" && it.name === cur.permissions.find((p) => p.requestId === requestId)?.toolName && behavior === "deny" ? { ...it, status: "denied" as const, endedAt: Date.now() } : it)),
      }));
      return { permissions, turns, status: "working", now: permissions.length ? cur.now : { kind: "thinking", label: "Working…", since: Date.now() } };
    });
  },

  interrupt(id) { const s = get().sessions[id]; if (s?.hostId != null) send(s.hostId, { type: "interrupt" }); },
  setModel(id, model) { const s = get().sessions[id]; if (!s) return; get()._patch(id, () => ({ model })); if (s.hostId != null) send(s.hostId, { type: "setModel", model }); },
  setEffort(id, effort) { const s = get().sessions[id]; if (!s) return; get()._patch(id, () => ({ effort })); if (s.hostId != null) send(s.hostId, { type: "setEffort", effort }); },
  setMode(id, mode) { const s = get().sessions[id]; if (!s) return; get()._patch(id, () => ({ mode })); if (s.hostId != null) send(s.hostId, { type: "setMode", mode }); },
  setDraft(id, draft) { get()._patch(id, () => ({ draft })); },
  addTray(id, att) { get()._patch(id, (s) => ({ tray: [...s.tray, att] })); },
  removeTray(id, attId) { get()._patch(id, (s) => ({ tray: s.tray.filter((a) => a.id !== attId) })); },
  rename(id, title) { get()._patch(id, () => ({ title })); },
  markRead(id) { get()._patch(id, () => ({ unread: false })); },
  remove(id) {
    const s = get().sessions[id];
    if (s?.hostId != null) invoke("agent_kill", { id: s.hostId });
    set((st) => { const sessions = { ...st.sessions }; delete sessions[id]; return { sessions, order: st.order.filter((x) => x !== id) }; });
  },
  hydrate(agents, order) {
    const sessions: Record<string, AgentSession> = {};
    for (const id of order) {
      const a = agents[id];
      if (!a) continue;
      sessions[id] = {
        id: a.id, hostId: null, cwd: a.cwd, title: a.title, claudeSessionId: a.claudeSessionId,
        model: a.model ?? "", effort: a.effort ?? "", mode: a.mode ?? "default",
        turns: (a.turns ?? []).map((t: Turn) => (t.status === "running" ? { ...t, status: "interrupted" as const } : t)),
        now: { kind: "idle", label: "", since: Date.now() }, permissions: [],
        context: a.context ?? { used: 0, window: 200000 }, costUsd: a.costUsd ?? 0,
        models: [], commands: [], status: "idle", draft: a.draft ?? "", tray: [], unread: false, restored: true,
      };
    }
    set({ sessions, order: order.filter((id) => sessions[id]) });
  },

  _patch(id, fn) {
    set((st) => { const cur = st.sessions[id]; if (!cur) return {}; const p = fn(cur); return p ? { sessions: { ...st.sessions, [id]: { ...cur, ...p } } } : {}; });
  },
}));

// ---------- reducer over host messages ----------

function currentTurn(s: AgentSession): Turn | undefined { return s.turns[s.turns.length - 1]; }
function updateTurn(s: AgentSession, fn: (t: Turn) => Turn): Turn[] {
  const t = currentTurn(s); if (!t) return s.turns;
  return [...s.turns.slice(0, -1), fn(t)];
}

function handleHostMessage(sid: string, msg: any) {
  const A = useAgents.getState();
  if (msg.type === "host") {
    if (msg.event === "ready") { const s = A.sessions[sid]; if (s?.hostId != null) send(s.hostId, { type: "info" }); }
    if (msg.event === "error") A._patch(sid, () => ({ status: "failed", error: msg.message, now: { kind: "error", label: msg.message, since: Date.now() } }));
    return;
  }
  if (msg.type === "info") {
    A._patch(sid, (s) => ({ models: msg.models ?? [], commands: msg.commands ?? [], account: msg.account ?? undefined, model: s.model || (msg.models?.[0]?.value ?? s.model) }));
    return;
  }
  if (msg.type === "permission_request") {
    const req: PermissionRequest = { requestId: msg.requestId, toolName: msg.toolName, input: msg.input ?? {}, suggestions: msg.suggestions ?? [], family: familyOf(msg.toolName), at: Date.now() };
    A._patch(sid, (s) => ({
      permissions: [...s.permissions, req], status: "needs-you", unread: true,
      now: { kind: req.family === "question" ? "question" : "permission", label: req.family === "question" ? "Asked you a question" : `Wants to ${wantVerb(req.family)} ${describeTool({ name: req.toolName, input: req.input }).object}`.trim(), since: Date.now() },
    }));
    return;
  }
  if (msg.type === "permission_cancelled") {
    A._patch(sid, (s) => ({ permissions: s.permissions.filter((p) => p.requestId !== msg.requestId) }));
    return;
  }
  if (msg.type !== "sdk") return;
  const m = msg.message;
  switch (m.type) {
    case "system": {
      if (m.subtype === "init") {
        A._patch(sid, (s) => ({ claudeSessionId: m.session_id, model: m.model ?? s.model, status: "working", now: { kind: "thinking", label: "Thinking…", since: Date.now() } }));
      } else if (m.subtype === "status") {
        if (m.status === "compacting") A._patch(sid, () => ({ now: { kind: "compacting", label: "Compacting context…", since: Date.now() } }));
      } else if (m.subtype === "compact_boundary") {
        A._patch(sid, (s) => ({ turns: updateTurn(s, (t) => ({ ...t, items: [...t.items, { kind: "divider", id: uid("d"), text: "compacted" }] })) }));
      }
      return;
    }
    case "stream_event": {
      const ev = m.event;
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        A._patch(sid, (s) => ({
          turns: updateTurn(s, (t) => {
            const last = t.items[t.items.length - 1];
            if (last?.kind === "text" && last.live) return { ...t, items: [...t.items.slice(0, -1), { ...last, text: last.text + ev.delta.text }] };
            return { ...t, items: [...t.items, { kind: "text", id: uid("x"), text: ev.delta.text, live: true }] };
          }),
          now: s.now.kind === "thinking" ? { kind: "thinking", label: "Writing…", since: s.now.since } : s.now,
        }));
      } else if (ev.type === "content_block_start" && ev.content_block?.type === "thinking") {
        A._patch(sid, (s) => ({ now: { kind: "thinking", label: "Thinking…", since: Date.now() }, turns: updateTurn(s, (t) => ({ ...t, items: [...t.items, { kind: "thinking", id: uid("th"), text: "", startedAt: Date.now() }] })) }));
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta") {
        A._patch(sid, (s) => ({ turns: updateTurn(s, (t) => { const last = t.items[t.items.length - 1]; return last?.kind === "thinking" ? { ...t, items: [...t.items.slice(0, -1), { ...last, text: last.text + ev.delta.thinking }] } : t; }) }));
      }
      return;
    }
    case "assistant": {
      const content: any[] = m.message?.content ?? [];
      const usage = m.message?.usage;
      A._patch(sid, (s) => {
        let now = s.now;
        const turns = updateTurn(s, (t) => {
          // finalize live text, close thinking, add tool rows
          let items = t.items.map((it) => (it.kind === "text" && it.live ? { ...it, live: false } : it.kind === "thinking" && !it.endedAt ? { ...it, endedAt: Date.now() } : it));
          for (const b of content) {
            if (b.type === "text") {
              const last = items[items.length - 1];
              if (!(last?.kind === "text" && last.text.trim() === b.text.trim())) {
                // stream deltas may have produced it already; only add when missing
                if (!items.some((it) => it.kind === "text" && it.text.trim() === b.text.trim())) items.push({ kind: "text", id: uid("x"), text: b.text });
              }
            } else if (b.type === "tool_use") {
              const name = b.name as string;
              const tool: ToolItem = { kind: "tool", id: uid("tool"), toolUseId: b.id, name, family: familyOf(name), input: b.input ?? {}, status: "running", startedAt: Date.now(), parentToolUseId: m.parent_tool_use_id ?? null };
              items.push(tool);
              const d = describeTool(tool);
              now = { kind: "tool", label: `${d.verb} ${d.object}`.trim(), since: Date.now(), toolId: tool.id };
            }
          }
          return { ...t, items };
        });
        const ctx = usage ? { used: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0), window: s.context.window } : s.context;
        return { turns, now, context: ctx, status: s.permissions.length ? "needs-you" : "working" };
      });
      return;
    }
    case "user": {
      const content: any[] = Array.isArray(m.message?.content) ? m.message.content : [];
      const results = content.filter((b) => b.type === "tool_result");
      if (!results.length) return;
      A._patch(sid, (s) => {
        let now = s.now;
        const turns = updateTurn(s, (t) => ({
          ...t,
          items: t.items.map((it) => {
            if (it.kind !== "tool") return it;
            const r = results.find((x) => x.tool_use_id === it.toolUseId);
            if (!r) return it;
            const text = typeof r.content === "string" ? r.content : (r.content ?? []).map((c: any) => (c.type === "text" ? c.text : "")).join("\n");
            const isErr = !!r.is_error;
            if (now.toolId === it.id) now = { kind: "thinking", label: "Thinking…", since: Date.now() };
            return { ...it, status: it.status === "denied" ? "denied" : isErr ? "failed" : "done", endedAt: Date.now(), result: text.slice(0, 20000), resultIsError: isErr, structured: m.tool_use_result };
          }),
        }));
        return { turns, now };
      });
      return;
    }
    case "result": {
      A._patch(sid, (s) => {
        const ok = m.subtype === "success" && !m.is_error;
        const turns = updateTurn(s, (t) => ({
          ...t, status: ok ? "done" : "error", endedAt: Date.now(),
          items: t.items.map((it) => (it.kind === "text" && it.live ? { ...it, live: false } : it)),
          result: { costUsd: m.total_cost_usd, durationMs: m.duration_ms, error: ok ? undefined : (m.result ?? m.subtype), filesChanged: filesChangedIn(t) },
        }));
        const mu = m.modelUsage ? (Object.values(m.modelUsage)[0] as any) : null;
        const window = mu?.contextWindow ?? s.context.window;
        return { turns, status: ok ? "idle" : "failed", error: ok ? undefined : String(m.result ?? m.subtype), costUsd: m.total_cost_usd ?? s.costUsd, context: { ...s.context, window }, now: { kind: "idle", label: "", since: Date.now() }, unread: true };
      });
      return;
    }
    case "rate_limit_event": {
      if (m.rate_limit_info?.status === "rejected" || m.rate_limit_info?.status === "limited") A._patch(sid, () => ({ now: { kind: "error", label: "Rate limited · retrying", since: Date.now() } }));
      return;
    }
    default: return;
  }
}

export function wantVerb(f: ToolFamily): string {
  return { read: "read", edit: "edit", run: "run", browser: "use the browser on", web: "fetch", agent: "delegate", plan: "update the plan", question: "ask", mcp: "use", other: "use" }[f];
}

function filesChangedIn(t: Turn): string[] {
  const set = new Set<string>();
  for (const it of t.items) if (it.kind === "tool" && it.family === "edit" && it.status === "done") { const p = (it.input as any).file_path ?? (it.input as any).notebook_path; if (p) set.add(String(p)); }
  return [...set];
}
