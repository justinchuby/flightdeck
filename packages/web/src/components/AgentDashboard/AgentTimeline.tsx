import { useAppStore } from '../../stores/appStore';
import { GitBranch } from 'lucide-react';
import { shortAgentId } from '../../utils/agentLabel';

export function AgentTimeline() {
  const agents = useAppStore((s) => s.agents);

  // Build timeline from agent relationships
  const roots = agents.filter((a) => !a.parentId);
  if (roots.length === 0) return null;

  return (
    <div className="p-4 border-t border-th-border">
      <h3 className="text-sm font-medium text-th-text-muted uppercase tracking-wide mb-3 flex items-center gap-1.5">
        <GitBranch size={14} />
        Agent Hierarchy
      </h3>
      <div className="space-y-1">
        {roots.map((agent) => (
          <AgentTreeNode key={agent.id} agentId={agent.id} depth={0} />
        ))}
      </div>
    </div>
  );
}

function AgentTreeNode({ agentId, depth }: { agentId: string; depth: number }) {
  const agents = useAppStore((s) => s.agents);
  const setSelectedAgent = useAppStore((s) => s.setSelectedAgent);
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return null;

  const isSelected = selectedAgentId === agentId;
  const children = agents.filter((a) => a.parentId === agentId);

  return (
    <div>
      <button
        onClick={() => setSelectedAgent(isSelected ? null : agentId)}
        className={`flex items-center gap-2 w-full text-left px-2 py-1 rounded text-sm transition-colors ${
          isSelected ? 'bg-accent/10 text-accent' : 'hover:bg-th-bg-muted/50 text-th-text-alt'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {children.length > 0 && (
          <GitBranch size={12} className="text-th-text-muted shrink-0" />
        )}
        <span>{agent.role.icon}</span>
        <span className="truncate">{agent.role.name} ({shortAgentId(agentId)})</span>
      </button>
      {children.map((child) => (
        <AgentTreeNode key={child.id} agentId={child.id} depth={depth + 1} />
      ))}
    </div>
  );
}
