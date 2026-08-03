import { getPath, getLinks, getNode } from './db.js';

const SUMMARY_CAP = 240; // chars of each ancestor answer kept in 'summary' mode

// One "Q:\nA:\n\n" block. In summary mode the answer is truncated (deterministic,
// no extra LLM call — a model-based summarizer is the future upgrade).
function block(n, summarize = false) {
  let out = `Q: ${n.question}\n`;
  if (n.answer) {
    const a = summarize && n.answer.length > SUMMARY_CAP
      ? n.answer.slice(0, SUMMARY_CAP) + ' […]'
      : n.answer;
    out += `A: ${a}\n`;
  }
  return out + '\n';
}

// Build the prompt fed to claude for `nodeId`. Ancestor context is assembled per
// the node's context_mode; node_links sources are ALWAYS prepended regardless of
// mode. Siblings are never included (getPath walks only the parent chain), and the
// target node's own answer is excluded (we're generating it).
//   full    — all ancestors' Q/A (default, original behavior)
//   parent  — direct parent Q/A only
//   summary — ancestor questions in full + each ancestor answer truncated to 240 chars
//   picked  — only ancestors whose id is in context_pick JSON
export function buildPrompt(nodeId) {
  const path = getPath(nodeId); // root .. node
  const target = path[path.length - 1];
  const ancestors = path.slice(0, -1);
  const mode = target.context_mode || 'full';

  let priors;
  if (mode === 'parent') {
    priors = ancestors.slice(-1);
  } else if (mode === 'picked') {
    let pick = [];
    try { pick = JSON.parse(target.context_pick || '[]'); } catch { pick = []; }
    const set = new Set(pick);
    priors = ancestors.filter((n) => set.has(n.id));
  } else {
    priors = ancestors; // 'full' and 'summary' both use every ancestor
  }
  priors = priors.filter((n) => n.question || n.answer);

  // Linked (DAG) sources: extra context beyond the tree parent, always prepended.
  const linked = getLinks(nodeId)
    .map((sid) => getNode(sid))
    .filter((n) => n && (n.question || n.answer));

  let out = '';
  if (linked.length) {
    out += 'Linked context from other branches:\n\n';
    for (const n of linked) out += block(n);
    out += '---\n\n';
  }
  if (priors.length) {
    out += 'You are continuing a threaded research conversation. Prior turns, oldest first:\n\n';
    for (const n of priors) out += block(n, mode === 'summary');
    out += '---\n\n';
  }
  out += target.question || '';
  return out;
}
