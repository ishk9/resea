// Core-claim check: buildPrompt includes exactly the root→node ancestor chain
// and NEVER a sibling's context. If this breaks, the whole design is wrong.
import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
process.env.TREECHAT_DIR = `/tmp/treechat-test-${randomUUID()}`;

const db = await import('./db.js');
const { buildPrompt } = await import('./context.js');

const tree = db.createTree('t');
const root = db.createNode({ treeId: tree.id, question: 'Root Q' });
db.setAnswer(root.id, 'Root A');

const childA = db.createNode({ treeId: tree.id, parentId: root.id, question: 'Branch A Q' });
db.setAnswer(childA.id, 'SECRET-A');
const childB = db.createNode({ treeId: tree.id, parentId: root.id, question: 'Branch B Q' });
db.setAnswer(childB.id, 'SECRET-B');

// Grandchild under A, currently unanswered — the node we'd generate.
const leaf = db.createNode({ treeId: tree.id, parentId: childA.id, question: 'Leaf Q' });

const prompt = buildPrompt(leaf.id);
assert.ok(prompt.includes('Root A'), 'includes root ancestor');
assert.ok(prompt.includes('SECRET-A'), 'includes direct-parent (branch A) answer');
assert.ok(!prompt.includes('SECRET-B'), 'MUST NOT include sibling branch B answer');
assert.ok(prompt.trimEnd().endsWith('Leaf Q'), 'ends with the target question');

// getPath sanity: exactly root -> childA -> leaf
const path = db.getPath(leaf.id).map((n) => n.id);
assert.deepStrictEqual(path, [root.id, childA.id, leaf.id], 'path is the ancestor chain');

console.log('✓ context.test passed — path context is exactly root→node, siblings excluded');
