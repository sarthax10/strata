import { useEffect } from "react";
import { useStore } from "./state/store";
import { discoverProfiles, homeDir } from "./core/pty";
import { installKeymap } from "./core/keymap";
import { TitleBar, Rail, StatusBar, Toasts } from "./components/Chrome";
import { Canvas } from "./components/Canvas";
import { Palette } from "./components/Palette";
import { useAgents } from "./core/agent";

export default function App() {
  const railHidden = useStore((s) => s.projectOrder.length <= 1);
  const hints = useStore((s) => s.ui.hints);
  const maximized = useStore((s) => s.ui.maximized);
  const projectColor = useStore((s) => (s.activeProjectId ? s.projects[s.activeProjectId]?.color : undefined));
  const agentWorking = useAgents((s) => Object.values(s.sessions).some((a) => a.status === "working" || a.status === "starting"));

  useEffect(() => {
    document.documentElement.dataset.theme = useStore.getState().ui.theme;
    Promise.all([discoverProfiles(), homeDir()]).then(([profiles, home]) => useStore.getState().init(profiles, home));
    return installKeymap();
  }, []);

  return (
    <div className={`app ${railHidden ? "rail-hidden" : ""} ${hints ? "hints-visible" : ""} ${maximized ? "maximized" : ""} ${agentWorking ? "agent-working" : ""}`}
         style={projectColor ? ({ "--project": projectColor } as React.CSSProperties) : undefined}
         onContextMenu={(e) => e.preventDefault()}>
      <TitleBar />
      {!railHidden && <Rail />}
      <Canvas />
      <StatusBar />
      <Palette />
      <Toasts />
    </div>
  );
}
