import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './Canvas';
import { ChatPanel } from './ChatPanel';
import { Dropdown } from './components/Dropdown';
import { useStore } from './store';

const MODELS = ['sonnet', 'opus', 'haiku', 'fable'].map((m) => ({ value: m, label: m }));

export default function App() {
  const boot = useStore((s) => s.boot);
  const trees = useStore((s) => s.trees);
  const treeId = useStore((s) => s.treeId);
  const openTree = useStore((s) => s.openTree);
  const newTree = useStore((s) => s.newTree);
  const renameTree = useStore((s) => s.renameTree);
  const nodeCount = useStore((s) => Object.keys(s.nodes).length);
  const model = useStore((s) => s.model);
  const setModel = useStore((s) => s.setModel);
  const claudeOk = useStore((s) => s.claudeOk);
  const select = useStore((s) => s.select);
  const startRootMode = useStore((s) => s.startRoot);
  const tidy = useStore((s) => s.tidy);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  const [focusTick, setFocusTick] = useState(0);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { boot(); }, [boot]);
  useEffect(() => { if (editingTitle) titleRef.current?.select(); }, [editingTitle]);

  const onAdd = useCallback((parentId: string) => {
    select(parentId);
    setFocusTick((t) => t + 1);
  }, [select]);

  const startRoot = useCallback(() => {
    startRootMode();
    setFocusTick((t) => t + 1);
  }, [startRootMode]);

  const currentTree = trees.find((t) => t.id === treeId);
  const beginEdit = () => { setDraftTitle(currentTree?.title || ''); setEditingTitle(true); };
  const commitEdit = () => {
    if (treeId) renameTree(treeId, draftTitle);
    setEditingTitle(false);
  };

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><span className="mark">❯</span> TreeChat</div>
        {editingTitle ? (
          <input
            ref={titleRef}
            className="control title-edit"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingTitle(false); }}
            onBlur={commitEdit}
          />
        ) : (
          <Dropdown
            value={treeId}
            options={trees.map((t) => ({ value: t.id, label: t.title || 'Untitled' }))}
            onChange={openTree}
            width={220}
            placeholder="No trees"
          />
        )}
        <button className="iconbtn" title="Rename tree" onClick={editingTitle ? commitEdit : beginEdit}>
          {editingTitle ? '✓' : '✎'}
        </button>
        <button className="control" onClick={newTree}>+ Tree</button>
        <div className="spacer" />
        {!claudeOk && <span className="offline">claude CLI not found — install &amp; log in</span>}
        <button className="control" title="Toggle light / dark" onClick={toggleTheme}>{theme === 'dark' ? '☀' : '☾'}</button>
        <Dropdown value={model} options={MODELS} onChange={setModel} width={110} />
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
