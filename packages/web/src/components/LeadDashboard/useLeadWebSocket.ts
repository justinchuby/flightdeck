import { apiFetch } from '../../hooks/useApi';
import { useEffect } from 'react';
import { useLeadStore } from '../../stores/leadStore';
import type { AgentInfo, DagStatus, DecisionStatus } from '../../types';
import { shortAgentId } from '../../utils/agentLabel';
import { normalizeWsText } from '../../hooks/ws-handlers/normalizeText';

type StoreApi = ReturnType<typeof useLeadStore.getState>;

// ── Typed WebSocket message payloads ────────────────────────────

interface WsDecision {
  type: 'lead:decision';
  agentId?: string;
  leadId?: string;
  agentRole?: string;
  id: number;
  title: string;
  rationale: string;
  needsConfirmation: boolean;
  status: string;
}

interface WsAgentText {
  type: 'agent:text';
  agentId: string;
  text: string | { text?: string };
}

interface WsAgentThinking {
  type: 'agent:thinking';
  agentId: string;
  text: string | { text?: string };
}

interface WsAgentContent {
  type: 'agent:content';
  agentId: string;
  content: { text?: string; contentType?: string; mimeType?: string; data?: string; uri?: string };
}

interface WsAgentStatus {
  type: 'agent:status';
  agentId: string;
  status: string;
}

interface WsToolCallPayload {
  toolCallId: string;
  status?: string;
  title?: string | { text?: string };
  kind?: string;
}

interface WsToolCall {
  type: 'agent:tool_call';
  agentId: string;
  toolCall: WsToolCallPayload;
}

interface WsDelegation {
  type: 'agent:delegated';
  parentId?: string;
  childId: string;
  delegation?: { id?: string; toRole?: string; task?: string };
}

interface WsCompletionReported {
  type: 'agent:completion_reported';
  parentId?: string;
  childId: string;
  status?: string;
}

interface WsProgress {
  type: 'lead:progress';
  agentId?: string;
  summary?: string;
  completed?: string[];
  in_progress?: string[];
  blocked?: string[];
}

interface WsMessageSent {
  type: 'agent:message_sent';
  from: string;
  fromRole?: string;
  to: string;
  toRole?: string;
  content?: string;
}

interface WsGroupCreated {
  type: 'group:created';
  leadId: string;
}

interface WsGroupMessage {
  type: 'group:message';
  leadId: string;
  groupName: string;
  message: { fromAgentId: string; fromRole?: string; content?: string };
}

interface WsDagUpdated {
  type: 'dag:updated';
  leadId: string;
}

interface WsContextCompacted {
  type: 'agent:context_compacted';
  agentId?: string;
  percentDrop?: number;
  previousUsed?: number;
  currentUsed?: number;
}

type WsMsg =
  | WsDecision
  | WsAgentText
  | WsAgentThinking
  | WsAgentContent
  | WsAgentStatus
  | WsToolCall
  | WsDelegation
  | WsCompletionReported
  | WsProgress
  | WsMessageSent
  | WsGroupCreated
  | WsGroupMessage
  | WsDagUpdated
  | WsContextCompacted;

// ── Individual message handlers ─────────────────────────────────

function handleDecision(msg: WsDecision, store: StoreApi) {
  if (!msg.agentId) return;
  const targetLeadId = msg.leadId || msg.agentId;
  store.addDecision(targetLeadId, {
    id: String(msg.id),
    agentId: msg.agentId,
    agentRole: msg.agentRole || 'Lead',
    leadId: targetLeadId,
    projectId: null,
    title: msg.title,
    rationale: msg.rationale,
    needsConfirmation: msg.needsConfirmation,
    status: msg.status as DecisionStatus,
    autoApproved: !msg.needsConfirmation,
    confirmedAt: null,
    timestamp: new Date().toISOString(),
    category: 'general' as const,
  });
}

function handleText(msg: WsAgentText, store: StoreApi, storeKey: string) {
  store.appendToLastAgentMessage(storeKey, normalizeWsText(msg.text));
}

function handleThinking(msg: WsAgentThinking, store: StoreApi, storeKey: string) {
  store.appendToThinkingMessage(storeKey, normalizeWsText(msg.text));
}

