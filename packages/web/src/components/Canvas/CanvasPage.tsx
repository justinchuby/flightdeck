import { useState, useCallback, useRef, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeChange,
  type OnNodesChange,
  applyNodeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useAppStore } from '../../stores/appStore';
import { useLeadStore, type AgentComm } from '../../stores/leadStore';
import { useCanvasLayout } from '../../hooks/useCanvasLayout';
import { useCanvasGraph } from '../../hooks/useCanvasGraph';
import { AgentNode } from './AgentNode';
import { CommEdge } from './CommEdge';
import { CanvasToolbar } from './CanvasToolbar';
import { FocusPanel } from './FocusPanel';

// ── Custom node/edge type maps ─────────────────────────────────────

const nodeTypes = { agent: AgentNode };
const edgeTypes = { comm: CommEdge };

const EMPTY_COMMS: AgentComm[] = [];

// ── Inner component (needs ReactFlowProvider) ──────────────────────

function CanvasInner() {
  const agents = useAppStore((s) => s.agents);
  const selectedLeadId = useLeadStore((s) => s.selectedLeadId);
  const project = useLeadStore((s) =>
    selectedLeadId ? s.projects[selectedLeadId] : null,
  );
  const comms = project?.comms ?? EMPTY_COMMS;

  const [layout, updateLayout] = useCanvasLayout(selectedLeadId);
  const { nodes: graphNodes, edges: graphEdges } = useCanvasGraph(agents, comms, layout);

  // Local state for ReactFlow
  const [nodes, setNodes] = useState<Node[]>(graphNodes);
  const [edges, setEdges] = useState<Edge[]>(graphEdges);
  const [focusedAgent, setFocusedAgent] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showAnimations, setShowAnimations] = useState(true);

  const { fitView, setViewport } = useReactFlow();
  const prevNodesRef = useRef(graphNodes);

  // Sync graph changes from store → local state
  useMemo(() => {
    if (graphNodes !== prevNodesRef.current) {
      prevNodesRef.current = graphNodes;
      setNodes(graphNodes);
      setEdges(graphEdges);
    }
  }, [graphNodes, graphEdges]);

  // Handle node position changes (drag)
  const onNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));

      // Persist position changes
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          updateLayout({
            positions: { [change.id]: change.position },
          });
        }
      }
    },
    [updateLayout],
  );

  // Click node to focus
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setFocusedAgent(node.id);
  }, []);

  // Click background to deselect
  const onPaneClick = useCallback(() => {
    setFocusedAgent(null);
  }, []);

  // Toolbar actions
  const handleAutoLayout = useCallback(() => {
    // Clear saved positions → forces circular recalculation
    updateLayout({ positions: {} });
    setNodes(graphNodes);
    setTimeout(() => fitView({ duration: 400, padding: 0.2 }), 50);
  }, [updateLayout, graphNodes, fitView]);

  const handleFitView = useCallback(() => {
    fitView({ duration: 400, padding: 0.2 });
  }, [fitView]);

  // Empty state
  if (agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8" data-testid="canvas-empty">
        <div className="text-center">
          <div className="text-4xl mb-3">🎯</div>
          <h2 className="text-lg font-semibold text-th-text-alt mb-1">Canvas</h2>
          <p className="text-sm text-th-text-muted max-w-xs">
            Start a session to see agents appear on the spatial canvas.
            Each agent becomes a node; communications become edges.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden" data-testid="canvas-page">
      <div className="flex-1 relative">
        <CanvasToolbar
          onAutoLayout={handleAutoLayout}
          onFitView={handleFitView}
          onToggleLabels={() => setShowLabels(!showLabels)}
          onToggleAnimations={() => setShowAnimations(!showAnimations)}
          showLabels={showLabels}
          showAnimations={showAnimations}
        />

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          className="bg-th-bg"
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} className="!bg-th-bg" />
          <Controls
            showInteractive={false}
            className="!bg-th-bg-alt !border-th-border !rounded-lg !shadow-sm"
          />
        </ReactFlow>
      </div>

      {focusedAgent && (
        <FocusPanel agentId={focusedAgent} onClose={() => setFocusedAgent(null)} />
      )}
    </div>
  );
}

// ── Page wrapper (provides ReactFlow context) ──────────────────────

export function CanvasPage() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
