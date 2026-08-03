import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// DB lives in ~/.treechat so it survives across working dirs and `npx` runs.
const dir = process.env.TREECHAT_DIR || join(homedir(), '.treechat');
mkdirSync(dir, { recursive: true });
const db = new Database(join(dir, 'db.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS trees (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    tree_id TEXT NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
    question TEXT,
    answer TEXT,
    model TEXT,
    status TEXT DEFAULT 'draft',
    x REAL DEFAULT 0,
    y REAL DEFAULT 0,
    created_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_nodes_tree ON nodes(tree_id);
  CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
  CREATE TABLE IF NOT EXISTS node_links (
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    PRIMARY KEY (node_id, source_id)
  );
  CREATE INDEX IF NOT EXISTS idx_links_node ON node_links(node_id);
`);

// Guarded migration: add v2 columns to existing DBs. `ADD COLUMN` throws if the
// column already exists, so probe pragma first.
const cols = new Set(db.prepare(`PRAGMA table_info(nodes)`).all().map((c) => c.name));
const addCol = (name, decl) => { if (!cols.has(name)) db.exec(`ALTER TABLE nodes ADD COLUMN ${name} ${decl}`); };
addCol('tokens_in', 'INTEGER');
addCol('tokens_out', 'INTEGER');
addCol('cost_usd', 'REAL');
addCol('duration_ms', 'INTEGER');
addCol('context_mode', `TEXT DEFAULT 'full'`);
addCol('context_pick', 'TEXT');

const now = () => Date.now();

const stmt = {
  insTree: db.prepare(`INSERT INTO trees (id, title, created_at) VALUES (?, ?, ?)`),
  getTree: db.prepare(`SELECT * FROM trees WHERE id = ?`),
  renameTree: db.prepare(`UPDATE trees SET title = ? WHERE id = ?`),
  listTrees: db.prepare(`SELECT * FROM trees ORDER BY created_at DESC`),
  insNode: db.prepare(`INSERT INTO nodes (id, tree_id, parent_id, question, model, status, x, y, created_at)
                       VALUES (@id, @tree_id, @parent_id, @question, @model, @status, @x, @y, @created_at)`),
  getNode: db.prepare(`SELECT * FROM nodes WHERE id = ?`),
  nodesByTree: db.prepare(`SELECT * FROM nodes WHERE tree_id = ? ORDER BY created_at`),
  setAnswer: db.prepare(`UPDATE nodes SET answer = ?, status = ? WHERE id = ?`),
  setStatus: db.prepare(`UPDATE nodes SET status = ? WHERE id = ?`),
  setPos: db.prepare(`UPDATE nodes SET x = ?, y = ? WHERE id = ?`),
  setQuestion: db.prepare(`UPDATE nodes SET question = ? WHERE id = ?`),
  delNode: db.prepare(`DELETE FROM nodes WHERE id = ?`),
  setResult: db.prepare(`UPDATE nodes SET answer = @answer, status = @status,
                         tokens_in = @tokens_in, tokens_out = @tokens_out,
                         cost_usd = @cost_usd, duration_ms = @duration_ms, model = @model
                         WHERE id = @id`),
  setContextMode: db.prepare(`UPDATE nodes SET context_mode = ?, context_pick = ? WHERE id = ?`),
  childrenOf: db.prepare(`SELECT id FROM nodes WHERE parent_id = ?`),
  addLink: db.prepare(`INSERT OR IGNORE INTO node_links (node_id, source_id) VALUES (?, ?)`),
  removeLink: db.prepare(`DELETE FROM node_links WHERE node_id = ? AND source_id = ?`),
  getLinks: db.prepare(`SELECT source_id FROM node_links WHERE node_id = ?`),
  linksByTree: db.prepare(`SELECT l.node_id, l.source_id FROM node_links l
                           JOIN nodes n ON n.id = l.node_id WHERE n.tree_id = ?`),
};

export function createTree(title = 'Untitled') {
  const id = randomUUID();
  stmt.insTree.run(id, title, now());
  return stmt.getTree.get(id);
}

export const getTree = (id) => stmt.getTree.get(id);
export const renameTree = (id, title) => { stmt.renameTree.run(title, id); return stmt.getTree.get(id); };
export const listTrees = () => stmt.listTrees.all();

export function createNode({ treeId, parentId = null, question = '', model = null, x = 0, y = 0 }) {
  const node = {
    id: randomUUID(), tree_id: treeId, parent_id: parentId,
    question, model, status: 'draft', x, y, created_at: now(),
  };
  stmt.insNode.run(node);
  return stmt.getNode.get(node.id);
}

export const getNode = (id) => stmt.getNode.get(id);
export const nodesByTree = (treeId) => stmt.nodesByTree.all(treeId);
export const setAnswer = (id, answer, status = 'done') => stmt.setAnswer.run(answer, status, id);
export const setStatus = (id, status) => stmt.setStatus.run(status, id);
export const setPosition = (id, x, y) => stmt.setPos.run(x, y, id);
export const setQuestion = (id, q) => stmt.setQuestion.run(q, id);
export const deleteNode = (id) => stmt.delNode.run(id); // cascades to descendants via FK

// Persist answer + backend meta in one write. meta fields may be undefined (codex stub).
export function setResult(id, { answer, status = 'done', meta = {} }) {
  stmt.setResult.run({
    id, answer, status,
    tokens_in: meta.tokens_in ?? null,
    tokens_out: meta.tokens_out ?? null,
    cost_usd: meta.cost_usd ?? null,
    duration_ms: meta.duration_ms ?? null,
    model: meta.model ?? stmt.getNode.get(id)?.model ?? null,
  });
}

export const setContextMode = (id, mode = 'full', pick = null) =>
  stmt.setContextMode.run(mode, pick == null ? null : JSON.stringify(pick), id);

export const addLink = (nodeId, sourceId) => stmt.addLink.run(nodeId, sourceId);
export const removeLink = (nodeId, sourceId) => stmt.removeLink.run(nodeId, sourceId);
export const getLinks = (nodeId) => stmt.getLinks.all(nodeId).map((r) => r.source_id);

// All links in a tree as { node_id: [source_id, ...] } — lets the client draw persisted dashed edges on load.
export function linksByTree(treeId) {
  const out = {};
  for (const { node_id, source_id } of stmt.linksByTree.all(treeId)) (out[node_id] ||= []).push(source_id);
  return out;
}

// Mark every descendant of `id` (exclusive) as 'stale'; returns the affected ids.
export function markDescendantsStale(id) {
  const ids = [];
  const walk = (pid) => {
    for (const { id: cid } of stmt.childrenOf.all(pid)) {
      ids.push(cid);
      stmt.setStatus.run('stale', cid);
      walk(cid);
    }
  };
  walk(id);
  return ids;
}

// Depth-first: the node followed by all descendants (for subtree export).
export function subtree(id) {
  const out = [];
  const walk = (nid) => {
    const n = stmt.getNode.get(nid);
    if (!n) return;
    out.push(n);
    for (const { id: cid } of stmt.childrenOf.all(nid)) walk(cid);
  };
  walk(id);
  return out;
}

// Walk parent chain to root, return oldest-first (root .. node).
export function getPath(nodeId) {
  const chain = [];
  let cur = stmt.getNode.get(nodeId);
  while (cur) {
    chain.push(cur);
    cur = cur.parent_id ? stmt.getNode.get(cur.parent_id) : null;
  }
  return chain.reverse();
}

export default db;
