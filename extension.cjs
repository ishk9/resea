const vscode = require('vscode');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

// TreeChat inside VS Code. The existing server runs under the system `node` (better-sqlite3
// is built for it, not for VS Code's Electron) and the built UI loads in a webview iframe.
// Fixed port keeps the iframe origin stable, so localStorage (theme, viewport) survives restarts.
const PORT = 5174;
const BASE = `http://localhost:${PORT}`;

let server; // child we spawned; stays undefined when reusing an already-running `npm start`
let panel;
let out;

const healthy = () => fetch(`${BASE}/api/health`).then((r) => r.ok, () => false);

async function ensureServer(root) {
  if (await healthy()) return;
  let spawnErr;
  server = spawn('node', [join(root, 'server', 'index.js')], { env: { ...process.env, PORT: String(PORT) } });
  server.stdout.on('data', (d) => out.append(d.toString()));
  server.stderr.on('data', (d) => out.append(d.toString()));
  server.on('error', (e) => { spawnErr = e; });
  server.on('exit', () => { server = undefined; });
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (spawnErr) throw new Error(`could not start node: ${spawnErr.message}`);
    if (await healthy()) return;
  }
  throw new Error(`server did not come up on ${BASE}`);
}

const html = (url) => `<!DOCTYPE html>
<html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src ${new URL(url).origin};">
<style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100%;overflow:hidden}</style>
</head><body><iframe src="${url}" allow="clipboard-read; clipboard-write"></iframe></body></html>`;

async function open(root) {
  if (panel) return panel.reveal();
  if (!existsSync(join(root, 'dist', 'index.html'))) {
    return vscode.window.showErrorMessage(`TreeChat: frontend not built. Run \`npm run build\` in ${root}.`);
  }
  try {
    await ensureServer(root);
  } catch (e) {
    out.show();
    return vscode.window.showErrorMessage(`TreeChat: ${e.message}`);
  }
  // Maps localhost through to the client when running over Remote-SSH/WSL/Codespaces.
  const url = (await vscode.env.asExternalUri(vscode.Uri.parse(BASE))).toString();
  panel = vscode.window.createWebviewPanel('treechat', 'TreeChat', vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true, // keep canvas state (camera, selection) when the tab is hidden
  });
  panel.webview.html = html(url);
  panel.onDidDispose(() => { panel = undefined; });
}

// Agents answer through server/mcp.js. Copilot picks it up from VS Code; Claude Code and
// Codex register it once through their own CLIs.
async function connectAgents(mcp) {
  const cmds = [
    { label: 'Claude Code', detail: `claude mcp add treechat -s user -- node ${JSON.stringify(mcp)}` },
    { label: 'Codex', detail: `codex mcp add treechat -- node ${JSON.stringify(mcp)}` },
    { label: 'Cursor agent', detail: JSON.stringify({ treechat: { command: 'node', args: [mcp] } }),
      description: 'add under "mcpServers" in ~/.cursor/mcp.json' },
  ];
  const pick = await vscode.window.showQuickPick(cmds, {
    title: 'Copy the setup for your agent. Copilot in VS Code is already connected.',
  });
  if (!pick) return;
  await vscode.env.clipboard.writeText(pick.detail);
  vscode.window.showInformationMessage(`Copied. Apply it (terminal for CLIs, mcp.json for Cursor), then start a new ${pick.label} chat.`);
}

function activate(ctx) {
  const mcp = join(ctx.extensionPath, 'server', 'mcp.js');
  out = vscode.window.createOutputChannel('TreeChat');
  ctx.subscriptions.push(
    out,
    vscode.commands.registerCommand('treechat.open', () => open(ctx.extensionPath)),
    vscode.commands.registerCommand('treechat.connect', () => connectAgents(mcp)),
  );
  // VS Code 1.101+; forks without the MCP API (older Cursor builds) still get the canvas.
  if (vscode.lm?.registerMcpServerDefinitionProvider) {
    ctx.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider('treechat', {
      provideMcpServerDefinitions: () => [new vscode.McpStdioServerDefinition('TreeChat', 'node', [mcp])],
    }));
  }
}

function deactivate() {
  server?.kill();
}

module.exports = { activate, deactivate };
