export interface TreeNode {
  id: string;
  tree_id: string;
  parent_id: string | null;
  question: string;
  answer: string | null;
  model: string | null;
  status: 'draft' | 'streaming' | 'done' | 'error';
  x: number;
  y: number;
  created_at: number;
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
  getTree: (id: string): Promise<{ tree: Tree; nodes: TreeNode[] }> => fetch(`/api/trees/${id}`).then(j),

  createNode: (body: { treeId: string; parentId?: string | null; question?: string; model?: string; x?: number; y?: number }): Promise<TreeNode> =>
    fetch('/api/nodes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(j),
  patchNode: (id: string, body: Partial<Pick<TreeNode, 'x' | 'y' | 'question'>>): Promise<TreeNode> =>
    fetch(`/api/nodes/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(j),
  deleteNode: (id: string): Promise<{ ok: true }> => fetch(`/api/nodes/${id}`, { method: 'DELETE' }).then(j),
};

// Stream a node's answer over SSE. Returns an unsubscribe/abort function.
export function streamNode(
  id: string,
  handlers: { onDelta: (t: string) => void; onDone: (answer: string) => void; onError: (msg: string) => void },
): () => void {
  const es = new EventSource(`/api/nodes/${id}/stream`);
  es.addEventListener('delta', (e) => handlers.onDelta(JSON.parse((e as MessageEvent).data).text));
  es.addEventListener('done', (e) => { handlers.onDone(JSON.parse((e as MessageEvent).data).answer); es.close(); });
  es.addEventListener('error', (e) => {
    // SSE 'error' fires both on our server error event and on connection close.
    const data = (e as MessageEvent).data;
    if (data) handlers.onError(JSON.parse(data).message);
    es.close();
  });
  return () => es.close();
}
