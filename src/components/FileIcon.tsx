import { iconFor, type IconKey } from "../core/files";

// Monograms for languages, pictographs for assets. One muted hue per family,
// so a full tree reads as calm grey with faint colour cues rather than logos.
const MONO: Partial<Record<IconKey, { text: string; hue: string }>> = {
  cs: { text: "C#", hue: "var(--i-violet)" },
  ts: { text: "TS", hue: "var(--i-blue)" },
  tsx: { text: "TX", hue: "var(--i-blue)" },
  js: { text: "JS", hue: "var(--i-amber)" },
  jsx: { text: "JX", hue: "var(--i-amber)" },
  py: { text: "Py", hue: "var(--i-teal)" },
  rs: { text: "Rs", hue: "var(--i-orange)" },
  go: { text: "Go", hue: "var(--i-cyan)" },
  java: { text: "Jv", hue: "var(--i-orange)" },
  kt: { text: "Kt", hue: "var(--i-violet)" },
  swift: { text: "Sw", hue: "var(--i-orange)" },
  rb: { text: "Rb", hue: "var(--i-red)" },
  php: { text: "Ph", hue: "var(--i-violet)" },
  c: { text: "C", hue: "var(--i-slate)" },
  cpp: { text: "C+", hue: "var(--i-slate)" },
  h: { text: "h", hue: "var(--i-slate)" },
  md: { text: "M", hue: "var(--i-grey)" },
  sql: { text: "SQ", hue: "var(--i-grey)" },
  shell: { text: ">_", hue: "var(--i-green)" },
};

export function FileIcon({ name, isDir, open }: { name: string; isDir?: boolean; open?: boolean }) {
  if (isDir) {
    return (
      <svg className="fi chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden>
        <path d={open ? "M2.5 4.5L6 8l3.5-3.5" : "M4.5 2.5L8 6l-3.5 3.5"} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  const key = iconFor(name);
  const mono = MONO[key];
  if (mono) {
    return (
      <span className="fi mono" style={{ color: mono.hue }} aria-hidden>{mono.text}</span>
    );
  }
  return <span className="fi glyph" aria-hidden>{GLYPH[key] ?? GLYPH.file}</span>;
}

const GLYPH: Record<string, string> = {
  html: "<>", css: "#", json: "{}", yaml: ":", toml: "=", xml: "</>", txt: "≡",
  image: "▣", font: "Aa", docker: "▤", git: "⑂", config: "⚙", lock: "🔒", claude: "✦", file: "·",
};
