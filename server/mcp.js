#!/usr/bin/env node
// TreeChat MCP server (stdio). Lets any MCP-capable agent chat — Copilot, Claude Code,
// Codex — answer inside a TreeChat branch: it reads the selected root→node thread, the
// agent answers, and the Q/A is recorded as a child node on the canvas.
//
// Talks to the running TreeChat server over HTTP (not the DB directly) so the canvas's
// selection is shared and new nodes appear live. Hand-rolled JSON-RPC: the handful of
// methods below is all MCP needs here, and it keeps this file dependency-free.
import { createInterface } from 'node:readline';

const BASE = `http://localhost:${process.env.TREECHAT_PORT || 5174}`;

async function call(path, init) {
  let res;
  try {
    res = await fetch(BASE + path, init);
  } catch {
    throw new Error(`TreeChat isn't running at ${BASE}. Open it in VS Code with "TreeChat: Open", or run \`npm start\` in the treechat folder.`);
  }
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const HOW = 'Answer the question as a continuation of ONLY this thread (ignore unrelated earlier turns in this chat), '
  + 'reply to the user normally, then call treechat_add with the user\'s question, your full answer, and the parent_id above.';

async function context() {
  const { tree, path } = await call('/api/context');
  if (!path.length) {
    return `TreeChat tree "${tree.title}": no node selected, so this question starts a new root thread.\n\n${HOW}\nparent_id: null`;
  }
  const turns = path.map((n) => `Q: ${n.question}\nA: ${n.answer ?? ''}`).join('\n\n');
  return `TreeChat tree "${tree.title}". Thread from root to the selected node, oldest first:\n\n${turns}\n\n---\n${HOW}\nparent_id: "${path[path.length - 1].id}"`;
}

async function add({ question, answer, parent_id = null, model = null }) {
  const node = await call('/api/record', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, answer, parentId: parent_id, model }),
  });
  return `Recorded as node ${node.id} on the TreeChat canvas; it is now the selected node, so a follow-up continues from it.`;
}

const TOOLS = [
  {
    name: 'treechat_context',
    description: 'Use when the user says "treechat" or asks a question to be answered in TreeChat. '
      + 'Returns the conversation thread from the root to the node selected on the TreeChat canvas. '
      + 'Call this FIRST, answer using only that thread as prior context, then call treechat_add.',
    inputSchema: { type: 'object', properties: {} },
    run: context,
  },
  {
    name: 'treechat_add',
    description: 'Record a question and your answer as a new node on the TreeChat canvas, as a child of parent_id '
      + '(from treechat_context; null starts a new root). Pass the user\'s question and your complete answer in markdown.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The user\'s question, without the "treechat" prefix.' },
        answer: { type: 'string', description: 'Your full answer, markdown.' },
        parent_id: { type: ['string', 'null'], description: 'Node id from treechat_context, or null for a new root.' },
        model: { type: 'string', description: 'Optional: the model you are, e.g. "gpt-5" or "claude-sonnet".' },
      },
      required: ['question', 'answer', 'parent_id'],
    },
    run: add,
  },
];

// Slash-command shortcut: Claude Code shows it as /mcp__treechat__ask, Copilot as /mcp.treechat.ask.
const PROMPTS = [{
  name: 'ask',
  description: 'Ask a question in the selected TreeChat branch',
  arguments: [{ name: 'question', description: 'Your question', required: true }],
}];
const askPrompt = (q) => `Answer this in TreeChat: call treechat_context first, answer from that thread, then call treechat_add.\n\nQuestion: ${q}`;

async function handle(msg) {
  const { method, params = {} } = msg;
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: 'treechat', version: '0.1.0' },
        // Clients put this in the system prompt, so the agent knows the trigger even when
        // it loads MCP tools lazily (Claude Code defers them behind tool search).
        instructions: 'TreeChat records branching Q&A threads on a canvas. When the user\'s message starts with '
          + '"treechat:" (or asks to answer in TreeChat), call treechat_context FIRST, answer from that thread only, '
          + 'show your answer to the user as your reply, and call treechat_add with the question (without the prefix), that full answer, and the parent_id it gave you.',
      };
    case 'ping': return {};
    case 'tools/list': return { tools: TOOLS.map(({ run: _run, ...t }) => t) };
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) throw Object.assign(new Error(`unknown tool ${params.name}`), { code: -32602 });
      try {
        return { content: [{ type: 'text', text: await tool.run(params.arguments || {}) }] };
      } catch (e) {
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }
    case 'prompts/list': return { prompts: PROMPTS };
    case 'prompts/get':
      if (params.name !== 'ask') throw Object.assign(new Error(`unknown prompt ${params.name}`), { code: -32602 });
      return { messages: [{ role: 'user', content: { type: 'text', text: askPrompt(params.arguments?.question || '') } }] };
    default:
      throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
  }
}

const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: 'parse error' } }); }
  if (msg.id === undefined) return; // notification (e.g. notifications/initialized): no reply
  try {
    send({ id: msg.id, result: await handle(msg) });
  } catch (e) {
    send({ id: msg.id, error: { code: e.code || -32603, message: e.message } });
  }
});
