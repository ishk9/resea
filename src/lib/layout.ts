import dagre from '@dagrejs/dagre';
import type { TreeNode } from './api';

export const NODE_W = 300;
export const NODE_H = 132;

// Top-down tidy layout of the whole tree. Returns {id: {x, y}}.
export function layoutTree(nodes: TreeNode[]): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 48, ranksep: 96 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const n of nodes) if (n.parent_id) g.setEdge(n.parent_id, n.id);
  dagre.layout(g);

  const pos: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const p = g.node(n.id);
    pos[n.id] = { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 };
  }
  return pos;
}

// Suggested position for a fresh child placed under its parent.
export function childPosition(parent: TreeNode, siblingCount: number): { x: number; y: number } {
  return { x: parent.x + siblingCount * (NODE_W + 48), y: parent.y + NODE_H + 96 };
}