function handleContent(msg: WsAgentContent, store: StoreApi, storeKey: string) {
  store.addMessage(storeKey, {
    type: 'text',
    text: msg.content.text || '',
    sender: 'agent',
    contentType: msg.content.contentType as 'text' | 'image' | 'audio' | 'resource' | undefined,
    mimeType: msg.content.mimeType,
    data: msg.content.data,
    uri: msg.content.uri,
  });
}

function handleStatus(msg: WsAgentStatus, store: StoreApi, storeKey: string) {
  if (msg.status === 'running') {
    store.promoteQueuedMessages(storeKey);
  }
}

function handleToolCall(msg: WsToolCall, store: StoreApi, agents: AgentInfo[], leadId: string) {
  const { agentId, toolCall } = msg;
  const isChild = agents.some((a) => a.id === agentId && a.parentId === leadId);
  if (agentId !== leadId && !isChild) return;

  const agent = agents.find((a) => a.id === agentId);
  const roleName = agent?.role?.name ?? 'Agent';
  const summary = resolveToolSummary(toolCall);
  store.addActivity(leadId, {
    id: `${toolCall.toolCallId}-${toolCall.status || Date.now()}`,
    agentId,
    agentRole: roleName,
    type: 'tool_call',
    summary,
    status: toolCall.status,
    timestamp: Date.now(),
  });
}

/** Extract a human-readable summary from a tool call's title or kind */
function resolveToolSummary(toolCall: WsToolCallPayload): string {
  if (typeof toolCall.title === 'string') return toolCall.title;
  if (toolCall.title?.text) return toolCall.title.text;
  if (typeof toolCall.kind === 'string') return toolCall.kind;
  return JSON.stringify(toolCall.kind ?? toolCall.title ?? 'Working...');
}

function handleDelegation(msg: WsDelegation, store: StoreApi, agents: AgentInfo[]) {
  if (!msg.parentId) return;
  store.addActivity(msg.parentId, {
    id: msg.delegation?.id || `del-${Date.now()}`,
    agentId: msg.parentId,
    agentRole: 'Project Lead',
    type: 'delegation',
    summary: `Delegated to ${msg.delegation?.toRole}: ${msg.delegation?.task?.slice(0, 80) || ''}`,
    timestamp: Date.now(),
  });
  const childAgent = agents.find((a) => a.id === msg.childId);
  store.addComm(msg.parentId, {
    id: `del-comm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fromId: msg.parentId,
    fromRole: 'Project Lead',
    toId: msg.childId,
    toRole: msg.delegation?.toRole || childAgent?.role?.name || 'Agent',
    content: msg.delegation?.task ?? '',
    timestamp: Date.now(),
    type: 'delegation',
  });
}

function handleCompletionReported(msg: WsCompletionReported, store: StoreApi, agents: AgentInfo[]) {
  if (!msg.parentId) return;
  store.addActivity(msg.parentId, {
    id: `done-${Date.now()}`,
    agentId: msg.childId,
    agentRole: 'Agent',
    type: 'completion',
    summary: `Agent ${shortAgentId(msg.childId)} ${msg.status}`,
    timestamp: Date.now(),
  });
  const childAgent = agents.find((a) => a.id === msg.childId);
  store.addComm(msg.parentId, {
    id: `report-comm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fromId: msg.childId,
    fromRole: childAgent?.role?.name || 'Agent',
    toId: msg.parentId,
    toRole: 'Project Lead',
    content: `Completion: ${msg.status ?? 'done'}`,
    timestamp: Date.now(),
    type: 'report',
  });
}

function handleProgress(msg: WsProgress, store: StoreApi) {
  const leadId = msg.agentId;
  if (!leadId) return;
  if (msg.summary) store.setProgressSummary(leadId, msg.summary);
  store.addProgressSnapshot(leadId, {
    summary: msg.summary || 'Progress update',
    completed: Array.isArray(msg.completed) ? msg.completed : [],
    inProgress: Array.isArray(msg.in_progress) ? msg.in_progress : [],
    blocked: Array.isArray(msg.blocked) ? msg.blocked : [],
    timestamp: Date.now(),
  });
  const parts: string[] = [];
  if (msg.summary) parts.push(msg.summary);
  if (Array.isArray(msg.in_progress) && msg.in_progress.length > 0) {
    parts.push(`In progress: ${msg.in_progress.join(', ')}`);
  }
  if (Array.isArray(msg.blocked) && msg.blocked.length > 0) {
    parts.push(`Blocked: ${msg.blocked.join(', ')}`);
  }
  store.addActivity(leadId, {
    id: `progress-${Date.now()}`,
    agentId: leadId,
    agentRole: 'Project Lead',
    type: 'progress_update',
    summary: parts.join(' · ') || 'Progress update',
    timestamp: Date.now(),
  });
}

