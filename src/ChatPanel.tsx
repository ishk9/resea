import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { activePathIds, useStore } from './store';
import type { TreeNode } from './lib/api';

function Turn({ node, here }: { node: TreeNode; here: boolean }) {
  return (
    <div className={`turn${here ? ' here' : ''}`}>
      <div className="q">{node.question}</div>
      <div className={`a${node.answer ? '' : ' empty'}`}>
        {node.answer ? (
          <Markdown remarkPlugins={[remarkGfm]}>{node.answer}</Markdown>
        ) : node.status === 'streaming' ? (
          <span className="caret" />
        ) : node.status === 'error' ? (
          'failed'
        ) : (
          'no answer yet'
        )}
        {node.answer && node.status === 'streaming' && <span className="caret" />}
      </div>
    </div>
  );
}

export function ChatPanel({ focusTick }: { focusTick: number }) {
  const nodes = useStore((s) => s.nodes);
  const selectedId = useStore((s) => s.selectedId);
  const rootMode = useStore((s) => s.rootMode);
  const select = useStore((s) => s.select);
  const ask = useStore((s) => s.ask);
  const removeNode = useStore((s) => s.removeNode);

  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, [focusTick, selectedId, rootMode]);

  const active = selectedId && nodes[selectedId];
  if (!active && !rootMode) return null;

  const path = active ? activePathIds(nodes, selectedId).map((id) => nodes[id]) : [];
  const selected = active ? nodes[selectedId!] : null;

  const submit = async () => {
    const q = text.trim();
    if (!q) return;
    setText('');
    await ask(rootMode ? null : selectedId, q); // root, or a child of the selected node
  };

  return (
    <aside className="panel">
      <div className="head">
        <span className="label">{rootMode ? 'New root' : 'Thread'}</span>
        {!rootMode && <span className="depth">depth {path.length}</span>}
        {!rootMode && (
          <button className="iconbtn danger" title="Delete this node + its branch"
            onClick={() => removeNode(selectedId!)}>🗑</button>
        )}
        <button className="iconbtn x" title="Close" onClick={() => select(null)}>✕</button>
      </div>

      <div className="thread">
        {rootMode
          ? <div className="turn"><div className="a empty">Where does this exploration begin?</div></div>
          : path.map((n) => <Turn key={n.id} node={n} here={n.id === selectedId} />)}
      </div>

      <div className="composer">
        <textarea
          ref={ref}
          value={text}
          placeholder={rootMode ? 'Ask your root question…' : `Branch from “${(selected!.question || 'this node').slice(0, 40)}”…`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        />
        <div className="row">
          <span className="hint">↵ to {rootMode ? 'plant' : 'branch'} · ⇧↵ newline</span>
          <span className="spacer" />
          <button className="control primary" onClick={submit}>Ask →</button>
        </div>
      </div>
    </aside>
  );
}
