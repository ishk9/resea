#!/usr/bin/env node
import express from 'express';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import * as db from './db.js';
import { buildPrompt } from './context.js';
import { run as runBackend } from './backend.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5174;
const app = express();
app.use(express.json({ limit: '2mb' }));

// --- Boot check: claude CLI must be installed + logged in. ---
let claudeOk = false;
try {
  execFileSync('claude', ['--version'], { stdio: 'pipe' });
  claudeOk = true;
} catch {
  console.warn('[treechat] `claude` CLI not found on PATH. Install Claude Code and log in.');
}
app.get('/api/health', (_req, res) => res.json({ claude: claudeOk }));

// --- Agent bridge: any MCP-capable chat (Copilot, Claude Code, Codex) answers; we store the tree. ---
// The canvas reports its selection here; server/mcp.js reads it to know where the next answer goes.
let selection = { treeId: null, nodeId: null };
app.put('/api/selection', (req, res) => {
  selection = { treeId: req.body?.treeId ?? null, nodeId: req.body?.nodeId ?? null };
  res.json(selection);
});

// Live canvas updates: open SSE clients get { treeId, nodeId } whenever an agent adds a node.
const clients = new Set();
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders?.();
  clients.add(res);
  req.on('close', () => clients.delete(res));
});
const broadcast = (data) => { for (const c of clients) c.write(`data: ${JSON.stringify(data)}\n\n`); };

// root→selected thread, for the agent to answer from. Empty path = the next answer starts a new root.
app.get('/api/context', (_req, res) => {
  const tree = selection.treeId && db.getTree(selection.treeId);
  if (!tree) return res.status(409).json({ error: 'TreeChat canvas is not open. Run "TreeChat: Open" in VS Code.' });
  const path = selection.nodeId && db.getNode(selection.nodeId) ? db.getPath(selection.nodeId) : [];
  res.json({ tree: { id: tree.id, title: tree.title }, path: path.map(({ id, question, answer }) => ({ id, question, answer })) });
});

// Record an agent's answer as a child of parentId (or a new root when parentId is null).
app.post('/api/record', (req, res) => {
  const { question, answer, parentId = null, model = null } = req.body || {};
  if (!question || !answer) return res.status(400).json({ error: 'question and answer required' });
  const parent = parentId && db.getNode(parentId);
  if (parentId && !parent) return res.status(404).json({ error: `no node ${parentId}` });
  const treeId = parent ? parent.tree_id : selection.treeId;
  if (!treeId || !db.getTree(treeId)) return res.status(409).json({ error: 'TreeChat canvas is not open. Run "TreeChat: Open" in VS Code.' });
  // First root question names an untitled tree.
  if (!parent && !db.nodesByTree(treeId).length) db.renameTree(treeId, question.slice(0, 60));
  const node = db.createNode({ treeId, parentId, question, model });
  db.setResult(node.id, { answer, status: 'done', meta: { model } });
  selection = { treeId, nodeId: node.id };
  broadcast({ treeId, nodeId: node.id });
  res.json(db.getNode(node.id));
});

// --- Trees ---
app.get('/api/trees', (_req, res) => res.json(db.listTrees()));
app.post('/api/trees', (req, res) => res.json(db.createTree(req.body?.title)));
app.patch('/api/trees/:id', (req, res) => res.json(db.renameTree(req.params.id, req.body?.title || 'Untitled')));
app.get('/api/trees/:id', (req, res) => {
  const tree = db.getTree(req.params.id);
  if (!tree) return res.status(404).json({ error: 'not found' });
  res.json({ tree, nodes: db.nodesByTree(req.params.id), links: db.linksByTree(req.params.id) });
});

// --- Nodes ---
// Create a node (root if no parentId). Returns the draft node; call /stream to answer.
app.post('/api/nodes', (req, res) => {
  const { treeId, parentId = null, question = '', model, x, y } = req.body || {};
  if (!treeId) return res.status(400).json({ error: 'treeId required' });
  res.json(db.createNode({ treeId, parentId, question, model, x, y }));
});

