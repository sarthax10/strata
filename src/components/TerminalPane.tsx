import { useEffect, useRef } from "react";
import { useStore } from "../state/store";
import * as T from "../core/terminals";
import { loadScrollback } from "../core/persist";

export function TerminalPane({ sessionId, focused }: { sessionId: string; focused: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const session = useStore((s) => s.sessions[sessionId]);
  const profile = useStore((s) => s.profiles.find((p) => p.id === session?.profileId));
  const started = useRef(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || !profile) return;
    let inst = T.get(sessionId);
    const fresh = !inst;
    if (!inst) inst = T.create(sessionId);
    T.attach(inst, el);

    if (!started.current && inst.ptyId == null) {
      started.current = true;
      const boot = async () => {
        // A restored session shows what was on screen before, then a new shell.
        if (fresh && session?.restored) {
          const text = await loadScrollback(sessionId).catch(() => null);
          if (text) T.replay(inst!, text);
        }
        await T.start(inst!, profile, session?.cwd);
        useStore.getState().updateSession(sessionId, { restored: false });
      };
      boot();
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
