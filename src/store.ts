import { create } from 'zustand';
import { api, type Tree, type TreeNode } from './lib/api';

type Theme = 'dark' | 'light';
const initialTheme: Theme = (localStorage.getItem('treechat:theme') as Theme) || 'light';
function applyTheme(t: Theme) { document.documentElement.dataset.theme = t; }
applyTheme(initialTheme); // apply before first paint

interface State {
  trees: Tree[];
  treeId: string | null;
  nodes: Record<string, TreeNode>;
  selectedId: string | null; // where the next agent answer attaches; null = new root thread
  theme: Theme;

  toggleTheme: () => void;
  boot: () => Promise<void>;
  openTree: (id: string, selectId?: string | null) => Promise<void>;
  newTree: () => Promise<void>;
  select: (id: string | null) => void;
  removeNode: (id: string) => Promise<void>;
}

export const useStore = create<State>((set, get) => ({
  trees: [],
  treeId: null,
  nodes: {},
  selectedId: null,
  theme: initialTheme,

  toggleTheme: () => set((s) => {
    const theme: Theme = s.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('treechat:theme', theme);
    applyTheme(theme);
    return { theme };
  }),

  boot: async () => {
    const trees = await api.listTrees();
    set({ trees });
    if (trees.length) await get().openTree(trees[0].id);
    else await get().newTree();

    // An agent recorded a node (via the MCP server): reload that tree and follow the new node.
    new EventSource('/api/events').onmessage = async (e) => {
      const { treeId, nodeId } = JSON.parse(e.data);
      set({ trees: await api.listTrees() }); // a first root question may have renamed the tree
      await get().openTree(treeId, nodeId);
    };
  },

  openTree: async (id, selectId = null) => {
    const { nodes } = await api.getTree(id);
    set({ treeId: id, selectedId: selectId, nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) });
  },

  newTree: async () => {
    // Reuse an empty tree instead of piling up blank ones.
    const { treeId, nodes } = get();
    if (treeId && !Object.keys(nodes).length) return set({ selectedId: null });
    const tree = await api.createTree('Untitled');
    set((s) => ({ trees: [tree, ...s.trees] }));
    await get().openTree(tree.id);
  },

  select: (id) => set({ selectedId: id }),

  removeNode: async (id) => {
    const parent = get().nodes[id]?.parent_id ?? null;
    await api.deleteNode(id); // server cascades descendants
    const { treeId } = get();
    if (treeId) await get().openTree(treeId, parent);
  },
}));

// Tell the server what's selected, so the agent's next answer lands under it.
useStore.subscribe((s, prev) => {
  if (s.treeId !== prev.treeId || s.selectedId !== prev.selectedId) {
    api.setSelection(s.treeId, s.selectedId).catch(() => {});
  }
});

// Root→selected ancestor chain as an ordered id array (for the lit path).
export function activePathIds(nodes: Record<string, TreeNode>, selectedId: string | null): string[] {
  const chain: string[] = [];
  let cur = selectedId ? nodes[selectedId] : null;
  while (cur) { chain.push(cur.id); cur = cur.parent_id ? nodes[cur.parent_id] : null; }
  return chain.reverse();
}
