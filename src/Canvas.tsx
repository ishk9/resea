import { useEffect, useMemo, useRef } from 'react';
import { ReactFlow, Background, BackgroundVariant, useReactFlow, type Edge, type Node } from '@xyflow/react';
import { ChatNode, type ChatNodeData } from './nodes/ChatNode';
import { layoutTree, NODE_H, NODE_W } from './lib/layout';
import { activePathIds, useStore } from './store';

const nodeTypes = { chat: ChatNode };

// Keyed by tree id in App, so `fitView` runs fresh whenever a tree is opened.
export function Canvas() {
  const nodes = useStore((s) => s.nodes);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const { setCenter, getZoom } = useReactFlow();

  const list = useMemo(() => Object.values(nodes), [nodes]);
  const pos = useMemo(() => layoutTree(list), [list]);
  const path = useMemo(() => new Set(activePathIds(nodes, selectedId)), [nodes, selectedId]);

  const rfNodes: Node<ChatNodeData>[] = list.map((n) => ({
    id: n.id,
    type: 'chat',
    position: pos[n.id],
    data: { node: n, onPath: path.has(n.id), selected: n.id === selectedId },
  }));
  const rfEdges: Edge[] = list.filter((n) => n.parent_id).map((n) => ({
    id: `${n.parent_id}->${n.id}`,
    source: n.parent_id!,
    target: n.id,
    type: 'smoothstep',
    className: path.has(n.id) ? 'path' : undefined,
    zIndex: path.has(n.id) ? 1 : 0,
  }));

  // A new node was just asked: glide the camera to it, keeping the current zoom.
  const count = useRef(list.length);
  useEffect(() => {
    const grew = list.length > count.current;
    count.current = list.length;
    const p = selectedId && pos[selectedId];
    if (grew && p) setCenter(p.x + NODE_W / 2, p.y + NODE_H / 2, { zoom: getZoom(), duration: 400 });
  }, [list.length, selectedId, pos, setCenter, getZoom]);

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      onNodeClick={(_, n) => select(n.id)}
      onPaneClick={() => select(null)}
      minZoom={0.2}
      maxZoom={1.5}
      fitView
      fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--grid)" />
    </ReactFlow>
  );
}
