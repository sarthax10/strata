import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useAgents, describeTool, type AgentSession, type Item, type ToolItem, type Turn, type PermissionRequest, type ImageAttachment } from "../core/agent";

marked.setOptions({ gfm: true, breaks: false });
const md = (text: string) => ({ __html: DOMPurify.sanitize(marked.parse(text) as string) });

const FAMILY_ICON: Record<string, string> = { read: "▤", edit: "✎", run: "❯", browser: "◉", web: "↗", agent: "⑂", plan: "☰", question: "?", mcp: "⌘", other: "•" };

export function AgentPane({ agentId, focused }: { agentId: string; focused: boolean }) {
  const s = useAgents((st) => st.sessions[agentId]);
  if (!s) return null;
  return (
    <div className="agent" data-status={s.status}>
      <AgentHeader s={s} />
      <Transcript s={s} />
      <NowStrip s={s} />
      {s.permissions.length ? <DecisionCard s={s} req={s.permissions[0]} /> : <Composer s={s} focused={focused} />}
    </div>
  );
}

// ---------------- header + model pill ----------------

function AgentHeader({ s }: { s: AgentSession }) {
  const [open, setOpen] = useState(false);
  const { rename, setModel, setEffort, setMode } = useAgents.getState();
  const pct = Math.min(100, Math.round((s.context.used / s.context.window) * 100));
  const exact = s.models.find((m) => m.value === s.model && m.value !== "default");
  const modelName = exact?.displayName ?? short(s.model);
  const effortLevels = s.models.find((m) => m.value === s.model)?.supportedEffortLevels ?? ["low", "medium", "high"];
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.altKey && e.key.toLowerCase() === "m" && document.activeElement?.closest(".agent")) { e.preventDefault(); setOpen((o) => !o); } if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div className="agent-header">
      <input className="agent-title" value={s.title} onChange={(e) => rename(s.id, e.target.value)} spellCheck={false} />
      <button className="pill" onClick={() => setOpen((o) => !o)} title={`${s.model} · ${s.context.used.toLocaleString()} of ${s.context.window.toLocaleString()} tokens${s.costUsd ? ` · $${s.costUsd.toFixed(2)}` : ""}`}>
        <span>{modelName || "Claude"}</span>
        {s.effort && <><span className="dot">·</span><span className="sec">{cap(s.effort)}</span></>}
        <span className="dot">·</span>
        <Ring pct={pct} />
        <span className="sec">{pct}%</span>
      </button>
      {open && (
        <div className="pill-pop" onMouseLeave={() => setOpen(false)}>
          <div className="cat">Model</div>
          {(s.models.length ? s.models : [{ value: s.model || "default", displayName: modelName || "Default", description: "" }]).map((m) => (
            <button key={m.value} className={`row ${m.value === s.model ? "sel" : ""}`} onClick={() => { setModel(s.id, m.value); }}>
              <span className="radio">{m.value === s.model ? "●" : "○"}</span><span>{m.displayName}</span><span className="sec">{m.description}</span>
            </button>
          ))}
          <div className="cat">Effort</div>
          <div className="seg">{effortLevels.map((l) => <button key={l} className={s.effort === l ? "on" : ""} onClick={() => setEffort(s.id, l)}>{cap(l)}</button>)}</div>
          <div className="cat">Mode</div>
          <div className="seg">
            {([["default", "Ask"], ["acceptEdits", "Auto-edit"], ["plan", "Plan"]] as const).map(([v, l]) => <button key={v} className={s.mode === v ? "on" : ""} onClick={() => setMode(s.id, v)}>{l}</button>)}
          </div>
          <div className="cat">Context</div>
          <div className="ctx-bar"><div style={{ width: `${pct}%` }} /></div>
          <div className="sec small">{s.context.used.toLocaleString()} of {s.context.window.toLocaleString()} tokens{s.costUsd ? ` · session $${s.costUsd.toFixed(2)}` : ""}{s.account?.email ? ` · ${s.account.email}` : ""}</div>
        </div>
      )}
      <span className={`agent-bar ${s.status}`} />
    </div>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 5, c = 2 * Math.PI * r;
  const color = pct >= 90 ? "var(--error)" : pct >= 75 ? "var(--warning)" : "var(--agent)";
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="ring">
      <circle cx="7" cy="7" r={r} fill="none" stroke="var(--border-strong)" strokeWidth="2" />
      <circle cx="7" cy="7" r={r} fill="none" stroke={color} strokeWidth="2" strokeDasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 7 7)" style={{ transition: "stroke-dasharray 240ms var(--ease)" }} />
    </svg>
  );
}

