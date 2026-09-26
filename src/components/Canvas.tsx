import { useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import * as L from "../core/layout";
import { TerminalPane } from "./TerminalPane";
import { AgentPane } from "./AgentPane";
import { Explorer } from "./Explorer";
import { FilePane } from "./FilePane";
import { useAgents } from "../core/agent";

const GAP = 6;

export function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ws = useStore((s) => s.activeWorkspace());
  const panes = useStore((s) => s.panes);
  const sessions = useStore((s) => s.sessions);
  const agents = useAgents((s) => s.sessions);
  const railHidden = useStore((s) => s.projectOrder.length <= 1);
  const { focusPane, closePane, splitPane, toggleZoom, setRatio, newTerminal, equalize } = useStore.getState();

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const area: L.Rect = { x: railHidden ? GAP : 0, y: 0, w: Math.max(0, size.w - GAP - (railHidden ? GAP : 0)), h: Math.max(0, size.h - GAP) };
  let laid: ReturnType<typeof L.layout> = { panes: [], gaps: [] };
  if (ws?.tree) {
    if (ws.zoomedPaneId && panes[ws.zoomedPaneId]) laid = { panes: [{ paneId: ws.zoomedPaneId, rect: area }], gaps: [] };
    else laid = L.layout(ws.tree, area, GAP);
  }
  const alone = laid.panes.length === 1;
  const order = ws?.tree ? L.leaves(ws.tree).map((l) => l.paneId) : [];

  return (
    <div className={`canvas ${railHidden ? "no-rail" : ""}`} ref={ref}>
      {!ws?.tree && (
        <div className="empty-pane">
          <div className="glyph">❯</div>
          <div className="lead">Nothing open in this workspace</div>
          <div>Open a shell, or hand the task to Claude.</div>
          <div className="actions">
            <button className="btn primary" onClick={() => newTerminal()}>New terminal <kbd>Ctrl+Shift+T</kbd></button>
            <button className="btn" onClick={() => useStore.getState().newAgent()}>Ask Claude <kbd>Ctrl+Shift+A</kbd></button>
          </div>
        </div>
      )}
      {laid.panes.map(({ paneId, rect }) => {
        const pane = panes[paneId];
        if (!pane) return null;
        const focused = ws?.focusedPaneId === paneId;
        const session = pane.sessionId ? sessions[pane.sessionId] : undefined;
        const idx = order.indexOf(paneId);
        return (
          <div
            key={paneId}
            data-pane={paneId}
            className={`pane ${focused ? "focused" : ""} ${alone ? "alone" : ""}`}
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            onMouseDown={() => { if (!focused) focusPane(paneId); }}
          >
            {!alone && (
              <div className="pane-header" onDoubleClick={toggleZoom}>
                <span className="title">
                  {pane.type === "explorer" ? "Explorer"
                    : pane.type === "file" ? (pane.filePath ?? "").replace(/\\/g, "/").split("/").slice(-1)[0]
                    : pane.type === "agent"
                    ? <>{agents[pane.agentId!]?.status === "working" ? "● " : agents[pane.agentId!]?.status === "needs-you" ? "◆ " : ""}{agents[pane.agentId!]?.title ?? "Claude"}</>
                    : <>{session?.running ? "● " : session?.failed ? "✕ " : ""}{session?.title ?? "Terminal"}</>}
                </span>
                <button title="Split right (Ctrl+Shift+D)" onClick={() => { focusPane(paneId); splitPane("right"); }}>◫</button>
                <button title="Split down (Ctrl+Shift+E)" onClick={() => { focusPane(paneId); splitPane("down"); }}>⊟</button>
                <button title="Zoom (Alt+Z)" onClick={() => { focusPane(paneId); toggleZoom(); }}>⤢</button>
                <button title="Close (Ctrl+Shift+W)" onClick={() => closePane(paneId)}>✕</button>
              </div>
            )}
            {idx >= 0 && idx < 9 && <div className="pane-badge">{idx + 1}</div>}
            {pane.type === "terminal" && pane.sessionId && <TerminalPane sessionId={pane.sessionId} focused={focused} />}
            {pane.type === "agent" && pane.agentId && <AgentPane agentId={pane.agentId} focused={focused} />}
            {pane.type === "explorer" && <Explorer />}
            {pane.type === "file" && pane.filePath && <FilePane path={pane.filePath} />}
          </div>
        );
      })}
      {laid.gaps.map((g) => (
        <Gap key={`${g.nodeId}-${g.index}`} gap={g} onDrag={(delta) => setRatio(g.nodeId, g.index, delta)} onDouble={equalize}
             axisPx={g.orientation === "row" ? area.w : area.h} />
      ))}
    </div>
  );
}

function Gap({ gap, onDrag, onDouble, axisPx }: { gap: L.LaidOutGap; onDrag: (d: number) => void; onDouble: () => void; axisPx: number }) {
  const [dragging, setDragging] = useState(false);
  const start = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    let last = gap.orientation === "row" ? e.clientX : e.clientY;
    const move = (ev: MouseEvent) => {
      const cur = gap.orientation === "row" ? ev.clientX : ev.clientY;
      const px = cur - last; last = cur;
      onDrag(px / axisPx);
    };
    const up = () => { setDragging(false); window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); document.body.style.cursor = ""; };
    document.body.style.cursor = gap.orientation === "row" ? "col-resize" : "row-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const r = gap.rect;
  return (
    <div className={`gap ${gap.orientation} ${dragging ? "dragging" : ""}`}
      style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
      onMouseDown={start} onDoubleClick={onDouble} />
  );
}
