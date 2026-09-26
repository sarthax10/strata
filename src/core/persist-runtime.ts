// Autosave: snapshot the model shortly after any change, and once more on exit.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "../state/store";
import { useAgents } from "../core/agent";
import * as T from "./terminals";
import * as P from "./persist";

let timer: number | undefined;
let installed = false;

function save() {
  try {
    const snap = useStore.getState().snapshot();
    P.saveState(snap).catch(() => {});
    for (const id of Object.keys(snap.sessions)) {
      const text = T.serialize(id);
      if (text) P.saveScrollback(id, text).catch(() => {});
    }
  } catch { /* never break the app over persistence */ }
}

function schedule() {
  if (useStore.getState().restoring) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(save, 600);
}

export function installAutosave() {
  if (installed) return;
  installed = true;
  useStore.subscribe(schedule);
  useAgents.subscribe(schedule);
  getCurrentWindow().onCloseRequested(() => { window.clearTimeout(timer); save(); });
  window.addEventListener("beforeunload", () => { window.clearTimeout(timer); save(); });
}

export { save as saveNow };
