import { Handle, Position, useStore as useRFStore, type NodeProps } from '@xyflow/react';
import type { TreeNode } from '../lib/api';

export interface ChatNodeData extends Record<string, unknown> {
  node: TreeNode;
  childCount: number;
  onPath: boolean;
  collapsed: boolean;
  onAdd: (parentId: string) => void;
  onToggle: (id: string) => void;
}

const firstLine = (s: string) => s.split('\n')[0];

export function ChatNode({ data, selected }: NodeProps & { data: ChatNodeData }) {
  const { node, childCount, onPath, collapsed, onAdd, onToggle } = data;
  const zoom = useRFStore((s) => s.transform[2]);
  const far = zoom < 0.45; // level-of-detail: drop the answer when zoomed out

  const isRoot = !node.parent_id;
  const cls = ['node', isRoot && 'root', selected && 'selected', onPath && !selected && 'onpath', far && 'far']
    .filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="q">{node.question || 'New question'}</div>
      {!far && (
        <div className={`a${node.answer ? '' : ' empty'}`}>
          {node.answer ? firstLine(node.answer) : node.status === 'streaming' ? 'thinking…' : 'no answer yet'}
        </div>
      )}
      <div className="foot">
        <span className={`dot ${node.status}`} />
        <span>{node.model || 'sonnet'}</span>
        {childCount > 0 && (
          <button
            className="kids"
            title={collapsed ? 'Expand branch' : 'Collapse branch'}
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
          >
            {collapsed ? '▶' : '▽'} {childCount}
          </button>
        )}
      </div>
      <button
        className="add"
        title="Ask a follow-up from here"
        onClick={(e) => { e.stopPropagation(); onAdd(node.id); }}
      >
        +
      </button>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}
