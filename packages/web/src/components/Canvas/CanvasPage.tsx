import { useState, useCallback, useMemo, useEffect } from 'react';
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
import { Info } from 'lucide-react';

import { useAppStore } from '../../stores/appStore';
import { useLeadStore, type AgentComm } from '../../stores/leadStore';
import { useCanvasLayout } from '../../hooks/useCanvasLayout';
import { useCanvasGraph } from '../../hooks/useCanvasGraph';
import { useHistoricalAgents } from '../../hooks/useHistoricalAgents';
import { ProjectTabs } from '../ProjectTabs';
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
  const liveAgents = useAppStore((s) => s.agents);
  const selectedLeadId = useLeadStore((s) => s.selectedLeadId);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Resolve tab selection (projectId) to actual agent UUID for agent interactions
  const effectiveLeadId = useMemo(() => {
    const tabId = selectedProjectId ?? selectedLeadId ?? null;
    if (!tabId) return null;
    // Check if tabId matches a live lead's projectId
    const leadByProject = liveAgents.find(
      (a) => a.projectId === tabId && a.role?.id === 'lead' && !a.parentId,
    );
    if (leadByProject) return leadByProject.id;
    return tabId;
  }, [selectedProjectId, selectedLeadId, liveAgents]);

  const project = useLeadStore((s) =>
    effectiveLeadId ? s.projects[effectiveLeadId] : null,
  );
  const comms = project?.comms ?? EMPTY_COMMS;

  // Filter live agents by selected project (lead + its children)
  const projectAgents = useMemo(() => {
    if (!effectiveLeadId || liveAgents.length === 0) return liveAgents;
    return liveAgents.filter(
      (a) => a.id === effectiveLeadId || a.parentId === effectiveLeadId,
    );
  }, [liveAgents, effectiveLeadId]);

  // Historical data fallback: derive agents from keyframes when no live agents
  const { agents: historicalAgents, loading: loadingHistorical } = useHistoricalAgents(projectAgents.length, effectiveLeadId);

  const agents = projectAgents.length > 0 ? projectAgents : (historicalAgents as any[]);

  const [layout, updateLayout] = useCanvasLayout(effectiveLeadId);
  const { nodes: graphNodes, edges: graphEdges } = useCanvasGraph(agents, comms, layout);

  // Local state for ReactFlow
  const [nodes, setNodes] = useState<Node[]>(graphNodes);
  const [edges, setEdges] = useState<Edge[]>(graphEdges);
  const [focusedAgent, setFocusedAgent] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showAnimations, setShowAnimations] = useState(true);

  const { fitView, setViewport } = useReactFlow();

  // Sync graph changes from hook → local state
  useEffect(() => {
    setNodes(graphNodes);
    setEdges(graphEdges);
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

  // Empty state — only when no live agents AND no historical agents
  if (agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8" data-testid="canvas-empty">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-3">🔗</div>
          <h2 className="text-lg font-semibold text-th-text-alt mb-1">Agent Canvas</h2>
          <p className="text-sm text-th-text-muted mb-3">
            {loadingHistorical
              ? 'Loading agent graph from historical data...'
              : 'Agents will appear here as nodes, with connections showing their communication. Thicker edges mean more messages between agents.'}
          </p>
          <p className="text-xs text-th-text-muted">
            Click any agent node to see details, tasks, and messages.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="canvas-page">
      <ProjectTabs
        activeId={effectiveLeadId}
        onChange={setSelectedProjectId}
        className="px-4 pt-2 border-b border-th-border-muted shrink-0"
      />
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
          nodesConnectable={false}
          connectOnClick={false}
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

        {/* Legend */}
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-th-bg-alt/90 border border-th-border/50 text-[10px] text-th-text-muted backdrop-blur-sm">
          <Info size={12} className="shrink-0" />
          <span>{projectAgents.length > 0 ? 'Live visualization — edges show agent messages' : 'Historical view — showing past agent relationships'}</span>
        </div>
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
