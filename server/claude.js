import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

// Drive the local `claude` CLI headless, stateless. Prompt goes via stdin (10MB
// cap, keeps big context off argv). Streams text deltas; resolves with full text.
//
// Notes:
// - No --bare: it forces ANTHROPIC_API_KEY and skips OAuth, breaking subscription
//   auth. We run from tmpdir instead so no project CLAUDE.md is auto-discovered.
// - --no-session-persistence keeps every call stateless (we own the context).
// - --exclude-dynamic-system-prompt-sections improves prompt-cache reuse across
//   the many small calls this app makes.
export function runClaude({ prompt, model = 'sonnet', system, cwd = tmpdir() }, { onDelta, signal } = {}) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--no-session-persistence',
    '--exclude-dynamic-system-prompt-sections',
    '--model', model,
  ];
  if (system) args.push('--append-system-prompt', system);

  const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  signal?.addEventListener('abort', () => child.kill('SIGTERM'));

  child.stdin.write(prompt);
  child.stdin.end();

  return new Promise((resolve, reject) => {
    let buf = '';
    let full = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }

        if (ev.type === 'stream_event' &&
            ev.event?.type === 'content_block_delta' &&
            ev.event.delta?.type === 'text_delta') {
          const t = ev.event.delta.text;
          full += t;
          onDelta?.(t);
        } else if (ev.type === 'result') {
          if (ev.is_error || ev.subtype !== 'success') {
            reject(new Error(ev.result || ev.subtype || 'claude error'));
          } else {
            // Prefer the authoritative result text; fall back to accumulated deltas.
            resolve(ev.result ?? full);
          }
        }
      }
    });

    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !full) reject(new Error(stderr || `claude exited ${code}`));
    });
  });
}
