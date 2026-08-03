import { create } from 'zustand';
import { api, streamNode, type NodeMeta, type Tree, type TreeNode } from './lib/api';
import { childPosition, layoutTree } from './lib/layout';

// Live EventSource abort fns per streaming node (not React state — just refs).
const streams: Record<string, () => void> = {};

type Theme = 'dark' | 'light';
const initialTheme: Theme = (localStorage.getItem('treechat:theme') as Theme) || 'dark';
function applyTheme(t: Theme) { document.documentElement.dataset.theme = t; }
applyTheme(initialTheme); // apply before first paint

interface State {
  claudeOk: boolean;
  trees: Tree[];
  treeId: string | null;
  nodes: Record<string, TreeNode>;
  selectedId: string | null;
  rootMode: boolean;
  collapsed: Record<string, true>; // node ids whose subtree is hidden
  model: string;
  links: Record<string, string[]>; // node id -> extra context source ids (DAG links)
  linkMode: boolean; // when true, clicking a node links it as a source for the selected node
  compareIds: [string, string] | null; // A/B pair shown side-by-side in the panel
  theme: Theme;

  toggleTheme: () => void;
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
  // Two sibling children under the same parent, same question, different models, streamed in parallel.
  askAB: (parentId: string | null, question: string, models: [string, string]) => Promise<void>;
  setCompare: (pair: [string, string] | null) => void;
  stopStream: (id: string) => void;
  regenerate: (id: string) => void;
  editQuestion: (id: string, question: string) => Promise<void>;
  setContextMode: (id: string, mode: string, pick?: string[] | null) => Promise<void>;
  toggleLinkMode: () => void;
  addLink: (id: string, sourceId: string) => Promise<void>;
  removeLink: (id: string, sourceId: string) => Promise<void>;
  moveNode: (id: string, x: number, y: number) => void;
  removeNode: (id: string) => Promise<void>;
  tidy: () => Promise<void>;
}

const idle = (n: TreeNode): TreeNode => ({ ...n });

// Open the stream for a node and pipe deltas/done/error into the store. Shared by ask + regenerate.
function runStream(id: string, set: (fn: (s: State) => Partial<State>) => void) {
  streams[id] = streamNode(id, {
    onDelta: (t) =>
      set((s) => {
        const cur = s.nodes[id];
        if (!cur) return {};
        return { nodes: { ...s.nodes, [id]: { ...cur, answer: (cur.answer || '') + t } } };
      }),
    onDone: (answer, meta: NodeMeta | null) => {
      delete streams[id];
      set((s) => (s.nodes[id] ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], answer, status: 'done', ...(meta || {}) } } } : {}));
    },
    onError: (msg) => {
      delete streams[id];
      set((s) => (s.nodes[id] ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], answer: msg, status: 'error' } } } : {}));
    },
  });
}

export const useStore = create<State>((set, get) => ({
  claudeOk: true,
  trees: [],
  treeId: null,
  nodes: {},
  selectedId: null,
  rootMode: false,
  collapsed: {},
  model: 'sonnet',
  links: {},
  linkMode: false,
  compareIds: null,
  theme: initialTheme,

  toggleTheme: () => set((s) => {
    const theme: Theme = s.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('treechat:theme', theme);
    applyTheme(theme);
    return { theme };
  }),

  boot: async () => {
    const [{ claude }, trees] = await Promise.all([api.health(), api.listTrees()]);
    set({ claudeOk: claude, trees });
    if (trees.length) await get().openTree(trees[0].id);
    else await get().newTree();
  },

  openTree: async (id) => {
    for (const k in streams) { streams[k](); delete streams[k]; } // close live streams from the old tree
    const { nodes, links } = await api.getTree(id);
    set({ treeId: id, selectedId: null, rootMode: false, collapsed: {}, linkMode: false, compareIds: null, links: links || {}, nodes: Object.fromEntries(nodes.map((n) => [n.id, idle(n)])) });
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

  select: (id) => set({ selectedId: id, rootMode: false, compareIds: null }),
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

    runStream(node.id, set);
    return node.id;
  },

  askAB: async (parentId, question, models) => {
    const { treeId, nodes } = get();
    if (!treeId) throw new Error('no tree');
    const parent = parentId ? nodes[parentId] : null;
    const base = parent ? Object.values(nodes).filter((n) => n.parent_id === parent.id).length : 0;
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const pos = parent ? childPosition(parent, base + i) : { x: (i === 0 ? -170 : 170), y: 0 };
      const node = await api.createNode({ treeId, parentId, question, model: models[i], x: pos.x, y: pos.y });
      ids.push(node.id);
      set((s) => ({ nodes: { ...s.nodes, [node.id]: { ...node, status: 'streaming' } } }));
      runStream(node.id, set);
    }
    // Auto-open the side-by-side compare view on the new pair.
    set({ compareIds: [ids[0], ids[1]], selectedId: ids[0], rootMode: false });
  },

  setCompare: (pair) => set({ compareIds: pair }),

  stopStream: (id) => {
    streams[id]?.();
    delete streams[id];
    set((s) => (s.nodes[id]?.status === 'streaming' ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], status: s.nodes[id].answer ? 'done' : 'error' } } } : {}));
  },

  regenerate: (id) => {
    const cur = get().nodes[id];
    if (!cur) return;
    streams[id]?.();
    set((s) => ({ nodes: { ...s.nodes, [id]: { ...s.nodes[id], answer: '', status: 'streaming', tokens_in: null, tokens_out: null, cost_usd: null, duration_ms: null } } }));
    runStream(id, set);
  },

  editQuestion: async (id, question) => {
    const q = question.trim();
    if (!q) return;
    const { node, staleIds } = await api.patchNode(id, { question: q });
    set((s) => {
      const next = { ...s.nodes, [id]: { ...s.nodes[id], ...node, answer: '', status: 'streaming' as const, tokens_in: null, tokens_out: null, cost_usd: null, duration_ms: null } };
      for (const sid of staleIds) if (next[sid]) next[sid] = { ...next[sid], status: 'stale' };
      return { nodes: next };
    });
    streams[id]?.();
    runStream(id, set);
  },

  setContextMode: async (id, mode, pick = null) => {
    set((s) => (s.nodes[id] ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], context_mode: mode, context_pick: pick == null ? null : JSON.stringify(pick) } } } : {}));
    await api.patchNode(id, { context_mode: mode, context_pick: pick }).catch(() => {});
  },

  toggleLinkMode: () => set((s) => ({ linkMode: !s.linkMode })),

  addLink: async (id, sourceId) => {
    if (id === sourceId) return; // can't link a node to itself
    const { links } = await api.addLink(id, sourceId);
    set((s) => ({ links: { ...s.links, [id]: links } }));
  },

  removeLink: async (id, sourceId) => {
    const { links } = await api.removeLink(id, sourceId);
    set((s) => ({ links: { ...s.links, [id]: links } }));
  },

  moveNode: (id, x, y) => {
    set((s) => (s.nodes[id] ? { nodes: { ...s.nodes, [id]: { ...s.nodes[id], x, y } } } : {}));
    api.patchNode(id, { x, y }).catch(() => {});
  },

  removeNode: async (id) => {
    streams[id]?.(); delete streams[id]; // stop this node's stream if mid-generation
    await api.deleteNode(id);
    // Server cascades descendants; openTree reload also closes any descendant streams.
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
