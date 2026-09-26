// Layout tree: binary-ish split tree whose leaves are panes.
// Internal nodes are rows (children side by side) or columns (stacked).
// Pure functions; the store owns the tree and applies results.

export type Dir = "left" | "right" | "up" | "down";
export type Orientation = "row" | "column";

export interface LeafNode { kind: "leaf"; id: string; paneId: string }
export interface SplitNode {
  kind: "split";
  id: string;
  orientation: Orientation;
  children: LayoutNode[];
  ratios: number[]; // sums to 1
}
export type LayoutNode = LeafNode | SplitNode;

export interface Rect { x: number; y: number; w: number; h: number }
export interface LaidOutPane { paneId: string; rect: Rect }
export interface LaidOutGap { nodeId: string; index: number; orientation: Orientation; rect: Rect }

let seq = 0;
export const nid = () => `n${++seq}_${Math.random().toString(36).slice(2, 7)}`;

export const leaf = (paneId: string): LeafNode => ({ kind: "leaf", id: nid(), paneId });

export function findLeaf(node: LayoutNode, paneId: string): LeafNode | null {
  if (node.kind === "leaf") return node.paneId === paneId ? node : null;
  for (const c of node.children) { const r = findLeaf(c, paneId); if (r) return r; }
  return null;
}

export function leaves(node: LayoutNode): LeafNode[] {
  return node.kind === "leaf" ? [node] : node.children.flatMap(leaves);
}

function parentOf(root: LayoutNode, id: string): SplitNode | null {
  if (root.kind === "leaf") return null;
  for (const c of root.children) {
    if (c.id === id) return root;
    const p = parentOf(c, id); if (p) return p;
  }
  return null;
}

const dirOrientation = (d: Dir): Orientation => (d === "left" || d === "right" ? "row" : "column");
const dirAfter = (d: Dir) => d === "right" || d === "down";

export function parentOfLeaf(root: LayoutNode, paneId: string): SplitNode | null {
  const l = findLeaf(root, paneId);
  return l ? parentOf(root, l.id) : null;
}

/** Add a fixed-ish column at the left edge of the whole layout. */
export function prependColumn(root: LayoutNode, newPaneId: string, share: number): LayoutNode {
  const newLeaf = leaf(newPaneId);
  if (root.kind === "split" && root.orientation === "row") {
    const ratios = root.ratios.map((r) => r * (1 - share));
    return { ...root, children: [newLeaf, ...root.children], ratios: [share, ...ratios] };
  }
  return { kind: "split", id: nid(), orientation: "row", children: [newLeaf, root], ratios: [share, 1 - share] };
}

/** Add a full-height column at the right edge of the whole layout taking `share` of the width. */
export function appendColumn(root: LayoutNode, newPaneId: string, share: number): LayoutNode {
  const newLeaf = leaf(newPaneId);
  if (root.kind === "split" && root.orientation === "row") {
    const ratios = root.ratios.map((r) => r * (1 - share));
    return { ...root, children: [...root.children, newLeaf], ratios: [...ratios, share] };
  }
  return { kind: "split", id: nid(), orientation: "row", children: [root, newLeaf], ratios: [1 - share, share] };
}

/** Split the leaf holding `paneId`, inserting `newPaneId` on side `dir`. */
export function split(root: LayoutNode, paneId: string, newPaneId: string, dir: Dir): LayoutNode {
  const orientation = dirOrientation(dir);
  const after = dirAfter(dir);
  const target = findLeaf(root, paneId);
  if (!target) return root;
  const newLeaf = leaf(newPaneId);
  const parent = parentOf(root, target.id);

  // Same orientation as parent: insert a sibling, redistributing ratios.
  if (parent && parent.orientation === orientation) {
    const i = parent.children.indexOf(target);
    const share = parent.ratios[i] / 2;
    const children = [...parent.children];
    const ratios = [...parent.ratios];
    ratios[i] = share;
    children.splice(after ? i + 1 : i, 0, newLeaf);
    ratios.splice(after ? i + 1 : i, 0, share);
    return replace(root, parent.id, { ...parent, children, ratios });
  }
  const node: SplitNode = {
    kind: "split", id: nid(), orientation,
    children: after ? [target, newLeaf] : [newLeaf, target],
    ratios: [0.5, 0.5],
  };
  return replace(root, target.id, node);
}

export function replace(root: LayoutNode, id: string, withNode: LayoutNode): LayoutNode {
  if (root.id === id) return withNode;
  if (root.kind === "leaf") return root;
  return { ...root, children: root.children.map((c) => replace(c, id, withNode)) };
}

/** Remove the leaf holding `paneId`; siblings absorb its space. */
export function remove(root: LayoutNode, paneId: string): LayoutNode | null {
  const target = findLeaf(root, paneId);
  if (!target) return root;
  if (root.id === target.id) return null;
  const parent = parentOf(root, target.id)!;
  const i = parent.children.indexOf(target);
  const children = parent.children.filter((_, k) => k !== i);
  const removed = parent.ratios[i];
  const ratios = parent.ratios.filter((_, k) => k !== i).map((r) => r / (1 - removed || 1));
  if (children.length === 1) return replace(root, parent.id, children[0]);
  return replace(root, parent.id, { ...parent, children, ratios });
}

export function setRatio(root: LayoutNode, nodeId: string, index: number, delta: number, min = 0.08): LayoutNode {
  const walk = (n: LayoutNode): LayoutNode => {
    if (n.kind === "leaf") return n;
    if (n.id === nodeId) {
      const r = [...n.ratios];
      const a = r[index], b = r[index + 1];
      const d = Math.max(-(a - min), Math.min(b - min, delta));
      r[index] = a + d; r[index + 1] = b - d;
      return { ...n, ratios: r };
    }
    return { ...n, children: n.children.map(walk) };
  };
  return walk(root);
}

