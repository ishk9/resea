import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { activePathIds, useStore } from './store';
import { api, type TreeNode } from './lib/api';
import { metaLabel } from './nodes/ChatNode';
import { Dropdown } from './components/Dropdown';

const MODELS = ['sonnet', 'opus', 'haiku', 'fable'].map((m) => ({ value: m, label: m }));
const CONTEXT_MODES = [
  { value: 'full', label: 'full', hint: 'all ancestors' },
  { value: 'parent', label: 'parent', hint: 'direct parent only' },
  { value: 'summary', label: 'summary', hint: 'truncated priors' },
  { value: 'picked', label: 'picked', hint: 'chosen ancestors' },
];
// ctxprob finding: more context is not free — deeper priors can lower accuracy AND confidence.
const CONTEXT_WHY = 'Context strategy: deeper context can hurt — more ancestor priors often lower accuracy and confidence (ctxprob). full=all ancestors, parent=direct parent Q/A, summary=priors truncated to 240 chars, picked=only the ancestors you check below.';

function Turn({ node, here, pick }: { node: TreeNode; here: boolean; pick?: { checked: boolean; onToggle: () => void } }) {
  return (
    <div className={`turn${here ? ' here' : ''}${node.status === 'stale' ? ' stale' : ''}`}>
      <div className="q">
        {pick && (
          <label className="pickbox" title="Include this ancestor in the context">
            <input type="checkbox" checked={pick.checked} onChange={pick.onToggle} />
          </label>
        )}
        {node.question}
      </div>
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

// root→node markdown thread (mirrors server export scope=path) for copy-path.
function pathMarkdown(path: TreeNode[]): string {
  return path.map((n) => `## ${n.question}\n\n${n.answer || ''}`).join('\n\n');
}

function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

// Side-by-side A/B comparison of two answers (two markdown columns).
function Compare({ a, b, onClose }: { a: TreeNode; b: TreeNode; onClose: () => void }) {
  const col = (n: TreeNode) => (
    <div className="ab-col">
      <div className="ab-model">{n.model || 'sonnet'}{metaLabel(n) && <span className="ab-meta"> · {metaLabel(n)}</span>}</div>
      <div className={`a${n.answer ? '' : ' empty'}`}>
        {n.answer ? <Markdown remarkPlugins={[remarkGfm]}>{n.answer}</Markdown>
          : n.status === 'streaming' ? <span className="caret" /> : 'no answer yet'}
      </div>
    </div>
  );
  return (
    <aside className="panel compare">
      <div className="head">
        <span className="label">A/B compare</span>
        <span className="q-line" title={a.question}>{a.question}</span>
        <span className="spacer" />
        <button className="iconbtn x" title="Close compare" onClick={onClose}>✕</button>
      </div>
      <div className="ab-grid">{col(a)}{col(b)}</div>
    </aside>
  );
}

export function ChatPanel({ focusTick }: { focusTick: number }) {
  const nodes = useStore((s) => s.nodes);
  const selectedId = useStore((s) => s.selectedId);
  const rootMode = useStore((s) => s.rootMode);
  const links = useStore((s) => s.links);
  const linkMode = useStore((s) => s.linkMode);
  const compareIds = useStore((s) => s.compareIds);
  const select = useStore((s) => s.select);
  const ask = useStore((s) => s.ask);
  const askAB = useStore((s) => s.askAB);
  const setCompare = useStore((s) => s.setCompare);
  const removeNode = useStore((s) => s.removeNode);
  const stopStream = useStore((s) => s.stopStream);
  const regenerate = useStore((s) => s.regenerate);
  const editQuestion = useStore((s) => s.editQuestion);
  const setContextMode = useStore((s) => s.setContextMode);
  const toggleLinkMode = useStore((s) => s.toggleLinkMode);
  const removeLink = useStore((s) => s.removeLink);

  const [text, setText] = useState('');
  const [editing, setEditing] = useState('');
  const [ab, setAb] = useState(false); // A/B composer open
  const [modelA, setModelA] = useState('sonnet');
  const [modelB, setModelB] = useState('opus');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, [focusTick, selectedId, rootMode]);
  useEffect(() => { setEditing(''); setAb(false); }, [selectedId]); // drop drafts on selection change

  // A/B compare view takes over the panel when a pair is set.
  if (compareIds && nodes[compareIds[0]] && nodes[compareIds[1]]) {
    return <Compare a={nodes[compareIds[0]]} b={nodes[compareIds[1]]} onClose={() => setCompare(null)} />;
  }

  const active = selectedId && nodes[selectedId];
  if (!active && !rootMode) return null;

  const path = active ? activePathIds(nodes, selectedId).map((id) => nodes[id]) : [];
  const selected = active ? nodes[selectedId!] : null;
  const streaming = selected?.status === 'streaming';
  const meta = selected ? metaLabel(selected) : null;
  const mode = selected?.context_mode || 'full';
  const ancestors = selected ? path.slice(0, -1) : []; // path excluding the selected node itself
  const linkedSources = selected ? (links[selected.id] || []) : [];
  // Same-question + DIFFERENT-model sibling ⇒ almost certainly an A/B pair (askAB always
  // uses two distinct models), so offer to re-open compare. Same-model coincidental
  // siblings are excluded to avoid false positives.
  const abSibling = selected
    ? Object.values(nodes).find((n) =>
        n.id !== selected.id && n.parent_id === selected.parent_id &&
        n.question === selected.question && n.model !== selected.model)
    : undefined;

  // 'picked' mode: the set of ancestor ids currently included (parsed from context_pick JSON).
  const picked: string[] = (() => {
    if (!selected?.context_pick) return [];
    try { return JSON.parse(selected.context_pick) as string[]; } catch { return []; }
  })();
  const togglePick = (id: string) => {
    const next = picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id];
    setContextMode(selected!.id, 'picked', next);
  };

  const submit = async () => {
    const q = text.trim();
    if (!q) return;
    setText('');
    if (ab) { setAb(false); await askAB(rootMode ? null : selectedId, q, [modelA, modelB]); return; }
    await ask(rootMode ? null : selectedId, q); // root, or a child of the selected node
  };

  const saveEdit = async () => {
    if (!selectedId) return;
    await editQuestion(selectedId, editing);
    setEditing('');
  };

  return (
    <aside className="panel">
      <div className="head">
        <span className="label">{rootMode ? 'New root' : 'Thread'}</span>
        {!rootMode && <span className="depth">depth {path.length}</span>}
        {!rootMode && meta && <span className="meta-head">{meta}</span>}
        <span className="spacer" />
        {!rootMode && (
          <button className="iconbtn danger" title="Delete this node + its branch"
            onClick={() => removeNode(selectedId!)}>🗑</button>
        )}
        <button className="iconbtn x" title="Close" onClick={() => select(null)}>✕</button>
      </div>

      <div className="thread">
        {rootMode
          ? <div className="turn"><div className="a empty">Where does this exploration begin?</div></div>
          : path.map((n) => (
            <Turn
              key={n.id}
              node={n}
              here={n.id === selectedId}
              pick={mode === 'picked' && n.id !== selectedId
                ? { checked: picked.includes(n.id), onToggle: () => togglePick(n.id) }
                : undefined}
            />
          ))}
      </div>

      {!rootMode && selected && (
        <div className="nodebar">
          {editing ? (
            <>
              <textarea className="editq" value={editing} autoFocus
                onChange={(e) => setEditing(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') setEditing(''); }} />
              <button className="control primary" onClick={saveEdit}>Save + rerun</button>
              <button className="control" onClick={() => setEditing('')}>Cancel</button>
            </>
          ) : (
            <>
              {streaming ? (
                <button className="control" onClick={() => stopStream(selectedId!)}>Stop</button>
              ) : (
                <button className="control" onClick={() => regenerate(selectedId!)}>↻ Regenerate</button>
              )}
              <button className="control" onClick={() => setEditing(selected.question)}>✎ Edit</button>
              <button className="control" title="Copy answer" disabled={!selected.answer}
                onClick={() => selected.answer && navigator.clipboard.writeText(selected.answer)}>Copy answer</button>
              <button className="control" title="Copy full thread"
                onClick={() => navigator.clipboard.writeText(pathMarkdown(path))}>Copy path</button>
              {abSibling && (
                <button className="control" title="Compare with same-question sibling"
                  onClick={() => setCompare([selected.id, abSibling.id])}>⇄ Compare</button>
              )}
              <span className="spacer" />
              <button className="control" title="Export root→node thread"
                onClick={() => download(api.exportUrl(selectedId!, 'path'), `thread-${selectedId}.md`)}>↓ Path</button>
              <button className="control" title="Export node + descendants"
                onClick={() => download(api.exportUrl(selectedId!, 'subtree'), `subtree-${selectedId}.md`)}>↓ Subtree</button>

              {/* Context strategy: how much of the ancestor thread feeds the prompt. */}
              <div className="ctxrow" title={CONTEXT_WHY}>
                <span className="ctxlabel">context ⓘ</span>
                <Dropdown
                  value={mode}
                  options={CONTEXT_MODES}
                  onChange={(m) => setContextMode(selectedId!, m, m === 'picked' ? picked : null)}
                  width={120}
                />
                <button className="control" title="Re-answer this node with the current context strategy"
                  onClick={() => regenerate(selectedId!)}>Re-run</button>
              </div>
              {mode === 'picked' && (
                <span className="ctxhint">Check ancestors above to include them ({picked.length}/{ancestors.length}).</span>
              )}

              {/* DAG context links: pull in answers from other branches. */}
              <div className="ctxrow">
                <button className={`control${linkMode ? ' primary' : ''}`}
                  title="Toggle link mode, then click another node on the canvas to add it as a context source"
                  onClick={toggleLinkMode}>{linkMode ? '● Linking… click a node' : '⛓ Link context'}</button>
              </div>
              {linkedSources.length > 0 && (
                <div className="linklist">
                  {linkedSources.map((sid) => (
                    <span key={sid} className="linkchip" title={nodes[sid]?.question}>
                      {(nodes[sid]?.question || sid).slice(0, 32)}
                      <button className="linkx" title="Remove link" onClick={() => removeLink(selectedId!, sid)}>✕</button>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="composer">
        <textarea
          ref={ref}
          value={text}
          placeholder={rootMode ? 'Ask your root question…' : `Branch from “${(selected!.question || 'this node').slice(0, 40)}”…`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        />
        {ab && (
          <div className="ab-pick">
            <span className="hint">A/B models:</span>
            <Dropdown value={modelA} options={MODELS} onChange={setModelA} width={100} />
            <span className="hint">vs</span>
            <Dropdown value={modelB} options={MODELS} onChange={setModelB} width={100} />
          </div>
        )}
        <div className="row">
          <span className="hint">↵ to {ab ? 'ask both' : rootMode ? 'plant' : 'branch'} · ⇧↵ newline</span>
          <span className="spacer" />
          <button className={`control${ab ? ' primary' : ''}`} title="Ask the same question to two models side-by-side"
            onClick={() => setAb((v) => !v)}>A/B</button>
          <button className="control primary" onClick={submit}>{ab ? 'Ask A/B →' : 'Ask →'}</button>
        </div>
      </div>
    </aside>
  );
}
