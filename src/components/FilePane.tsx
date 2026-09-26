import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import * as F from "../core/files";

/** Read-only file view: enough to check what a file says without leaving Strata.
 *  The editor slice replaces this with a real editing surface. */
export function FilePane({ path }: { path: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null); setError(null);
    F.readTextFile(path)
      .then((t) => { if (!cancelled) setText(t); })
      .catch((e) => { if (!cancelled) setError(String(e).replace(/^Error:\s*/, "")); });
    return () => { cancelled = true; };
  }, [path]);

  const lines = text?.split("\n") ?? [];

  return (
    <div className="filepane">
      <div className="fp-head">
        <span className="fp-path" title={path}>{F.norm(path).split("/").slice(-2).join("/")}</span>
        {text != null && <span className="fp-meta">{lines.length} lines</span>}
        <button onClick={() => useStore.getState().askClaudeAbout(path)}>Ask Claude</button>
        <button onClick={() => F.revealInExplorer(path)}>Reveal</button>
      </div>
      {error && <div className="fp-error">{error}</div>}
      {text != null && (
        <div className="fp-body">
          <pre className="fp-gutter">{lines.map((_, i) => i + 1).join("\n")}</pre>
          <pre className="fp-code">{text}</pre>
        </div>
      )}
      {text == null && !error && <div className="fp-empty">Opening…</div>}
    </div>
  );
}
