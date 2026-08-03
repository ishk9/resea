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

// Compact token/cost/timing badge for the node foot.
export function metaLabel(n: TreeNode): string | null {
  const bits: string[] = [];
  if (n.tokens_in != null || n.tokens_out != null) bits.push(`${n.tokens_in ?? 0}↑ ${n.tokens_out ?? 0}↓`);
  if (n.cost_usd != null) bits.push(`$${n.cost_usd.toFixed(4)}`);
  if (n.duration_ms != null) bits.push(`${(n.duration_ms / 1000).toFixed(1)}s`);
  return bits.length ? bits.join(' · ') : null;
}

export function ChatNode({ data, selected }: NodeProps & { data: ChatNodeData }) {
  const { node, childCount, onPath, collapsed, onAdd, onToggle } = data;
  const zoom = useRFStore((s) => s.transform[2]);
  const far = zoom < 0.45; // level-of-detail: drop the answer when zoomed out

  const isRoot = !node.parent_id;
  const cls = ['node', isRoot && 'root', selected && 'selected', onPath && !selected && 'onpath', far && 'far', node.status === 'stale' && 'stale']
    .filter(Boolean).join(' ');
  const meta = metaLabel(node);

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
        {!far && meta && <span className="meta" title="tokens in↑/out↓ · cost · time">{meta}</span>}
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
