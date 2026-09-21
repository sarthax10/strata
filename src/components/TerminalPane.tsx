import { useEffect, useRef } from "react";
import { useStore } from "../state/store";
import * as T from "../core/terminals";

export function TerminalPane({ sessionId, focused }: { sessionId: string; focused: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const session = useStore((s) => s.sessions[sessionId]);
  const profile = useStore((s) => s.profiles.find((p) => p.id === session?.profileId));
  const started = useRef(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let inst = T.get(sessionId);
    if (!inst) inst = T.create(sessionId);
    T.attach(inst, el);
    if (!started.current && inst.ptyId == null && profile) {
      started.current = true;
      T.start(inst, profile, session?.cwd);
    }
    const ro = new ResizeObserver(() => { try { inst!.fit.fit(); } catch { /* not attached yet */ } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sessionId, profile]);

  useEffect(() => {
    const inst = T.get(sessionId);
    if (!inst) return;
    if (focused) inst.term.focus(); else inst.term.blur();
  }, [focused, sessionId]);

  return (
    <>
      <div className="term-host" ref={hostRef} />
      {session?.exited && (
        <div className="exit-bar">
          Shell exited{session.exitCode != null ? ` (code ${session.exitCode})` : ""}
        </div>
      )}
    </>
  );
}
