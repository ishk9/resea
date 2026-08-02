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

// --- Trees ---
app.get('/api/trees', (_req, res) => res.json(db.listTrees()));
app.post('/api/trees', (req, res) => res.json(db.createTree(req.body?.title)));
app.patch('/api/trees/:id', (req, res) => res.json(db.renameTree(req.params.id, req.body?.title || 'Untitled')));
app.get('/api/trees/:id', (req, res) => {
  const tree = db.getTree(req.params.id);
  if (!tree) return res.status(404).json({ error: 'not found' });
  res.json({ tree, nodes: db.nodesByTree(req.params.id) });
});

// --- Nodes ---
// Create a node (root if no parentId). Returns the draft node; call /stream to answer.
app.post('/api/nodes', (req, res) => {
  const { treeId, parentId = null, question = '', model, x, y } = req.body || {};
  if (!treeId) return res.status(400).json({ error: 'treeId required' });
  res.json(db.createNode({ treeId, parentId, question, model, x, y }));
});

app.patch('/api/nodes/:id', (req, res) => {
  const { x, y, question } = req.body || {};
  if (x != null && y != null) db.setPosition(req.params.id, x, y);
  if (question != null) db.setQuestion(req.params.id, question);
  res.json(db.getNode(req.params.id));
});

app.delete('/api/nodes/:id', (req, res) => {
  db.deleteNode(req.params.id);
  res.json({ ok: true });
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
  try {
    const full = await runBackend(
      { prompt, model: node.model || 'sonnet' },
      { signal: ac.signal, onDelta: (t) => send('delta', { text: t }) },
    );
    db.setAnswer(node.id, full, 'done');
    send('done', { answer: full });
  } catch (err) {
    db.setStatus(node.id, 'error');
    send('error', { message: String(err.message || err) });
  }
  res.end();
});

// --- Serve built frontend if present ---
const dist = join(__dirname, '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`[treechat] http://localhost:${PORT}`));
