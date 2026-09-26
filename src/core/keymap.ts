// Keyboard grammar: Ctrl+Shift = application, Alt = spatial, Ctrl+Shift+Alt = second row.
// Installed at the window level in the capture phase so xterm never sees these.
import { useStore } from "../state/store";

type Handler = () => void;

function combo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  let k = e.key;
  if (k === " ") k = "Space";
  if (k.length === 1) k = k.toUpperCase();
  if (e.code.startsWith("Digit")) k = e.code.slice(5);
  if (e.code === "Equal") k = "=";
  if (e.code === "Minus") k = "-";
  parts.push(k);
  return parts.join("+");
}

export function installKeymap(): () => void {
  const s = () => useStore.getState();
  const map: Record<string, Handler> = {
    "Ctrl+Shift+T": () => s().newTerminal(),
    "Ctrl+Shift+A": () => s().focusAgent(),
    "Ctrl+Shift+X": () => s().toggleExplorer(),
    "Ctrl+Shift+Alt+A": () => s().newAgent(),
    "Ctrl+Shift+D": () => s().splitPane("right"),
    "Ctrl+Shift+E": () => s().splitPane("down"),
    "Ctrl+Shift+Alt+D": () => s().splitPane("left"),
    "Ctrl+Shift+Alt+E": () => s().splitPane("up"),
    "Ctrl+Shift+W": () => s().closePane(),
    "Ctrl+Shift+Z": () => s().undoClose(),
    "Ctrl+Shift+P": () => s().setPalette(!s().ui.paletteOpen),
    "Ctrl+Shift+B": () => { const u = s().ui; s().setRail(!u.railPinned, !u.railPinned); },
    "Ctrl+Shift+=": () => s().equalize(),
    "Ctrl+Shift+Alt+N": () => s().newWorkspace(),
    "Alt+Z": () => s().toggleZoom(),
    "Alt+ARROWLEFT": () => s().focusDir("left"),
    "Alt+ARROWRIGHT": () => s().focusDir("right"),
    "Alt+ARROWUP": () => s().focusDir("up"),
    "Alt+ARROWDOWN": () => s().focusDir("down"),
    "Ctrl+Shift+ARROWLEFT": () => s().focusDir("left"),
    "Ctrl+Shift+ARROWRIGHT": () => s().focusDir("right"),
    "Ctrl+Shift+ARROWUP": () => s().focusDir("up"),
    "Ctrl+Shift+ARROWDOWN": () => s().focusDir("down"),
    "Shift+Alt+ARROWLEFT": () => s().resizePane("left"),
    "Shift+Alt+ARROWRIGHT": () => s().resizePane("right"),
    "Shift+Alt+ARROWUP": () => s().resizePane("up"),
    "Shift+Alt+ARROWDOWN": () => s().resizePane("down"),
    "Ctrl+Alt+ARROWLEFT": () => s().movePane("left"),
    "Ctrl+Alt+ARROWRIGHT": () => s().movePane("right"),
    "Ctrl+Alt+ARROWUP": () => s().movePane("up"),
    "Ctrl+Alt+ARROWDOWN": () => s().movePane("down"),
  };
  for (let i = 1; i <= 9; i++) {
    map[`Alt+${i}`] = () => s().focusIndex(i - 1);
    map[`Ctrl+Shift+${i}`] = () => s().switchWorkspace(i - 1);
  }

  let altTimer: number | undefined;
  const down = (e: KeyboardEvent) => {
    if (s().ui.paletteOpen && e.key !== "Escape" && !(e.ctrlKey && e.shiftKey && e.key.toUpperCase() === "P")) return;
    const c = combo(e).replace(/ARROW(LEFT|RIGHT|UP|DOWN)/i, (m) => m.toUpperCase());
    const key = c.replace(/Arrow(Left|Right|Up|Down)/, (m) => m.toUpperCase());
    const h = map[key];
    if (h) { e.preventDefault(); e.stopPropagation(); h(); return; }
    if (e.key === "Alt" && !altTimer) {
      altTimer = window.setTimeout(() => { s().setHints(true); }, 400);
    }
    if (e.key === "Escape" && s().ui.paletteOpen) { s().setPalette(false); }
  };
  const up = (e: KeyboardEvent) => {
    if (e.key === "Alt") { window.clearTimeout(altTimer); altTimer = undefined; s().setHints(false); }
  };
  const blur = () => { window.clearTimeout(altTimer); altTimer = undefined; s().setHints(false); };
  window.addEventListener("keydown", down, true);
  window.addEventListener("keyup", up, true);
  window.addEventListener("blur", blur);
  return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); window.removeEventListener("blur", blur); };
}
