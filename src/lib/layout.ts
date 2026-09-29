import dagre from '@dagrejs/dagre';
import type { TreeNode } from './api';

export const NODE_W = 260;
export const NODE_H = 96;

// Top-down tidy layout of the whole tree, recomputed on every change. Returns {id: {x, y}}.
// Siblings are ordered by creation so new branches always land on the right.
export function layoutTree(nodes: TreeNode[]): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 64 });
  g.setDefaultEdgeLabel(() => ({}));
  const sorted = [...nodes].sort((a, b) => a.created_at - b.created_at);
  for (const n of sorted) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const n of sorted) if (n.parent_id) g.setEdge(n.parent_id, n.id);
  dagre.layout(g);

  const pos: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const p = g.node(n.id);
    pos[n.id] = { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 };
  }
  return pos;
}