// ---------------- transcript ----------------

function Transcript({ s }: { s: AgentSession }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current!;
    const onScroll = () => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };
    el.addEventListener("scroll", onScroll); return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => { if (stick.current) ref.current?.scrollTo({ top: ref.current.scrollHeight }); });
  return (
    <div className="transcript" ref={ref}>
      {s.turns.length === 0 && (
        <div className="agent-empty">
          <div className="hint">Claude Code in <b>{s.cwd.replace(/\\/g, "/").split("/").slice(-1)[0]}</b></div>
          <div className="sub">Describe a task. Files Claude reads and edits show up as activity rows; permissions appear right here.</div>
        </div>
      )}
      {s.turns.map((t) => <TurnView key={t.id} t={t} s={s} />)}
    </div>
  );
}

function TurnView({ t, s }: { t: Turn; s: AgentSession }) {
  const groups = useMemo(() => groupItems(t.items), [t.items]);
  return (
    <div className="turn">
      <div className="user">
        <div className="bar" />
        <div className="body">
          <div className="text">{t.userText}</div>
          {t.images.length > 0 && <div className="thumbs">{t.images.map((im) => <img key={im.id} src={im.url} alt={im.name} title={im.name} />)}</div>}
        </div>
        <div className="time">{time(t.startedAt)}</div>
      </div>
      {groups.map((g, i) => g.kind === "group" ? <ToolGroup key={i} items={g.items} /> : <ItemView key={(g as any).item.id} item={(g as any).item} />)}
      {t.status !== "running" && (
        <div className={`turn-footer ${t.status}`}>
          {t.status === "done" && <>Turn {s.turns.indexOf(t) + 1}{t.result?.filesChanged.length ? ` · ${t.result.filesChanged.length} file${t.result.filesChanged.length > 1 ? "s" : ""}` : ""}{t.result?.durationMs ? ` · ${dur(t.result.durationMs)}` : ""}{t.result?.costUsd ? ` · $${t.result.costUsd.toFixed(2)}` : ""}</>}
          {t.status === "error" && <>✕ {t.result?.error ?? "Turn failed"}</>}
          {t.status === "interrupted" && <>– interrupted</>}
        </div>
      )}
    </div>
  );
}

type Group = { kind: "group"; items: ToolItem[] } | { kind: "item"; item: Item };
function groupItems(items: Item[]): Group[] {
  const out: Group[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (it.kind === "tool" && (it.family === "read") && last?.kind === "group" && last.items[0].family === it.family) { last.items.push(it); continue; }
    if (it.kind === "tool" && it.family === "read") { out.push({ kind: "group", items: [it] }); continue; }
    out.push({ kind: "item", item: it });
  }
  return out;
}

function ItemView({ item }: { item: Item }) {
  if (item.kind === "text") return <div className={`prose ${item.live ? "live" : ""}`} dangerouslySetInnerHTML={md(item.text)} />;
  if (item.kind === "thinking") return <ThinkingRow item={item} />;
  if (item.kind === "divider") return <div className="divider">── {item.text} ──</div>;
  return <ToolRow item={item} />;
}

function ThinkingRow({ item }: { item: Extract<Item, { kind: "thinking" }> }) {
  const [open, setOpen] = useState(false);
  const secs = Math.max(1, Math.round(((item.endedAt ?? Date.now()) - item.startedAt) / 1000));
  if (!item.text.trim()) return null;
  return (
    <div className="row-wrap">
      <button className="arow" onClick={() => setOpen((o) => !o)}><span className="chev">{open ? "▾" : "▸"}</span><span className="ico">◌</span><span className="verb">{item.endedAt ? `Thought for ${secs} s` : "Thinking…"}</span></button>
      {open && <div className="detail thinking">{item.text}</div>}
    </div>
  );
}