function handleMessageSent(msg: WsMessageSent, store: StoreApi, agents: AgentInfo[], leadId: string) {
  const fromAgent = agents.find((a) => a.id === msg.from);
  const toAgent = agents.find((a) => a.id === msg.to);
  const isBroadcast = msg.to === 'all';
  if (!(msg.from === leadId || fromAgent?.parentId === leadId || toAgent?.parentId === leadId || isBroadcast)) return;

  store.addComm(leadId, {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fromId: msg.from,
    fromRole: msg.fromRole || fromAgent?.role?.name || 'Unknown',
    toId: msg.to,
    toRole: isBroadcast ? 'Crew' : (msg.toRole || toAgent?.role?.name || 'Unknown'),
    content: msg.content ?? '',
    timestamp: Date.now(),
    type: isBroadcast ? 'broadcast' : 'message',
  });

  // Store messages sent TO the lead as agent reports
  if (msg.to === leadId && msg.from !== 'system') {
    const senderRole = msg.fromRole || fromAgent?.role?.name || 'Agent';
    store.addAgentReport(leadId, {
      id: `report-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fromRole: senderRole,
      fromId: msg.from,
      content: msg.content ?? '',
      timestamp: Date.now(),
    });
  }

  // Surface DMs in the lead chat panel
  const preview = (msg.content ?? '').slice(0, 2000);
  if (msg.from === 'system' && msg.to === leadId) {
    store.addMessage(leadId, { type: 'text', text: `⚙️ [System] ${preview}`, sender: 'system', timestamp: Date.now() });
  } else if (isBroadcast) {
    // Broadcasts tracked in comms panel — don't duplicate in chat
  } else if (msg.to === leadId) {
    // Agent-to-lead messages tracked in Agent Reports panel — don't duplicate in chat
  } else if (msg.from === leadId) {
    const recipientRole = msg.toRole || toAgent?.role?.name || 'Agent';
    const recipientId = shortAgentId(msg.to ?? '');
    store.addMessage(leadId, { type: 'text', text: `📤 [To ${recipientRole} ${recipientId}] ${preview}`, sender: 'system', timestamp: Date.now() });
  }
  // Inter-agent DMs tracked in comms panel — don't duplicate in chat
}

function handleGroupCreated(store: StoreApi, leadId: string) {
  apiFetch(`/lead/${leadId}/groups`).then((data) => {
    if (Array.isArray(data)) store.setGroups(leadId, data);
  }).catch(() => { /* group fetch failure is non-critical */ });
}

function handleGroupMessage(msg: WsGroupMessage, store: StoreApi, leadId: string) {
  const gm = msg.message;
  const fullMessage = {
    id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    groupName: msg.groupName,
    leadId: msg.leadId || leadId,
    fromAgentId: gm.fromAgentId,
    fromRole: gm.fromRole || 'Agent',
    content: gm.content ?? '',
    reactions: {} as Record<string, string[]>,
    timestamp: new Date().toISOString(),
  };
  store.addGroupMessage(leadId, msg.groupName, fullMessage);
  if (gm) {
    store.addComm(leadId, {
      id: `grp-comm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fromId: gm.fromAgentId,
      fromRole: gm.fromRole || 'Agent',
      toId: '',
      toRole: msg.groupName || 'Group',
      content: gm.content ?? '',
      timestamp: Date.now(),
      type: 'group_message',
    });
  }
}

function handleDagUpdated(store: StoreApi, leadId: string, historicalProjectId: string | null) {
  apiFetch<DagStatus>(`/lead/${leadId}/dag`).then((data) => {
    if (data && data.tasks) {
      store.setDagStatus(leadId, data);
      if (historicalProjectId && historicalProjectId !== leadId) {
        store.setDagStatus(historicalProjectId, data);
      }
    }
  }).catch(() => { /* DAG fetch failure is non-critical */ });
}

