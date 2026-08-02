import { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './Canvas';
import { ChatPanel } from './ChatPanel';
import { useStore } from './store';

const MODELS = ['sonnet', 'opus', 'haiku', 'fable'];

export default function App() {
  const boot = useStore((s) => s.boot);
  const trees = useStore((s) => s.trees);
  const treeId = useStore((s) => s.treeId);
  const openTree = useStore((s) => s.openTree);
  const newTree = useStore((s) => s.newTree);
  const nodeCount = useStore((s) => Object.keys(s.nodes).length);
  const model = useStore((s) => s.model);
  const setModel = useStore((s) => s.setModel);
  const claudeOk = useStore((s) => s.claudeOk);
  const select = useStore((s) => s.select);
  const startRootMode = useStore((s) => s.startRoot);
  const tidy = useStore((s) => s.tidy);

  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => { boot(); }, [boot]);

  const onAdd = useCallback((parentId: string) => {
    select(parentId);
    setFocusTick((t) => t + 1);
  }, [select]);

  const startRoot = useCallback(() => {
    startRootMode();
    setFocusTick((t) => t + 1);
  }, [startRootMode]);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><span className="mark">❯</span> TreeChat</div>
        <select className="control" value={treeId ?? ''} onChange={(e) => openTree(e.target.value)}>
          {trees.map((t) => <option key={t.id} value={t.id}>{t.title || 'Untitled'}</option>)}
        </select>
        <button className="control" onClick={newTree}>+ Tree</button>
        <div className="spacer" />
        {!claudeOk && <span className="offline">claude CLI not found — install &amp; log in</span>}
        <select className="control" value={model} onChange={(e) => setModel(e.target.value)}>
          {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button className="control" onClick={tidy} disabled={!nodeCount}>Tidy</button>
        <button className="control primary" onClick={startRoot}>+ Root</button>
      </div>

      <ReactFlowProvider>
        <Canvas onAdd={onAdd} />
      </ReactFlowProvider>

      {nodeCount === 0 && (
        <div className="empty-canvas">
          <div className="box">
            <div className="title">An empty field.</div>
            <div className="sub">Plant a root question and let it branch.</div>
            <button className="control primary" onClick={startRoot}>+ Root question</button>
          </div>
        </div>
      )}

      <ChatPanel focusTick={focusTick} />
    </div>
  );
}
