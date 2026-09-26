import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { useAgents } from "../core/agent";
import * as F from "../core/files";
import { FileIcon } from "./FileIcon";

interface Row { path: string; name: string; isDir: boolean; depth: number; hidden: boolean }

/** Project tree: git state and agent activity as overlays on one list. */
export function Explorer() {
  const root = useStore((s) => (s.activeProjectId ? s.projects[s.activeProjectId]?.root : undefined));
  const projectName = useStore((s) => (s.activeProjectId ? s.projects[s.activeProjectId]?.name : ""));
  const [children, setChildren] = useState<Record<string, F.Entry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [git, setGit] = useState<F.GitStatus | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; row: Row } | null>(null);
  const [editing, setEditing] = useState<{ path: string; value: string; mode: "rename" | "new-file" | "new-folder"; parent: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  // Files the agent has touched, so the tree shows where work is happening.
  const agentFiles = useAgents((s) => s.touched);

  const load = useCallback(async (dir: string) => {
    try {
      const entries = await F.readDir(dir);
      setChildren((c) => ({ ...c, [dir]: entries }));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refreshGit = useCallback(async () => {
    if (!root) return;
    try { setGit(await F.gitStatus(root)); } catch { setGit(null); }
  }, [root]);

  useEffect(() => {
    if (!root) return;
    setChildren({}); setExpanded(new Set()); setSelected(null);
    load(root); refreshGit();
  }, [root, load, refreshGit]);

  // Refresh git after any agent turn ends: that is when files change in bulk.
  const agentIdle = useAgents((s) => s.order.map((id) => s.sessions[id]?.status).join(","));
  useEffect(() => { refreshGit(); }, [agentIdle, refreshGit]);

  const toggle = useCallback((path: string) => {
    setExpanded((e) => {
      const next = new Set(e);
      if (next.has(path)) next.delete(path);
      else { next.add(path); if (!children[path]) load(path); }
      return next;
    });
  }, [children, load]);

  const rows = useMemo<Row[]>(() => {
    if (!root) return [];
    const out: Row[] = [];
    const walk = (dir: string, depth: number) => {
      const entries = children[dir];
      if (!entries) return;
      for (const e of entries) {
        if (e.hidden && !showHidden) continue;
        const row: Row = { path: e.path, name: e.name, isDir: e.is_dir, depth, hidden: e.hidden };
        if (filter) {
          const hit = e.name.toLowerCase().includes(filter.toLowerCase());
          if (!e.is_dir && !hit) continue;
          if (e.is_dir) {
            const before = out.length;
            out.push(row);
            walk(e.path, depth + 1);
            // Drop folders that contributed no matches and do not match themselves.
            if (out.length === before + 1 && !hit) out.pop();
            continue;
          }
        }
        out.push(row);
        if (e.is_dir && expanded.has(e.path)) walk(e.path, depth + 1);
      }
    };
    walk(root, 0);
    return out;
  }, [root, children, expanded, showHidden, filter]);

  // While filtering, make sure folders are loaded so matches can surface.
  useEffect(() => {
    if (!filter || !root) return;
    for (const dir of Object.keys(children)) {
      for (const e of children[dir]) if (e.is_dir && !e.hidden && !children[e.path]) load(e.path);
    }
  }, [filter, children, root, load]);

  const open = useCallback((row: Row) => {
    if (row.isDir) { toggle(row.path); return; }
    useStore.getState().openFile(row.path);
  }, [toggle]);

  const startCreate = (mode: "new-file" | "new-folder") => {
    const base = selected
      ? (rows.find((r) => r.path === selected)?.isDir ? selected : F.parentOf(selected))
      : root!;
    if (!expanded.has(base) && base !== root) toggle(base);
    setEditing({ path: "", value: "", mode, parent: base });
  };

  const commitEdit = async () => {
    if (!editing) return;
    const name = editing.value.trim();
    setEditing(null);
    if (!name) return;
    try {
      if (editing.mode === "rename") {
        await F.renamePath(editing.path, F.joinPath(F.parentOf(editing.path), name));
        await load(F.parentOf(editing.path));
      } else {
        const target = F.joinPath(editing.parent, name);
        await F.createPath(target, editing.mode === "new-folder");
        await load(editing.parent);
        if (editing.mode === "new-file") useStore.getState().openFile(target);
      }
      refreshGit();
    } catch (e) { setError(String(e)); }
  };

  const remove = async (row: Row) => {
    try {
      await F.trashPath(row.path);
      await load(F.parentOf(row.path));
      refreshGit();
      useStore.getState().setStatusHint(`Moved ${row.name} to the Recycle Bin`);
    } catch (e) { setError(String(e)); }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = rows.findIndex((r) => r.path === selected);
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected(rows[Math.min(rows.length - 1, i + 1)]?.path ?? rows[0]?.path ?? null); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelected(rows[Math.max(0, i - 1)]?.path ?? null); }
    else if (e.key === "ArrowRight" && rows[i]?.isDir && !expanded.has(rows[i].path)) { e.preventDefault(); toggle(rows[i].path); }
    else if (e.key === "ArrowLeft" && rows[i]) {
      e.preventDefault();
      if (rows[i].isDir && expanded.has(rows[i].path)) toggle(rows[i].path);
      else setSelected(F.parentOf(rows[i].path));
    }
    else if (e.key === "Enter" && rows[i]) { e.preventDefault(); open(rows[i]); }
    else if (e.key === "F2" && rows[i]) { e.preventDefault(); setEditing({ path: rows[i].path, value: rows[i].name, mode: "rename", parent: F.parentOf(rows[i].path) }); }
    else if (e.key === "Delete" && rows[i]) { e.preventDefault(); remove(rows[i]); }
    else if (e.key === "Escape") { setFilter(""); setEditing(null); setMenu(null); }
  };

  useEffect(() => {
    const close = () => setMenu(null);
    if (menu) { window.addEventListener("mousedown", close); return () => window.removeEventListener("mousedown", close); }
  }, [menu]);

  if (!root) {
    return (
      <div className="explorer">
        <div className="ex-empty">This project has no folder yet.</div>
      </div>
    );
  }

  return (
    <div className="explorer" onKeyDown={onKeyDown} tabIndex={0}>
      <div className="ex-head">
        <span className="ex-title" title={root}>{projectName}</span>
        {git?.branch && (
          <span className="ex-branch" title={`${git.branch}${git.ahead ? ` · ${git.ahead} ahead` : ""}${git.behind ? ` · ${git.behind} behind` : ""}`}>
            {git.branch}{git.ahead ? ` ↑${git.ahead}` : ""}{git.behind ? ` ↓${git.behind}` : ""}
          </span>
        )}
        <button title="New file" onClick={() => startCreate("new-file")}>＋</button>
        <button title={showHidden ? "Hide dotfiles and build folders" : "Show dotfiles and build folders"}
                className={showHidden ? "on" : ""} onClick={() => setShowHidden((v) => !v)}>◌</button>
      </div>

      <div className="ex-filter">
        <input ref={filterRef} value={filter} placeholder="Filter files" spellCheck={false}
               onChange={(e) => setFilter(e.target.value)} />
        {filter && <button onClick={() => { setFilter(""); filterRef.current?.focus(); }}>×</button>}
      </div>

      <div className="ex-list" ref={listRef}>
        {rows.map((row) => {
          const status = git?.files[F.norm(row.path)];
          const dirty = !status && row.isDir && !!git && Object.keys(git.files).some((f) => f.startsWith(F.norm(row.path) + "/"));
          const touched = agentFiles[F.norm(row.path)];
          const isEditing = editing?.mode === "rename" && editing.path === row.path;
          return (
            <div key={row.path}
              className={`ex-row ${selected === row.path ? "sel" : ""} ${row.hidden ? "dim" : ""} ${status === "D" ? "deleted" : ""}`}
              style={{ paddingLeft: 8 + row.depth * 12 }}
              onMouseDown={() => setSelected(row.path)}
              onClick={() => open(row)}
              onContextMenu={(e) => { e.preventDefault(); setSelected(row.path); setMenu({ x: e.clientX, y: e.clientY, row }); }}>
              <FileIcon name={row.name} isDir={row.isDir} open={expanded.has(row.path)} />
              {isEditing ? (
                <input className="ex-edit" autoFocus value={editing!.value}
                  onChange={(e) => setEditing({ ...editing!, value: e.target.value })}
                  onBlur={commitEdit}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditing(null); }} />
              ) : (
                <span className="ex-name">{row.name}</span>
              )}
              {touched && <span className="ex-agent" title="Changed by Claude" />}
              {status && <span className={`ex-git g-${status}`}>{status}</span>}
              {dirty && <span className="ex-git g-dot" title="Contains changes">·</span>}
            </div>
          );
        })}

        {editing && editing.mode !== "rename" && (
          <div className="ex-row" style={{ paddingLeft: 8 + 12 }}>
            <FileIcon name={editing.value || "x"} isDir={editing.mode === "new-folder"} />
            <input className="ex-edit" autoFocus value={editing.value}
              placeholder={editing.mode === "new-folder" ? "Folder name" : "File name"}
              onChange={(e) => setEditing({ ...editing, value: e.target.value })}
              onBlur={commitEdit}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditing(null); }} />
          </div>
        )}

        {rows.length === 0 && <div className="ex-empty">{filter ? `No files match “${filter}”` : "This folder is empty"}</div>}
      </div>

      {error && <div className="ex-error" onClick={() => setError(null)}>{error.replace(/^Error:\s*/, "")}</div>}

      {menu && <RowMenu menu={menu} onClose={() => setMenu(null)}
        onRename={() => setEditing({ path: menu.row.path, value: menu.row.name, mode: "rename", parent: F.parentOf(menu.row.path) })}
        onDelete={() => remove(menu.row)}
        onNewFile={() => startCreate("new-file")}
        onNewFolder={() => startCreate("new-folder")} />}
    </div>
  );
}

