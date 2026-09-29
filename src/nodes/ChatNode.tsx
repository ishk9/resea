import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TreeNode } from '../lib/api';

export interface ChatNodeData extends Record<string, unknown> {
  node: TreeNode;
  onPath: boolean;
  selected: boolean;
}

// Markdown noise stripped so the card preview reads as plain prose.
const preview = (s: string) => s.replace(/[#*_`>]+/g, '').replace(/\s+/g, ' ').trim();

export function ChatNode({ data }: NodeProps & { data: ChatNodeData }) {
  const { node, onPath, selected } = data;
  const cls = ['node', selected && 'selected', onPath && 'onpath'].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="q"><span className="prompt">❯</span>{node.question}</div>
      <div className="a">{preview(node.answer || '')}</div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}
