import { useEffect } from 'react';
import { useLeadStore } from '../../stores/leadStore';
import type { AgentInfo, DagStatus } from '../../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type WsMsg = Record<string, any>;
type StoreApi = ReturnType<typeof useLeadStore.getState>;

// ── Individual message handlers ─────────────────────────────────

function handleDecision(msg: WsMsg, store: StoreApi) {
  if (!msg.agentId) return;
  const targetLeadId = msg.leadId || msg.agentId;
  store.addDecision(targetLeadId, { ...msg, agentRole: msg.agentRole || 'Lead' } as any);
}

function handleText(msg: WsMsg, store: StoreApi) {
  const rawText = typeof msg.text === 'string' ? msg.text : msg.text?.text ?? JSON.stringify(msg.text);
  store.appendToLastAgentMessage(msg.agentId, rawText);
}

function handleThinking(msg: WsMsg, store: StoreApi) {
  const rawText = typeof msg.text === 'string' ? msg.text : msg.text?.text ?? JSON.stringify(msg.text);
  store.appendToThinkingMessage(msg.agentId, rawText);
}

function handleContent(msg: WsMsg, store: StoreApi) {
  store.addMessage(msg.agentId, {
    type: 'text',
    text: msg.content.text || '',
    sender: 'agent',
    contentType: msg.content.contentType,
    mimeType: msg.content.mimeType,
    data: msg.content.data,
    uri: msg.content.uri,
  });
}

function handleStatus(msg: WsMsg, store: StoreApi) {
  if (msg.status === 'running') {
    store.promoteQueuedMessages(msg.agentId);
  }
}

function handleToolCall(msg: WsMsg, store: StoreApi, agents: AgentInfo[], leadId: string) {
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
function resolveToolSummary(toolCall: WsMsg): string {
  if (typeof toolCall.title === 'string') return toolCall.title;
  if (toolCall.title?.text) return toolCall.title.text;
  if (typeof toolCall.kind === 'string') return toolCall.kind;
  return JSON.stringify(toolCall.kind ?? toolCall.title ?? 'Working...');
}

function handleDelegation(msg: WsMsg, store: StoreApi, agents: AgentInfo[]) {
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

function handleCompletionReported(msg: WsMsg, store: StoreApi, agents: AgentInfo[]) {
  if (!msg.parentId) return;
  store.addActivity(msg.parentId, {
    id: `done-${Date.now()}`,
    agentId: msg.childId,
    agentRole: 'Agent',
    type: 'completion',
    summary: `Agent ${msg.childId?.slice(0, 8)} ${msg.status}`,
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

function handleProgress(msg: WsMsg, store: StoreApi) {
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
    type: 'progress',
    summary: parts.join(' · ') || 'Progress update',
    timestamp: Date.now(),
  });
}

function handleMessageSent(msg: WsMsg, store: StoreApi, agents: AgentInfo[], leadId: string) {
  const fromAgent = agents.find((a) => a.id === msg.from);
  const toAgent = agents.find((a) => a.id === msg.to);
  const isBroadcast = msg.to === 'all';
  if (!(msg.from === leadId || fromAgent?.parentId === leadId || toAgent?.parentId === leadId || isBroadcast)) return;

  store.addComm(leadId, {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fromId: msg.from,
    fromRole: msg.fromRole || fromAgent?.role?.name || 'Unknown',
    toId: msg.to,
    toRole: isBroadcast ? 'Team' : (msg.toRole || toAgent?.role?.name || 'Unknown'),
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
  const senderRole = msg.fromRole || fromAgent?.role?.name || 'Agent';
  const senderId = (msg.from ?? '').slice(0, 8);
  if (msg.from === 'system') {
    store.addMessage(leadId, { type: 'text', text: `⚙️ [System] ${preview}`, sender: 'system', timestamp: Date.now() });
  } else if (isBroadcast) {
    // Broadcasts tracked in comms panel — don't duplicate in chat
  } else if (msg.to === leadId) {
    store.addMessage(leadId, { type: 'text', text: `📨 [From ${senderRole} ${senderId}] ${preview}`, sender: 'system', timestamp: Date.now() });
  } else if (msg.from === leadId) {
    const recipientRole = msg.toRole || toAgent?.role?.name || 'Agent';
    const recipientId = (msg.to ?? '').slice(0, 8);
    store.addMessage(leadId, { type: 'text', text: `📤 [To ${recipientRole} ${recipientId}] ${preview}`, sender: 'system', timestamp: Date.now() });
  }
  // Inter-agent DMs tracked in comms panel — don't duplicate in chat
}

function handleGroupCreated(store: StoreApi, leadId: string) {
  fetch(`/api/lead/${leadId}/groups`).then((r) => r.json()).then((data) => {
    if (Array.isArray(data)) store.setGroups(leadId, data);
  }).catch(() => { /* group fetch failure is non-critical */ });
}

function handleGroupMessage(msg: WsMsg, store: StoreApi, leadId: string) {
  store.addGroupMessage(leadId, msg.groupName, msg.message);
  if (msg.message) {
    const gm = msg.message;
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
  fetch(`/api/lead/${leadId}/dag`).then((r) => r.json()).then((data: DagStatus) => {
    if (data && data.tasks) {
      store.setDagStatus(leadId, data);
      if (historicalProjectId && historicalProjectId !== leadId) {
        store.setDagStatus(historicalProjectId, data);
      }
    }
  }).catch(() => { /* DAG fetch failure is non-critical */ });
}

function handleContextCompacted(msg: WsMsg, store: StoreApi, agents: AgentInfo[]) {
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
      text: `🔄 Context compacted for agent ${compactedId.slice(0, 8)}: ${pct} reduction`,
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

      switch (msg.type) {
        case 'lead:decision':
          handleDecision(msg, store);
          break;
        case 'agent:text':
          if (msg.agentId === selectedLeadId) handleText(msg, store);
          break;
        case 'agent:thinking':
          if (msg.agentId === selectedLeadId) handleThinking(msg, store);
          break;
        case 'agent:content':
          if (msg.agentId === selectedLeadId) handleContent(msg, store);
          break;
        case 'agent:status':
          if (msg.agentId === selectedLeadId) handleStatus(msg, store);
          break;
        case 'agent:tool_call':
          if (selectedLeadId) handleToolCall(msg, store, agents, selectedLeadId);
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
          if (selectedLeadId) handleMessageSent(msg, store, agents, selectedLeadId);
          break;
        case 'group:created':
          if (msg.leadId === selectedLeadId && selectedLeadId) handleGroupCreated(store, selectedLeadId);
          break;
        case 'group:message':
          if (msg.leadId === selectedLeadId && selectedLeadId) handleGroupMessage(msg, store, selectedLeadId);
          break;
        case 'dag:updated':
          if (msg.leadId === selectedLeadId && selectedLeadId) handleDagUpdated(store, selectedLeadId, historicalProjectId);
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
