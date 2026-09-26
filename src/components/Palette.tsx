import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { commands, fuzzy, type Command } from "../core/commands";

const ICON: Record<Command["category"], string> = { Pane: "▦", Workspace: "◫", Project: "●", Terminal: "❯", Appearance: "◐", Session: "◎", Agent: "✦", Files: "▤" };

export function Palette() {
  const open = useStore((s) => s.ui.paletteOpen);
  const setPalette = useStore((s) => s.setPalette);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const version = useStore((s) => s.projectOrder.length + Object.keys(s.workspaces).length + s.profiles.length);

  const all = useMemo(() => (open ? commands() : []), [open, version]);
  const rows = useMemo(() => {
    const query = q.replace(/^>\s*/, "");
    const scored = all.map((c) => ({ c, s: fuzzy(query, c.title) })).filter((x) => x.s >= 0);
    scored.sort((a, b) => b.s - a.s || a.c.title.localeCompare(b.c.title));
    return scored.map((x) => x.c).slice(0, 40);
  }, [all, q]);

  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    document.querySelector(".palette .row.sel")?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const run = (c: Command) => { setPalette(false); requestAnimationFrame(() => c.run()); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % Math.max(1, rows.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + rows.length) % Math.max(1, rows.length)); }
    else if (e.key === "Enter") { e.preventDefault(); if (rows[sel]) run(rows[sel]); }
    else if (e.key === "Escape") { e.preventDefault(); setPalette(false); }
    else if (e.altKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); const c = rows[Number(e.key) - 1]; if (c) run(c); }
  };

  let lastCat = "";
  return (
    <>
      <div className="overlay-dim" onMouseDown={() => setPalette(false)} />
      <div className="palette" role="dialog">
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search or run a command…" spellCheck={false} />
        {!q && <div className="chips"><span className="chip">Actions</span><span className="chip">Workspaces</span><span className="chip">Profiles</span><span className="chip">Appearance</span></div>}
        <div className="rows">
          {rows.length === 0 && <div className="empty">No matches for “{q}”</div>}
          {rows.map((c, i) => {
            const showCat = !q && c.category !== lastCat; lastCat = c.category;
            return (
              <div key={c.id}>
                {showCat && <div className="cat">{c.category}</div>}
                <div className={`row ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => run(c)}>
                  <span className="ico">{ICON[c.category]}</span>
                  <span>{c.title}</span>
                  <span className="sec" />
                  {c.shortcut && <kbd>{c.shortcut}</kbd>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
