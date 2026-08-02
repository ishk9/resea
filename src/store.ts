import { create } from 'zustand';
import { api, streamNode, type Tree, type TreeNode } from './lib/api';
import { childPosition, layoutTree } from './lib/layout';

interface State {
  claudeOk: boolean;
  trees: Tree[];
  treeId: string | null;
  nodes: Record<string, TreeNode>;
  selectedId: string | null;
  rootMode: boolean;
  collapsed: Record<string, true>; // node ids whose subtree is hidden
  model: string;

  boot: () => Promise<void>;
  openTree: (id: string) => Promise<void>;
  newTree: () => Promise<void>;
  renameTree: (id: string, title: string) => Promise<void>;
  select: (id: string | null) => void;
  startRoot: () => void;
  toggleCollapse: (id: string) => void;
  setModel: (m: string) => void;

  // Create a child of `parentId` (or root if null) with `question`, then stream it.
  ask: (parentId: string | null, question: string) => Promise<string>;
  moveNode: (id: string, x: number, y: number) => void;
  removeNode: (id: string) => Promise<void>;
  tidy: () => Promise<void>;
}

const idle = (n: TreeNode): TreeNode => ({ ...n });

export const useStore = create<State>((set, get) => ({
  claudeOk: true,
  trees: [],
  treeId: null,
  nodes: {},
  selectedId: null,
  rootMode: false,
  collapsed: {},
  model: 'sonnet',

  boot: async () => {
    const [{ claude }, trees] = await Promise.all([api.health(), api.listTrees()]);
    set({ claudeOk: claude, trees });
    if (trees.length) await get().openTree(trees[0].id);
    else await get().newTree();
  },

  openTree: async (id) => {
    const { nodes } = await api.getTree(id);
    set({ treeId: id, selectedId: null, rootMode: false, collapsed: {}, nodes: Object.fromEntries(nodes.map((n) => [n.id, idle(n)])) });
  },

  newTree: async () => {
    const tree = await api.createTree('Untitled');
    set((s) => ({ trees: [tree, ...s.trees] }));
    await get().openTree(tree.id);
  },

  renameTree: async (id, title) => {
    const clean = title.trim() || 'Untitled';
    set((s) => ({ trees: s.trees.map((t) => (t.id === id ? { ...t, title: clean } : t)) }));
    await api.renameTree(id, clean).catch(() => {});
  },

  select: (id) => set({ selectedId: id, rootMode: false }),
  startRoot: () => set({ selectedId: null, rootMode: true }),
  toggleCollapse: (id) => set((s) => {
    const next = { ...s.collapsed };
    if (next[id]) delete next[id]; else next[id] = true;
    return { collapsed: next };
  }),
  setModel: (m) => set({ model: m }),

  ask: async (parentId, question) => {
    const { treeId, nodes, model } = get();
    if (!treeId) throw new Error('no tree');
    const parent = parentId ? nodes[parentId] : null;
    const siblings = parent ? Object.values(nodes).filter((n) => n.parent_id === parent.id).length : 0;
    const pos = parent ? childPosition(parent, siblings) : { x: 0, y: 0 };

    const node = await api.createNode({ treeId, parentId, question, model, x: pos.x, y: pos.y });
    set((s) => ({ nodes: { ...s.nodes, [node.id]: { ...node, status: 'streaming' } }, selectedId: node.id, rootMode: false }));

    // First root question names the tree (was 'Untitled').
    if (!parentId && Object.values(get().nodes).filter((n) => !n.parent_id).length === 1) {
      const title = question.slice(0, 60);
      api.renameTree(treeId, title).catch(() => {});
      set((s) => ({ trees: s.trees.map((t) => (t.id === treeId ? { ...t, title } : t)) }));
    }

    streamNode(node.id, {
      onDelta: (t) =>
        set((s) => {
          const cur = s.nodes[node.id];
          if (!cur) return {};
          return { nodes: { ...s.nodes, [node.id]: { ...cur, answer: (cur.answer || '') + t } } };
        }),
      onDone: (answer) =>
        set((s) => s.nodes[node.id] ? { nodes: { ...s.nodes, [node.id]: { ...s.nodes[node.id], answer, status: 'done' } } } : {}),
      onError: (msg) =>
        set((s) => s.nodes[node.id] ? { nodes: { ...s.nodes, [node.id]: { ...s.nodes[node.id], answer: msg, status: 'error' } } } : {}),
    });
    return node.id;
  },

  moveNode: (id, x, y) => {
    set((s) => (s.nodes[id] ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], x, y } } } : {}));
    api.patchNode(id, { x, y }).catch(() => {});
  },

  removeNode: async (id) => {
    await api.deleteNode(id);
    // Server cascades descendants; simplest correct refresh is a reload.
    const { treeId } = get();
    if (treeId) await get().openTree(treeId);
  },

  tidy: async () => {
    const nodes = Object.values(get().nodes);
    const pos = layoutTree(nodes);
    set((s) => {
      const next = { ...s.nodes };
      for (const n of nodes) next[n.id] = { ...next[n.id], ...pos[n.id] };
      return { nodes: next };
    });
    await Promise.all(nodes.map((n) => api.patchNode(n.id, pos[n.id]).catch(() => {})));
  },
}));

// Root→selected ancestor chain as an ordered id array (for the active-path glow).
export function activePathIds(nodes: Record<string, TreeNode>, selectedId: string | null): string[] {
  const chain: string[] = [];
  let cur = selectedId ? nodes[selectedId] : null;
  while (cur) { chain.push(cur.id); cur = cur.parent_id ? nodes[cur.parent_id] : null; }
  return chain.reverse();
}

// Ids hidden because some ancestor is collapsed (the collapsed node itself stays visible).
export function hiddenIds(nodes: Record<string, TreeNode>, collapsed: Record<string, true>): Set<string> {
  const childrenOf: Record<string, string[]> = {};
  for (const n of Object.values(nodes)) if (n.parent_id) (childrenOf[n.parent_id] ||= []).push(n.id);
  const hidden = new Set<string>();
  const bury = (id: string) => { for (const c of childrenOf[id] || []) { hidden.add(c); bury(c); } };
  for (const id of Object.keys(collapsed)) if (nodes[id]) bury(id);
  return hidden;
}
