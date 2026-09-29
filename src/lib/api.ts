export interface TreeNode {
  id: string;
  tree_id: string;
  parent_id: string | null;
  question: string;
  answer: string | null;
  model: string | null;
  status: 'draft' | 'streaming' | 'done' | 'error' | 'stale';
  created_at: number;
}
export interface Tree { id: string; title: string; created_at: number }

const j = async (r: Response) => {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};
const json = (method: string, body: unknown) =>
  ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  listTrees: (): Promise<Tree[]> => fetch('/api/trees').then(j),
  createTree: (title?: string): Promise<Tree> => fetch('/api/trees', json('POST', { title })).then(j),
  getTree: (id: string): Promise<{ tree: Tree; nodes: TreeNode[] }> => fetch(`/api/trees/${id}`).then(j),
  deleteNode: (id: string): Promise<{ ok: true }> => fetch(`/api/nodes/${id}`, { method: 'DELETE' }).then(j),
  setSelection: (treeId: string | null, nodeId: string | null) => fetch('/api/selection', json('PUT', { treeId, nodeId })).then(j),
};