app.patch('/api/nodes/:id', (req, res) => {
  const { x, y, question, context_mode, context_pick } = req.body || {};
  const id = req.params.id;
  const prev = db.getNode(id);
  if (!prev) return res.status(404).json({ error: 'not found' });
  if (x != null && y != null) db.setPosition(id, x, y);
  if (context_mode != null) db.setContextMode(id, context_mode, context_pick ?? null);
  let staleIds = [];
  if (question != null) {
    db.setQuestion(id, question);
    // Editing the question invalidates every descendant answer — grey them out.
    if (question !== prev.question) staleIds = db.markDescendantsStale(id);
  }
  res.json({ node: db.getNode(id), staleIds });
});

app.delete('/api/nodes/:id', (req, res) => {
  db.deleteNode(req.params.id);
  res.json({ ok: true });
});

// --- DAG context links: extra sources for a node beyond its tree parent. ---
app.post('/api/nodes/:id/links', (req, res) => {
  const { sourceId } = req.body || {};
  if (!sourceId) return res.status(400).json({ error: 'sourceId required' });
  db.addLink(req.params.id, sourceId);
  res.json({ links: db.getLinks(req.params.id) });
});
app.delete('/api/nodes/:id/links', (req, res) => {
  const sourceId = req.body?.sourceId || req.query.sourceId;
  if (!sourceId) return res.status(400).json({ error: 'sourceId required' });
  db.removeLink(req.params.id, sourceId);
  res.json({ links: db.getLinks(req.params.id) });
});

// --- Export: markdown of the root→node thread (path) or the node's subtree. ---
app.get('/api/nodes/:id/export', (req, res) => {
  const node = db.getNode(req.params.id);
  if (!node) return res.status(404).end();
  const scope = req.query.scope === 'subtree' ? 'subtree' : 'path';
  let md;
  if (scope === 'subtree') {
    // Depth-first, heading level = depth relative to the exported root.
    const nodes = db.subtree(req.params.id);
    const depth = new Map([[req.params.id, 0]]);
    md = nodes.map((n) => {
      const d = n.parent_id != null && depth.has(n.parent_id) ? depth.get(n.parent_id) + 1 : 0;
      depth.set(n.id, d);
      const h = '#'.repeat(Math.min(6, d + 1));
      return `${h} ${n.question || '(untitled)'}\n\n${n.answer || ''}`;
    }).join('\n\n');
  } else {
    md = db.getPath(req.params.id)
      .map((n) => `## ${n.question || '(untitled)'}\n\n${n.answer || ''}`)
      .join('\n\n');
  }
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.send(md);
});

// Stream the answer for a node via SSE. Assembles root→node path as context.
app.get('/api/nodes/:id/stream', async (req, res) => {
  const node = db.getNode(req.params.id);
  if (!node) return res.status(404).end();

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const ac = new AbortController();
  req.on('close', () => ac.abort());

  db.setStatus(node.id, 'streaming');
  const prompt = buildPrompt(node.id);
  let acc = ''; // accumulate deltas so a Stop can persist the partial answer
  try {
    const { text, meta = {} } = await runBackend(
      { prompt, model: node.model || 'sonnet' },
      { signal: ac.signal, onDelta: (t) => { acc += t; send('delta', { text: t }); } },
    );
    db.setResult(node.id, { answer: text, status: 'done', meta });
    send('done', { answer: text, meta });
  } catch (err) {
    // User Stop (client closed → abort): keep whatever streamed, don't record a failure.
    // Guard the status write so a stale abort can't clobber a newer regenerate that
    // already flipped this node back to 'streaming'.
    if (ac.signal.aborted) {
      if (db.getNode(node.id)?.status === 'streaming') {
        db.setResult(node.id, { answer: acc, status: 'done', meta: {} });
      }
    } else {
      db.setStatus(node.id, 'error');
      try { send('error', { message: String(err.message || err) }); } catch { /* socket gone */ }
    }
  }
  try { res.end(); } catch { /* socket already closed on abort */ }
});

// --- Serve built frontend if present ---
const dist = join(__dirname, '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`[treechat] http://localhost:${PORT}`));