function ToolGroup({ items }: { items: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 1) return <ToolRow item={items[0]} />;
  const running = items.some((i) => i.status === "running");
  const failed = items.some((i) => i.status === "failed");
  return (
    <div className="row-wrap">
      <button className={`arow ${running ? "running" : ""} ${failed ? "failed" : ""}`} onClick={() => setOpen((o) => !o)}>
        <span className="chev">{open ? "▾" : "▸"}</span><span className="ico">{running ? <Spinner /> : FAMILY_ICON.read}</span>
        <span className="verb">Read {items.length} files</span><span className="obj" />
        <span className="meta">{dur(items.reduce((a, i) => a + ((i.endedAt ?? Date.now()) - i.startedAt), 0))}</span>
      </button>
      {open && <div className="detail list">{items.map((i) => <ToolRow key={i.id} item={i} nested />)}</div>}
    </div>
  );
}

function ToolRow({ item, nested }: { item: ToolItem; nested?: boolean }) {
  const [open, setOpen] = useState(item.status === "failed");
  useEffect(() => { if (item.status === "failed") setOpen(true); }, [item.status]);
  const d = describeTool(item);
  const editStats = item.family === "edit" ? editCounts(item) : null;
  const runSummary = item.family === "run" && item.status !== "running" ? runOutcome(item) : null;
  return (
    <div className={`row-wrap ${nested ? "nested" : ""}`}>
      <button className={`arow ${item.status}`} onClick={() => setOpen((o) => !o)}>
        <span className="chev">{open ? "▾" : "▸"}</span>
        <span className="ico">{item.status === "running" ? <Spinner /> : FAMILY_ICON[item.family]}</span>
        <span className="verb">{d.verb}</span>
        <span className="obj">{d.object}</span>
        {editStats && <span className="stats"><span className="add">+{editStats.add}</span> <span className="del">−{editStats.del}</span></span>}
        {runSummary && <span className={`stats ${item.resultIsError ? "err" : "ok"}`}>{runSummary}</span>}
        {item.status === "denied" && <span className="stats muted">denied by you</span>}
        <span className="meta">{item.endedAt ? dur(item.endedAt - item.startedAt) : <Elapsed since={item.startedAt} />}</span>
      </button>
      {open && <ToolDetail item={item} />}
    </div>
  );
}

function ToolDetail({ item }: { item: ToolItem }) {
  const i = item.input as any;
  if (item.family === "run") return (
    <div className="detail">
      <pre className="cmd">❯ {i.command}</pre>
      {item.result && <pre className="out">{item.result.slice(0, 6000)}</pre>}
    </div>
  );
  if (item.family === "edit") return (
    <div className="detail">
      {i.old_string != null && <pre className="diff">{diffLines(String(i.old_string), String(i.new_string ?? ""))}</pre>}
      {i.content != null && <pre className="diff">{String(i.content).split("\n").slice(0, 40).map((l: string) => `+ ${l}`).join("\n")}</pre>}
      {i.edits && <pre className="diff">{(i.edits as any[]).map((e) => diffLines(String(e.old_string), String(e.new_string))).join("\n…\n")}</pre>}
      {item.resultIsError && <pre className="out err">{item.result}</pre>}
    </div>
  );
  if (item.family === "plan" && i.todos) return (
    <div className="detail list">{(i.todos as any[]).map((t, k) => <div key={k} className={`todo ${t.status}`}>{t.status === "completed" ? "✓" : t.status === "in_progress" ? "●" : "○"} {t.content}</div>)}</div>
  );
  return (
    <div className="detail">
      <pre className="out">{JSON.stringify(item.input, null, 2).slice(0, 2000)}</pre>
      {item.result && <pre className={`out ${item.resultIsError ? "err" : ""}`}>{item.result.slice(0, 4000)}</pre>}
    </div>
  );
}

