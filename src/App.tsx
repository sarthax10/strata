import { useEffect, useState } from "react";
import { useStore } from "./state/store";
import { useAgents } from "./core/agent";
import { discoverProfiles, discoverWsl, homeDir } from "./core/pty";
import { installKeymap } from "./core/keymap";
import { installAutosave } from "./core/persist-runtime";
import * as P from "./core/persist";
import { TitleBar, Rail, StatusBar, Toasts } from "./components/Chrome";
import { Canvas } from "./components/Canvas";
import { Palette } from "./components/Palette";

export default function App() {
  const [ready, setReady] = useState(false);
  const railHidden = useStore((s) => s.projectOrder.length <= 1);
  const hints = useStore((s) => s.ui.hints);
  const maximized = useStore((s) => s.ui.maximized);
  const projectColor = useStore((s) => (s.activeProjectId ? s.projects[s.activeProjectId]?.color : undefined));
  const agentWorking = useAgents((s) => Object.values(s.sessions).some((a) => a.status === "working" || a.status === "starting"));

  useEffect(() => {
    document.documentElement.dataset.theme = useStore.getState().ui.theme;
    Promise.all([discoverProfiles(), homeDir(), P.loadState().catch(() => null)])
      .then(([profiles, home, snapshot]) => {
        // A bad snapshot must never stop the app from opening: fall back to a
        // fresh session and tell the user what happened.
        try {
          useStore.getState().init(profiles, home, snapshot);
        } catch (e) {
          console.error("restore failed", e);
          useStore.getState().init(profiles, home, null);
          useStore.getState().toast({ title: "Could not restore your last session", sub: "Started fresh instead.", kind: "error" });
        }
      })
      .catch((e) => console.error("startup failed", e))
      .finally(() => {
        setReady(true);
        installAutosave();
        discoverWsl().then((wsl) => useStore.getState().addProfiles(wsl)).catch(() => {});
      });
    return installKeymap();
  }, []);

  return (
    <div className={`app ${railHidden ? "rail-hidden" : ""} ${hints ? "hints-visible" : ""} ${maximized ? "maximized" : ""} ${agentWorking ? "agent-working" : ""}`}
         style={projectColor ? ({ "--project": projectColor } as React.CSSProperties) : undefined}
         onContextMenu={(e) => e.preventDefault()}>
      <TitleBar />
      {!railHidden && <Rail />}
      {ready && <Canvas />}
      <StatusBar />
      <Palette />
      <Toasts />
    </div>
  );
}
