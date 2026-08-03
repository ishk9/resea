import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap, BackgroundVariant,
  useNodesState, useEdgesState, useReactFlow, type Edge, type Node, type Viewport,
} from '@xyflow/react';
import { ChatNode, type ChatNodeData } from './nodes/ChatNode';
import { activePathIds, hiddenIds, useStore } from './store';

const nodeTypes = { chat: ChatNode };
const vpKey = (treeId: string) => `treechat:vp:${treeId}`;

export function Canvas({ onAdd }: { onAdd: (parentId: string) => void }) {
  const nodes = useStore((s) => s.nodes);
  const treeId = useStore((s) => s.treeId);
  const selectedId = useStore((s) => s.selectedId);
  const collapsed = useStore((s) => s.collapsed);
  const links = useStore((s) => s.links);
  const linkMode = useStore((s) => s.linkMode);
  const select = useStore((s) => s.select);
  const moveNode = useStore((s) => s.moveNode);
  const toggleCollapse = useStore((s) => s.toggleCollapse);
  const addLink = useStore((s) => s.addLink);
  const { setViewport } = useReactFlow();

  const pathIds = useMemo(() => new Set(activePathIds(nodes, selectedId)), [nodes, selectedId]);
  const hidden = useMemo(() => hiddenIds(nodes, collapsed), [nodes, collapsed]);
  const childCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of Object.values(nodes)) if (n.parent_id) c[n.parent_id] = (c[n.parent_id] || 0) + 1;
    return c;
  }, [nodes]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node<ChatNodeData>>([]);
  const [rfEdges, setRfEdges] = useEdgesState<Edge>([]);

  useEffect(() => {
    setRfNodes(
      Object.values(nodes)
        .filter((n) => !hidden.has(n.id))
        .map((n) => ({
          id: n.id,
          type: 'chat',
          position: { x: n.x, y: n.y },
          selected: n.id === selectedId,
          data: {
            node: n,
            childCount: childCounts[n.id] || 0,
            onPath: pathIds.has(n.id),
            collapsed: !!collapsed[n.id],
            onAdd,
            onToggle: toggleCollapse,
          },
        })),
    );
    const treeEdges: Edge[] = Object.values(nodes)
      .filter((n) => n.parent_id && !hidden.has(n.id) && !hidden.has(n.parent_id!))
      .map((n) => ({
        id: `${n.parent_id}->${n.id}`,
        source: n.parent_id!,
        target: n.id,
        type: 'smoothstep',
        className: pathIds.has(n.id) && pathIds.has(n.parent_id!) ? 'path' : undefined,
      }));
    // DAG context links: dashed, distinctly-colored (cyan, not amber) edges from source → node.
    const linkEdges: Edge[] = Object.entries(links).flatMap(([nodeId, sources]) =>
      (sources || [])
        .filter((sid) => nodes[nodeId] && nodes[sid] && !hidden.has(nodeId) && !hidden.has(sid))
        .map((sid) => ({
          id: `link:${sid}->${nodeId}`,
          source: sid,
          target: nodeId,
          type: 'default',
          className: 'link',
          zIndex: 0,
        })),
    );
    setRfEdges([...treeEdges, ...linkEdges]);
  }, [nodes, selectedId, pathIds, hidden, collapsed, childCounts, links, onAdd, toggleCollapse, setRfNodes, setRfEdges]);

  // Viewport persistence: restore on tree switch, save on move. Prior-art's #1 complaint.
  useEffect(() => {
    if (!treeId) return;
    const saved = localStorage.getItem(vpKey(treeId));
    if (saved) { try { setViewport(JSON.parse(saved)); } catch { /* ignore */ } }
  }, [treeId, setViewport]);

  const onMoveEnd = useCallback((_: unknown, vp: Viewport) => {
    if (treeId) localStorage.setItem(vpKey(treeId), JSON.stringify(vp));
  }, [treeId]);

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={(_, n) => moveNode(n.id, n.position.x, n.position.y)}
      onNodeClick={(_, n) => {
        // In link mode a click adds that node as a context source for the currently-selected node.
        if (linkMode && selectedId && n.id !== selectedId) addLink(selectedId, n.id);
        else select(n.id);
      }}
      onPaneClick={() => select(null)}
      className={linkMode ? 'linking' : undefined}
      onMoveEnd={onMoveEnd}
      minZoom={0.2}
      maxZoom={1.75}
      fitView
      fitViewOptions={{ padding: 0.4, maxZoom: 1 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={26} size={1.5} color="var(--grid)" />
      <Controls showInteractive={false} />
      <MiniMap
        pannable zoomable
        nodeColor={(n) => (pathIds.has(n.id) ? 'var(--amber-dim)' : 'var(--line)')}
        maskColor="rgba(14,20,32,0.7)"
      />
    </ReactFlow>
  );
}
