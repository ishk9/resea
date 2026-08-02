import { runClaude } from './claude.js';

// Pluggable reasoning backends. Each driver: ({prompt, model}, {onDelta, signal}) => Promise<fullText>.
// The UI's model picker chooses within a driver; a future codex driver plugs in here with no
// changes to routes or the store — same streaming contract.
const drivers = {
  claude: runClaude,
  codex: () => { throw new Error('codex backend not wired yet — use claude'); },
};

// Model alias → driver. Extend when adding a backend (gpt* → codex, everything else → claude).
export function driverFor(model = 'sonnet') {
  return model.startsWith('gpt') ? drivers.codex : drivers.claude;
}

export function run(opts, handlers) {
  return driverFor(opts.model)(opts, handlers);
}
