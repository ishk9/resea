import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './Canvas';
import { ChatPanel } from './ChatPanel';
import { Dropdown } from './components/Dropdown';
import { useStore } from './store';

export default function App() {
  const boot = useStore((s) => s.boot);
  const trees = useStore((s) => s.trees);
  const treeId = useStore((s) => s.treeId);
  const openTree = useStore((s) => s.openTree);
  const newTree = useStore((s) => s.newTree);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  useEffect(() => { boot(); }, [boot]);

  return (
    <div className="app">
      <main className="stage">
        <header className="bar">
          <span className="brand"><span className="prompt">❯</span>treechat</span>
          <Dropdown
            value={treeId}
            options={trees.map((t) => ({ value: t.id, label: t.title || 'Untitled' }))}
            onChange={openTree}
            width={220}
            placeholder="No trees"
          />
          <button className="btn" onClick={newTree}>New tree</button>
          <span className="spacer" />
          <button className="btn icon" onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
            {theme === 'dark' ? (
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="3" />
                <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />
              </svg>
            )}
          </button>
        </header>
        <ReactFlowProvider>
          <Canvas key={treeId ?? 'none'} />
        </ReactFlowProvider>
      </main>
      <ChatPanel />
    </div>
  );
}
