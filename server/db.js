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
`);

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
