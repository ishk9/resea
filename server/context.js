import { getPath } from './db.js';

// Build the prompt fed to claude for `nodeId`: every ancestor Q/A (oldest first),
// then this node's question. The node itself must already exist with its question
// set; its answer is empty (we're generating it). Siblings are never included —
// getPath only walks the parent chain.
export function buildPrompt(nodeId) {
  const path = getPath(nodeId); // root .. node
  const priors = path.slice(0, -1).filter((n) => n.question || n.answer);
  const target = path[path.length - 1];

  let out = '';
  if (priors.length) {
    out += 'You are continuing a threaded research conversation. Prior turns, oldest first:\n\n';
    for (const n of priors) {
      out += `Q: ${n.question}\n`;
      if (n.answer) out += `A: ${n.answer}\n`;
      out += '\n';
    }
    out += '---\n\n';
  }
  out += target.question || '';
  return out;
}
