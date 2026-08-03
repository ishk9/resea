export interface NodeMeta {
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  model?: string;
}
export interface TreeNode {
  id: string;
  tree_id: string;
  parent_id: string | null;
  question: string;
  answer: string | null;
  model: string | null;
  status: 'draft' | 'streaming' | 'done' | 'error' | 'stale';
  x: number;
  y: number;
  created_at: number;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  duration_ms: number | null;
  context_mode?: string;
  context_pick?: string | null;
}
export interface Tree { id: string; title: string; created_at: number }

const j = async (r: Response) => {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};

export const api = {
  health: (): Promise<{ claude: boolean }> => fetch('/api/health').then(j),
  listTrees: (): Promise<Tree[]> => fetch('/api/trees').then(j),
  createTree: (title?: string): Promise<Tree> =>
    fetch('/api/trees', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) }).then(j),
  renameTree: (id: string, title: string): Promise<Tree> =>
    fetch(`/api/trees/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) }).then(j),
  getTree: (id: string): Promise<{ tree: Tree; nodes: TreeNode[]; links: Record<string, string[]> }> => fetch(`/api/trees/${id}`).then(j),

  createNode: (body: { treeId: string; parentId?: string | null; question?: string; model?: string; x?: number; y?: number }): Promise<TreeNode> =>
    fetch('/api/nodes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(j),
  // Server returns { node, staleIds } (staleIds only populated when question changes).
  // context_pick is sent as a JS array; the server JSON-stringifies it for storage.
  patchNode: (
    id: string,
    body: Partial<Pick<TreeNode, 'x' | 'y' | 'question'>> & { context_mode?: string; context_pick?: string[] | null },
  ): Promise<{ node: TreeNode; staleIds: string[] }> =>
    fetch(`/api/nodes/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(j),
  deleteNode: (id: string): Promise<{ ok: true }> => fetch(`/api/nodes/${id}`, { method: 'DELETE' }).then(j),
  addLink: (id: string, sourceId: string): Promise<{ links: string[] }> =>
    fetch(`/api/nodes/${id}/links`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceId }) }).then(j),
  removeLink: (id: string, sourceId: string): Promise<{ links: string[] }> =>
    fetch(`/api/nodes/${id}/links`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceId }) }).then(j),
  exportUrl: (id: string, scope: 'path' | 'subtree') => `/api/nodes/${id}/export?scope=${scope}`,
};

// Stream a node's answer over SSE. Returns an unsubscribe/abort function.
export function streamNode(
  id: string,
  handlers: { onDelta: (t: string) => void; onDone: (answer: string, meta: NodeMeta | null) => void; onError: (msg: string) => void },
): () => void {
  const es = new EventSource(`/api/nodes/${id}/stream`);
  es.addEventListener('delta', (e) => handlers.onDelta(JSON.parse((e as MessageEvent).data).text));
  es.addEventListener('done', (e) => {
    const d = JSON.parse((e as MessageEvent).data);
    handlers.onDone(d.answer, d.meta ?? null);
    es.close();
  });
  es.addEventListener('error', (e) => {
    // SSE 'error' fires both on our server error event and on connection close.
    const data = (e as MessageEvent).data;
    if (data) handlers.onError(JSON.parse(data).message);
    es.close();
  });
  return () => es.close();
}