function diffLines(a: string, b: string) {
  const al = a.split("\n"), bl = b.split("\n");
  return [...al.map((l) => `- ${l}`), ...bl.map((l) => `+ ${l}`)].slice(0, 60).join("\n");
}
function editCounts(item: ToolItem) {
  const i = item.input as any;
  const count = (o?: string, n?: string) => ({ add: (n ?? "").split("\n").length, del: o ? o.split("\n").length : 0 });
  if (i.edits) return (i.edits as any[]).reduce((acc, e) => { const c = count(e.old_string, e.new_string); return { add: acc.add + c.add, del: acc.del + c.del }; }, { add: 0, del: 0 });
  if (i.content != null) return { add: String(i.content).split("\n").length, del: 0 };
  return count(i.old_string, i.new_string);
}
function runOutcome(item: ToolItem) {
  if (item.resultIsError) { const m = item.result?.match(/exit code (\d+)/i); return m ? `✕ exit ${m[1]}` : "✕ failed"; }
  return "✓";
}

function Spinner() { return <span className="spin" />; }
function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  return <>{dur(Date.now() - since)}</>;
}

// ---------------- now strip ----------------

function NowStrip({ s }: { s: AgentSession }) {
  const { interrupt } = useAgents.getState();
  if (s.now.kind === "idle") return null;
  const cls = s.now.kind === "permission" || s.now.kind === "question" ? "warn" : s.now.kind === "error" ? "err" : "";
  return (
    <div className={`now ${cls}`}>
      <span className={`glyph ${s.now.kind}`}>{s.now.kind === "permission" || s.now.kind === "question" ? "◆" : s.now.kind === "error" ? "✕" : "●"}</span>
      <span className="label">{s.now.label}</span>
      {s.now.kind !== "permission" && s.now.kind !== "question" && s.now.kind !== "error" && <span className="meta"><Elapsed since={s.now.since} /></span>}
      {(s.status === "working" || s.status === "starting") && <button className="stop" onClick={() => interrupt(s.id)}>Stop <kbd>Esc Esc</kbd></button>}
    </div>
  );
}

// ---------------- permission decision card ----------------

function DecisionCard({ s, req }: { s: AgentSession; req: PermissionRequest }) {
  const { decide } = useAgents.getState();
  const ref = useRef<HTMLDivElement>(null);
  const i = req.input as any;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  useEffect(() => { ref.current?.focus(); }, [req.requestId]);

  if (req.family === "question") {
    const qs: any[] = i.questions ?? [];
    const submit = () => decide(s.id, req.requestId, "allow", { updatedInput: { ...req.input, answers } });
    return (
      <div className="decision" ref={ref} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" && Object.keys(answers).length === qs.length) submit(); }}>
        <div className="kind">◆ Claude asks</div>
        {qs.map((q, qi) => (
          <div key={qi} className="q">
            <div className="qt">{q.question}</div>
            {(q.options ?? []).map((o: any, oi: number) => (
              <button key={oi} className={`opt ${answers[q.question] === o.label ? "on" : ""}`} onClick={() => setAnswers((a) => ({ ...a, [q.question]: o.label }))}>
                <span className="radio">{answers[q.question] === o.label ? "●" : "○"}</span><span>{o.label}</span>{o.description && <span className="sec">{o.description}</span>}
              </button>
            ))}
          </div>
        ))}
        <div className="actions">
          <button className="btn primary" disabled={Object.keys(answers).length < qs.length} onClick={submit}>Submit <kbd>↵</kbd></button>
          <button className="btn" onClick={() => decide(s.id, req.requestId, "deny", { message: "User skipped the question" })}>Skip <kbd>Esc</kbd></button>
        </div>
      </div>
    );
  }

  const kindLabel = { read: "Read outside project", edit: "Edit file", run: "Run command", web: "Fetch URL", browser: "Use browser", mcp: "Use tool", agent: "Delegate", plan: "Approve plan", other: "Use tool", question: "" }[req.family];
  const object = req.family === "run" ? String(i.command ?? "") : req.family === "edit" ? String(i.file_path ?? i.notebook_path ?? "") : req.family === "web" ? String(i.url ?? i.query ?? "") : req.family === "plan" ? String(i.plan ?? "") : JSON.stringify(req.input).slice(0, 400);
  const rule = ruleLabel(req);
  const allowAlways = () => decide(s.id, req.requestId, "allow", { updatedPermissions: req.suggestions.length ? req.suggestions : undefined });
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); decide(s.id, req.requestId, "allow"); }
    else if (e.key === "Escape") { e.preventDefault(); decide(s.id, req.requestId, "deny", { message: "Denied by user" }); }
    else if (e.key === "ArrowRight" && rule) { e.preventDefault(); allowAlways(); }
  };
  return (
    <div className="decision" ref={ref} tabIndex={0} onKeyDown={onKey}>
      <div className="kind">◆ {kindLabel}{s.permissions.length > 1 && <span className="sec"> · 1 of {s.permissions.length}</span>}</div>
      <pre className="object">{object}</pre>
      {req.family === "run" && i.description && <div className="sec">{i.description}</div>}
      {req.family === "edit" && (i.old_string != null || i.content != null) && <pre className="diff small">{i.content != null ? String(i.content).split("\n").slice(0, 20).map((l: string) => `+ ${l}`).join("\n") : diffLines(String(i.old_string), String(i.new_string ?? ""))}</pre>}
      <div className="actions">
        <button className="btn primary" onClick={() => decide(s.id, req.requestId, "allow")}>Allow <kbd>↵</kbd></button>
        {rule && <button className="btn" onClick={allowAlways}>{rule} <kbd>→</kbd></button>}
        <button className="btn" onClick={() => decide(s.id, req.requestId, "deny", { message: "Denied by user" })}>Deny <kbd>Esc</kbd></button>
        <span className="spacer" />
      </div>
    </div>
  );
}

