import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { activePathIds, useStore } from './store';
import type { TreeNode } from './lib/api';

// Copy / Delete for the node the thread ends on.
function Actions({ node }: { node: TreeNode }) {
  const removeNode = useStore((s) => s.removeNode);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { setConfirming(false); }, [node.id]);

  const copy = async () => {
    await navigator.clipboard.writeText(node.answer || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="actions">
      {node.answer && <button className="link" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>}
      {confirming ? (
        <>
          <button className="link danger" onClick={() => removeNode(node.id)}>Delete this and its branches</button>
          <button className="link" onClick={() => setConfirming(false)}>Cancel</button>
        </>
      ) : (
        <button className="link" onClick={() => setConfirming(true)}>Delete</button>
      )}
    </div>
  );
}

function Turn({ node, last }: { node: TreeNode; last: boolean }) {
  return (
    <article className={`turn${last ? ' last' : ''}`}>
      <h2 className="q">{node.question}</h2>
      <div className="a"><Markdown remarkPlugins={[remarkGfm]}>{node.answer || ''}</Markdown></div>
      {last && (
        <>
          {node.model && <div className="model">{node.model}</div>}
          <Actions node={node} />
        </>
      )}
    </article>
  );
}

export function ChatPanel() {
  const nodes = useStore((s) => s.nodes);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const scroller = useRef<HTMLDivElement>(null);

  const selected = selectedId ? nodes[selectedId] : null;
  const path = selected ? activePathIds(nodes, selectedId).map((id) => nodes[id]) : [];

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [selectedId]);

  return (
    <aside className="panel">
      <header className="panel-head">
        {selected ? (
          <>
            <span className="eyebrow">Thread · {path.length} {path.length === 1 ? 'turn' : 'turns'}</span>
            <span className="spacer" />
            <button className="link" onClick={() => select(null)}>New thread</button>
          </>
        ) : (
          <span className="eyebrow">New thread</span>
        )}
      </header>

      <div className="thread" ref={scroller}>
        {selected ? path.map((n, i) => <Turn key={n.id} node={n} last={i === path.length - 1} />) : (
          <div className="intro">
            <p className="lead">Ask in your agent’s chat.</p>
            <p>Start a message with <code>treechat:</code> in Copilot, Claude Code or Codex. The answer is added here as a node.</p>
            <p>Select any node to branch from it. The agent answers from that node’s line of questions only.</p>
          </div>
        )}
      </div>

      <footer className="panel-foot">
        <span className="dot" />
        {selected
          ? <>Next answer branches from <b>{selected.question}</b></>
          : <>Next answer starts a new thread</>}
      </footer>
    </aside>
  );
}
