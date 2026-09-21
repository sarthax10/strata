// Strata agent host: runs ONE Claude Code session through the Claude Agent SDK
// and speaks newline-delimited JSON on stdin/stdout.
//
//   in : {type:"start", cwd, prompt, model?, effort?, permissionMode?, resume?, images?}
//        {type:"prompt", text, images?}            — next turn
//        {type:"permission", requestId, behavior:"allow"|"deny", message?, updatedInput?, updatedPermissions?}
//        {type:"interrupt"} | {type:"setModel", model} | {type:"setMode", mode} | {type:"setEffort", effort}
//        {type:"info"}                              — request models/commands/account
//   out: {type:"sdk", message}                      — every SDKMessage, verbatim
//        {type:"permission_request", requestId, toolName, input, suggestions}
//        {type:"info", models, commands, account}
//        {type:"host", event:"ready"|"ended"|"error", ...}

import { query, type Query, type SDKUserMessage, type PermissionResult, type Options } from "@anthropic-ai/claude-agent-sdk";
import * as readline from "node:readline";

type Inbound =
  | { type: "start"; cwd: string; prompt: string; model?: string; effort?: Options["effort"]; permissionMode?: Options["permissionMode"]; resume?: string; images?: ImageIn[] }
  | { type: "prompt"; text: string; images?: ImageIn[] }
  | { type: "permission"; requestId: string; behavior: "allow" | "deny"; message?: string; updatedInput?: Record<string, unknown>; updatedPermissions?: unknown[] }
  | { type: "interrupt" } | { type: "setModel"; model: string } | { type: "setMode"; mode: Options["permissionMode"] } | { type: "setEffort"; effort: string }
  | { type: "info" };

interface ImageIn { mediaType: string; data: string }

const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");

// ---- streaming input: a queue the SDK pulls user turns from ----
const queue: SDKUserMessage[] = [];
let wake: (() => void) | null = null;
let closed = false;
function push(msg: SDKUserMessage) { queue.push(msg); wake?.(); }
async function* input(): AsyncIterable<SDKUserMessage> {
  while (!closed) {
    if (queue.length) { yield queue.shift()!; continue; }
    await new Promise<void>((r) => { wake = r; });
    wake = null;
  }
}

function userMessage(text: string, images?: ImageIn[]): SDKUserMessage {
  const content: any[] = [];
  for (const im of images ?? []) content.push({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.data } });
  content.push({ type: "text", text });
  return { type: "user", message: { role: "user", content: images?.length ? content : text }, parent_tool_use_id: null } as SDKUserMessage;
}

// ---- permissions: bridge canUseTool to the UI ----
const pending = new Map<string, (r: PermissionResult) => void>();
let reqSeq = 0;
const canUseTool: Options["canUseTool"] = (toolName, input, { signal, suggestions }) =>
  new Promise<PermissionResult>((resolve) => {
    const requestId = `perm_${++reqSeq}`;
    pending.set(requestId, resolve);
    out({ type: "permission_request", requestId, toolName, input, suggestions: suggestions ?? [] });
    signal.addEventListener("abort", () => {
      if (pending.delete(requestId)) resolve({ behavior: "deny", message: "cancelled" });
      out({ type: "permission_cancelled", requestId });
    });
  });

let q: Query | null = null;

async function start(m: Extract<Inbound, { type: "start" }>) {
  const options: Options = {
    cwd: m.cwd,
    model: m.model,
    effort: m.effort,
    permissionMode: m.permissionMode ?? "default",
    resume: m.resume,
    canUseTool,
    includePartialMessages: true,
    settingSources: ["user", "project", "local"],
    stderr: (d: string) => out({ type: "host", event: "stderr", data: d }),
  };
  push(userMessage(m.prompt, m.images));
  q = query({ prompt: input(), options });
  out({ type: "host", event: "ready" });
  try {
    for await (const message of q) {
      out({ type: "sdk", message });
    }
    out({ type: "host", event: "ended" });
  } catch (e: any) {
    out({ type: "host", event: "error", message: String(e?.message ?? e) });
  }
  closed = true;
  process.exit(0);
}

async function info() {
  if (!q) return;
  try {
    const [models, commands, account] = await Promise.all([q.supportedModels(), q.supportedCommands(), q.accountInfo().catch(() => null)]);
    out({ type: "info", models, commands, account });
  } catch (e: any) { out({ type: "host", event: "error", message: String(e?.message ?? e) }); }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let m: Inbound;
  try { m = JSON.parse(line); } catch { return; }
  switch (m.type) {
    case "start": start(m); break;
    case "prompt": push(userMessage(m.text, m.images)); break;
    case "permission": {
      const r = pending.get(m.requestId);
      if (!r) break;
      pending.delete(m.requestId);
      r(m.behavior === "allow"
        ? { behavior: "allow", updatedInput: m.updatedInput, updatedPermissions: m.updatedPermissions as any }
        : { behavior: "deny", message: m.message ?? "Denied by user" });
      break;
    }
    case "interrupt": q?.interrupt().catch(() => {}); break;
    case "setModel": q?.setModel(m.model).catch((e) => out({ type: "host", event: "error", message: String(e) })); break;
    case "setMode": q?.setPermissionMode(m.mode!).catch((e) => out({ type: "host", event: "error", message: String(e) })); break;
    case "setEffort": q?.applyFlagSettings({ effortLevel: m.effort as any }).catch((e) => out({ type: "host", event: "error", message: String(e) })); break;
    case "info": info(); break;
  }
});
rl.on("close", () => { closed = true; wake?.(); });