function RowMenu({ menu, onClose, onRename, onDelete, onNewFile, onNewFolder }: {
  menu: { x: number; y: number; row: Row }; onClose: () => void;
  onRename: () => void; onDelete: () => void; onNewFile: () => void; onNewFolder: () => void;
}) {
  const { row } = menu;
  const act = (fn: () => void) => () => { onClose(); fn(); };
  type Item = [string, () => void] | "sep";
  const openItem: Item[] = row.isDir ? [] : [["Open", act(() => useStore.getState().openFile(row.path))]];
  const termItem: Item[] = row.isDir ? [["Open terminal here", act(() => useStore.getState().newTerminal({ cwd: row.path }))]] : [];
  const items: Item[] = [
    ...openItem,
    ["Ask Claude about this", act(() => useStore.getState().askClaudeAbout(row.path))],
    ...termItem,
    "sep",
    ["Copy path", act(() => navigator.clipboard.writeText(row.path))],
    ["Reveal in Explorer", act(() => { F.revealInExplorer(row.path); })],
    "sep",
    ["New file", act(onNewFile)],
    ["New folder", act(onNewFolder)],
    ["Rename", act(onRename)],
    ["Delete", act(onDelete)],
  ];
  return (
    <div className="ctx" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((it, i) => it === "sep"
        ? <div key={i} className="ctx-sep" />
        : <button key={i} className={`ctx-item ${it[0] === "Delete" ? "danger" : ""}`} onClick={it[1]}>{it[0]}</button>)}
    </div>
  );
}
