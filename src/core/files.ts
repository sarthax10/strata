// Project tree data: shallow directory reads, git status, and file actions.
import { invoke } from "@tauri-apps/api/core";

export interface Entry { name: string; path: string; is_dir: boolean; size: number; hidden: boolean }
export interface GitStatus {
  root: string; branch: string; ahead: number; behind: number;
  files: Record<string, string>; // absolute path (forward slashes) -> M A D U C
}

export const readDir = (path: string) => invoke<Entry[]>("read_dir", { path });
export const gitStatus = (path: string) => invoke<GitStatus | null>("git_status", { path });
export const createPath = (path: string, isDir: boolean) => invoke<void>("create_path", { path, isDir });
export const renamePath = (from: string, to: string) => invoke<void>("rename_path", { from, to });
export const trashPath = (path: string) => invoke<void>("trash_path", { path });
export const revealInExplorer = (path: string) => invoke<void>("reveal_in_explorer", { path });
export const readTextFile = (path: string, maxBytes?: number) => invoke<string>("read_text_file", { path, maxBytes });

export const norm = (p: string) => p.replace(/\\/g, "/");
export const parentOf = (p: string) => norm(p).split("/").slice(0, -1).join("/");
export const baseName = (p: string) => norm(p).split("/").filter(Boolean).slice(-1)[0] ?? p;
export const joinPath = (dir: string, name: string) => `${norm(dir).replace(/\/$/, "")}/${name}`;

/** Two-letter monogram or pictograph key per file type; drawn by FileIcon. */
export type IconKey =
  | "cs" | "ts" | "tsx" | "js" | "jsx" | "py" | "rs" | "go" | "java" | "kt" | "swift" | "rb" | "php"
  | "c" | "cpp" | "h" | "html" | "css" | "json" | "yaml" | "toml" | "xml" | "sql" | "md" | "txt"
  | "image" | "font" | "docker" | "git" | "config" | "lock" | "claude" | "shell" | "file";

const BY_EXT: Record<string, IconKey> = {
  cs: "cs", fs: "cs", vb: "cs",
  ts: "ts", mts: "ts", cts: "ts", tsx: "tsx",
  js: "js", mjs: "js", cjs: "js", jsx: "jsx",
  py: "py", pyi: "py", rs: "rs", go: "go", java: "java", kt: "kt", kts: "kt", swift: "swift", rb: "rb", php: "php",
  c: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", h: "h", hpp: "h",
  html: "html", htm: "html", css: "css", scss: "css", sass: "css", less: "css",
  json: "json", jsonc: "json", yaml: "yaml", yml: "yaml", toml: "toml", xml: "xml", svg: "image",
  sql: "sql", md: "md", mdx: "md", txt: "txt", log: "txt",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", ico: "image", avif: "image",
  ttf: "font", otf: "font", woff: "font", woff2: "font",
  ps1: "shell", psm1: "shell", sh: "shell", bash: "shell", zsh: "shell", bat: "shell", cmd: "shell",
};

const BY_NAME: Record<string, IconKey> = {
  dockerfile: "docker", "docker-compose.yml": "docker", "docker-compose.yaml": "docker", ".dockerignore": "docker",
  ".gitignore": "git", ".gitattributes": "git", ".gitmodules": "git",
  ".env": "config", ".editorconfig": "config", ".npmrc": "config", ".prettierrc": "config",
  "claude.md": "claude",
  "package-lock.json": "lock", "cargo.lock": "lock", "pnpm-lock.yaml": "lock", "yarn.lock": "lock",
};

export function iconFor(name: string): IconKey {
  const lower = name.toLowerCase();
  if (BY_NAME[lower]) return BY_NAME[lower];
  if (/\.config\.[jt]s$/.test(lower) || /^\.env\./.test(lower)) return "config";
  const ext = lower.includes(".") ? lower.split(".").pop()! : "";
  return BY_EXT[ext] ?? "file";
}