function ruleLabel(req: PermissionRequest): string | null {
  if (!req.suggestions.length) return null;
  const s: any = req.suggestions[0];
  const rules = s?.rules ?? [];
  if (rules[0]?.toolName) {
    const content = rules[0].ruleContent ? String(rules[0].ruleContent).replace(/:\*$/, " …") : "";
    return `Always for ${content || rules[0].toolName}`;
  }
  if (s?.type === "addDirectories") return `Always in ${(s.directories ?? []).join(", ")}`;
  return "Always allow";
}

// ---------------- composer ----------------

function Composer({ s, focused }: { s: AgentSession; focused: boolean }) {
  const { send, setDraft, addTray, removeTray, interrupt, setModel, setEffort, setMode } = useAgents.getState();
  const ta = useRef<HTMLTextAreaElement>(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdSel, setCmdSel] = useState(0);
  const escAt = useRef(0);
  useEffect(() => { if (focused) ta.current?.focus(); }, [focused]);
  useEffect(() => { const el = ta.current; if (!el) return; el.style.height = "auto"; el.style.height = Math.min(12 * 21, el.scrollHeight) + "px"; }, [s.draft]);

  const strataCommands: { name: string; description: string; run: (arg: string) => void }[] = [
    { name: "model", description: "Switch model", run: (a) => a && setModel(s.id, a) },
    { name: "effort", description: "Set effort: low · medium · high · max", run: (a) => a && setEffort(s.id, a) },
    { name: "mode", description: "Permission mode: ask · auto-edit · plan", run: (a) => setMode(s.id, a === "auto-edit" ? "acceptEdits" : a === "plan" ? "plan" : "default") },
  ];
  const cmdQuery = s.draft.startsWith("/") ? s.draft.slice(1).split(" ")[0].toLowerCase() : null;
  const cmdRows = cmdQuery == null ? [] : [
    ...strataCommands.map((c) => ({ ...c, strata: true })),
    ...s.commands.map((c) => ({ name: c.name, description: c.description, strata: false, run: undefined as undefined | ((a: string) => void) })),
  ].filter((c) => c.name.toLowerCase().includes(cmdQuery)).slice(0, 8);
  useEffect(() => { setCmdOpen(cmdQuery != null && cmdRows.length > 0 && !s.draft.includes("\n")); setCmdSel(0); }, [s.draft]);

  const submit = () => {
    const text = s.draft.trim();
    if (!text && !s.tray.length) return;
    if (text.startsWith("/")) {
      const [name, ...rest] = text.slice(1).split(" ");
      const sc = strataCommands.find((c) => c.name === name);
      if (sc) { sc.run(rest.join(" ")); setDraft(s.id, ""); return; }
    }
    send(s.id, text || "(see attached)", s.tray);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (cmdOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setCmdSel((x) => (x + 1) % cmdRows.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setCmdSel((x) => (x - 1 + cmdRows.length) % cmdRows.length); return; }
      if (e.key === "Tab" || (e.key === "Enter" && cmdRows[cmdSel] && `/${cmdRows[cmdSel].name}` !== s.draft.trim())) { e.preventDefault(); setDraft(s.id, `/${cmdRows[cmdSel].name} `); return; }
      if (e.key === "Escape") { e.preventDefault(); setCmdOpen(false); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
    else if (e.key === "Escape") {
      const now = Date.now();
      if (now - escAt.current < 600 && (s.status === "working" || s.status === "starting")) { interrupt(s.id); escAt.current = 0; }
      else { escAt.current = now; }
    }
  };
  const onPaste = (e: React.ClipboardEvent) => {
    for (const f of Array.from(e.clipboardData.files)) if (f.type.startsWith("image/")) { e.preventDefault(); fileToAttachment(f).then((a) => addTray(s.id, a)); }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    for (const f of Array.from(e.dataTransfer.files)) if (f.type.startsWith("image/")) fileToAttachment(f).then((a) => addTray(s.id, a));
  };
  const placeholder = s.status === "new" ? "Describe the task…" : s.turns[s.turns.length - 1]?.status === "error" ? "Try again or tell Claude what to change…" : "Ask Claude…";
  return (
    <div className="composer" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
      {s.tray.length > 0 && (
        <div className="tray">{s.tray.map((a) => (
          <span key={a.id} className="tchip"><img src={a.url} alt="" /><span>{a.name}</span><button onClick={() => removeTray(s.id, a.id)}>×</button></span>
        ))}</div>
      )}
      {cmdOpen && (
        <div className="cmdlist">
          {cmdRows.map((c, i) => (
            <button key={c.name} className={`row ${i === cmdSel ? "sel" : ""}`} onMouseEnter={() => setCmdSel(i)} onClick={() => setDraft(s.id, `/${c.name} `)}>
              <span className="mono">/{c.name}</span><span className="sec">{c.description}</span>{c.strata && <span className="s-glyph">S</span>}
            </button>
          ))}
        </div>
      )}
      <textarea ref={ta} value={s.draft} rows={1} placeholder={placeholder} spellCheck={false}
        onChange={(e) => setDraft(s.id, e.target.value)} onKeyDown={onKey} onPaste={onPaste} />
      <div className="cfoot">
        <label className="attach" title="Attach image">⊕<input type="file" accept="image/*" multiple hidden onChange={(e) => { for (const f of Array.from(e.target.files ?? [])) fileToAttachment(f).then((a) => addTray(s.id, a)); e.target.value = ""; }} /></label>
        <span className="sec">/ commands</span>
        <span className="spacer" />
        <span className="sec">{short(s.model) || "Claude"}{s.effort ? ` · ${cap(s.effort)}` : ""}</span>
        <button className="send" onClick={submit} title="Send (Enter)">↵</button>
      </div>
    </div>
  );
}

async function fileToAttachment(f: File): Promise<ImageAttachment> {
  const buf = await f.arrayBuffer();
  let bin = ""; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { id: `im${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: f.name || "image.png", mediaType: f.type || "image/png", data: btoa(bin), url: URL.createObjectURL(f) };
}

// ---------------- utils ----------------
const short = (m: string) => m.replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/-(\d)-(\d)/, " $1.$2").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
function dur(ms: number) { if (ms < 1000) return `${Math.max(0, Math.round(ms / 100) / 10)} s`; if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`; const m = Math.floor(ms / 60000); return `${m} m ${Math.round((ms % 60000) / 1000)} s`; }