export function equalize(root: LayoutNode, nodeId?: string): LayoutNode {
  const walk = (n: LayoutNode, inside: boolean): LayoutNode => {
    if (n.kind === "leaf") return n;
    const hit = inside || !nodeId || n.id === nodeId;
    const ratios = hit ? n.children.map(() => 1 / n.children.length) : n.ratios;
    return { ...n, ratios, children: n.children.map((c) => walk(c, hit)) };
  };
  return walk(root, false);
}

/** Compute pixel rects for every leaf and every resizable gap. */
export function layout(root: LayoutNode, area: Rect, gap: number): { panes: LaidOutPane[]; gaps: LaidOutGap[] } {
  const panes: LaidOutPane[] = [];
  const gaps: LaidOutGap[] = [];
  const walk = (n: LayoutNode, r: Rect) => {
    if (n.kind === "leaf") { panes.push({ paneId: n.paneId, rect: r }); return; }
    const total = n.orientation === "row" ? r.w : r.h;
    const avail = total - gap * (n.children.length - 1);
    let cursor = n.orientation === "row" ? r.x : r.y;
    n.children.forEach((c, i) => {
      const size = Math.round(avail * n.ratios[i]);
      const cr: Rect = n.orientation === "row"
        ? { x: cursor, y: r.y, w: size, h: r.h }
        : { x: r.x, y: cursor, w: r.w, h: size };
      walk(c, cr);
      cursor += size;
      if (i < n.children.length - 1) {
        gaps.push({
          nodeId: n.id, index: i, orientation: n.orientation,
          rect: n.orientation === "row"
            ? { x: cursor, y: r.y, w: gap, h: r.h }
            : { x: r.x, y: cursor, w: r.w, h: gap },
        });
        cursor += gap;
      }
    });
  };
  walk(root, area);
  return { panes, gaps };
}

/** Find the pane geometrically adjacent in direction `dir` from `paneId`. */
export function neighbor(panes: LaidOutPane[], paneId: string, dir: Dir): string | null {
  const me = panes.find((p) => p.paneId === paneId);
  if (!me) return null;
  const cx = me.rect.x + me.rect.w / 2, cy = me.rect.y + me.rect.h / 2;
  let best: { id: string; d: number } | null = null;
  for (const p of panes) {
    if (p.paneId === paneId) continue;
    const r = p.rect;
    const ok =
      dir === "left" ? r.x + r.w <= me.rect.x + 1 && r.y < me.rect.y + me.rect.h && r.y + r.h > me.rect.y :
      dir === "right" ? r.x >= me.rect.x + me.rect.w - 1 && r.y < me.rect.y + me.rect.h && r.y + r.h > me.rect.y :
      dir === "up" ? r.y + r.h <= me.rect.y + 1 && r.x < me.rect.x + me.rect.w && r.x + r.w > me.rect.x :
      r.y >= me.rect.y + me.rect.h - 1 && r.x < me.rect.x + me.rect.w && r.x + r.w > me.rect.x;
    if (!ok) continue;
    const px = r.x + r.w / 2, py = r.y + r.h / 2;
    const d = dir === "left" || dir === "right" ? Math.abs(px - cx) * 2 + Math.abs(py - cy) : Math.abs(py - cy) * 2 + Math.abs(px - cx);
    if (!best || d < best.d) best = { id: p.paneId, d };
  }
  return best?.id ?? null;
}

/** Drop leaves whose pane fails `keep`; collapses empty splits. */
export function prune(node: LayoutNode, keep: (paneId: string) => boolean): LayoutNode | null {
  if (node.kind === "leaf") return keep(node.paneId) ? node : null;
  const kept: LayoutNode[] = [];
  const ratios: number[] = [];
  node.children.forEach((c, i) => {
    const p = prune(c, keep);
    if (p) { kept.push(p); ratios.push(node.ratios[i]); }
  });
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0];
  const total = ratios.reduce((a, b) => a + b, 0) || 1;
  return { ...node, children: kept, ratios: ratios.map((r) => r / total) };
}

/** Swap two panes' positions in the tree. */
export function swap(root: LayoutNode, a: string, b: string): LayoutNode {
  const walk = (n: LayoutNode): LayoutNode => {
    if (n.kind === "leaf") return n.paneId === a ? { ...n, paneId: b } : n.paneId === b ? { ...n, paneId: a } : n;
    return { ...n, children: n.children.map(walk) };
  };
  return walk(root);
}

/** Resize: grow the pane's edge in `dir` by `delta` fraction of the parent axis. */
export function resize(root: LayoutNode, paneId: string, dir: Dir, deltaFrac: number): LayoutNode {
  const target = findLeaf(root, paneId);
  if (!target) return root;
  const orientation = dirOrientation(dir);
  // climb until we find an ancestor with the right orientation
  let child: LayoutNode = target;
  let parent = parentOf(root, child.id);
  while (parent && parent.orientation !== orientation) { child = parent; parent = parentOf(root, parent.id); }
  if (!parent) return root;
  const i = parent.children.indexOf(child);
  if (dir === "right" || dir === "down") {
    if (i >= parent.children.length - 1) return root;
    return setRatio(root, parent.id, i, deltaFrac);
  }
  if (i === 0) return root;
  return setRatio(root, parent.id, i - 1, -deltaFrac);
}