function handleContextCompacted(msg: WsContextCompacted, store: StoreApi, agents: AgentInfo[]) {
  const compactedId = msg.agentId;
  if (!compactedId) return;
  let targetLeadId: string | null = null;
  if (store.projects[compactedId]) {
    targetLeadId = compactedId;
  } else {
    const parentAgent = agents.find((a) => a.id === compactedId);
    if (parentAgent?.parentId && store.projects[parentAgent.parentId]) {
      targetLeadId = parentAgent.parentId;
    }
  }
  if (targetLeadId) {
    const pct = msg.percentDrop != null ? `${msg.percentDrop}%` : '?%';
    store.addMessage(targetLeadId, {
      type: 'text',
      text: `🔄 Context compacted for agent ${shortAgentId(compactedId)}: ${pct} reduction`,
      sender: 'system',
      timestamp: Date.now(),
    });
  }
}

// ── Main hook ───────────────────────────────────────────────────

/**
 * Handles all lead-specific WebSocket events: text streaming, decisions,
 * tool calls, delegations, comms, progress, groups, DAG updates, and context compaction.
 */
export function useLeadWebSocket(agents: AgentInfo[], historicalProjectId: string | null) {
  useEffect(() => {
    const handler = (event: Event) => {
      const msg: WsMsg = JSON.parse((event as MessageEvent).data);
      const store = useLeadStore.getState();
      const selectedLeadId = store.selectedLeadId;

      // Resolve project:xxx keys to the actual agent UUID for message matching.
      // selectedLeadId may temporarily be "project:<id>" during session resume
      // (before ProjectLayout resolves the real lead agent). Messages arrive with
      // the real agent UUID, so we need to resolve to match them.
      let effectiveLeadId = selectedLeadId;
      if (selectedLeadId?.startsWith('project:') && agents.length > 0) {
        const projectId = selectedLeadId.slice(8);
        const lead = agents.find((a) => a.projectId === projectId && a.role?.id === 'lead' && a.status !== 'terminated');
        if (lead) effectiveLeadId = lead.id;
      }

      switch (msg.type) {
        case 'lead:decision':
          handleDecision(msg, store);
          break;
        case 'agent:text':
          if (msg.agentId === effectiveLeadId) handleText(msg, store, selectedLeadId!);
          break;
        case 'agent:thinking':
          if (msg.agentId === effectiveLeadId) handleThinking(msg, store, selectedLeadId!);
          break;
        case 'agent:content':
          if (msg.agentId === effectiveLeadId) handleContent(msg, store, selectedLeadId!);
          break;
        case 'agent:status':
          if (msg.agentId === effectiveLeadId) handleStatus(msg, store, selectedLeadId!);
          break;
        case 'agent:tool_call':
          if (effectiveLeadId) handleToolCall(msg, store, agents, effectiveLeadId);
          break;
        case 'agent:delegated':
          handleDelegation(msg, store, agents);
          break;
        case 'agent:completion_reported':
          handleCompletionReported(msg, store, agents);
          break;
        case 'lead:progress':
          handleProgress(msg, store);
          break;
        case 'agent:message_sent':
          if (effectiveLeadId) handleMessageSent(msg, store, agents, effectiveLeadId);
          break;
        case 'group:created':
          if ((msg.leadId === selectedLeadId || msg.leadId === effectiveLeadId) && effectiveLeadId) handleGroupCreated(store, selectedLeadId!);
          break;
        case 'group:message':
          if ((msg.leadId === selectedLeadId || msg.leadId === effectiveLeadId) && effectiveLeadId) handleGroupMessage(msg, store, selectedLeadId!);
          break;
        case 'dag:updated':
          if ((msg.leadId === selectedLeadId || msg.leadId === effectiveLeadId) && effectiveLeadId) handleDagUpdated(store, selectedLeadId!, historicalProjectId);
          break;
        case 'agent:context_compacted':
          handleContextCompacted(msg, store, agents);
          break;
      }
    };
    window.addEventListener('ws-message', handler);
    return () => window.removeEventListener('ws-message', handler);
  }, [agents, historicalProjectId]);
}
