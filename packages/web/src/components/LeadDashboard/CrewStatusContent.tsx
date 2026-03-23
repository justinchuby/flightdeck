import { useState } from 'react';
import { MessageSquare, Send, Zap, Square } from 'lucide-react';
import type { AgentComm, ActivityEvent } from '../../stores/leadStore';
import type { AgentInfo, Delegation } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { MentionText } from '../../utils/markdown';
import { agentStatusText } from '../../utils/statusColors';
import { shortAgentId } from '../../utils/agentLabel';
import { apiFetch } from '../../hooks/useApi';
import { useToastStore } from '../Toast';
import { AgentReportBlock } from './AgentReportBlock';
import { ProviderBadge } from '../ProviderBadge';
import { formatTokens, formatTime } from '../../utils/format';

/** Minimal agent shape accepted by CrewStatusContent — compatible with AgentInfo, LeadProgress.crewAgents, and DerivedAgent */
export interface CrewAgent {
  id: string;
  role: { name: string; icon: string; model?: string };
  status: string;
  model?: string;
  provider?: string;
  sessionId?: string | null;
  outputPreview?: string;
  contextWindowSize?: number;
  contextWindowUsed?: number;
}

interface CrewStatusContentProps {
  agents: CrewAgent[];
  delegations: Delegation[];
  comms?: AgentComm[];
  activity?: ActivityEvent[];
  allAgents?: AgentInfo[];
  onOpenChat?: (agentId: string) => void;
}

export function CrewStatusContent({ agents, delegations, comms, activity, allAgents: _allAgents, onOpenChat }: CrewStatusContentProps) {
  const [selectedAgent, setSelectedAgent] = useState<CrewAgent | null>(null);
  const [selectedComm, setSelectedComm] = useState<AgentComm | null>(null);
  const [agentMsg, setAgentMsg] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  const selectedDelegation = selectedAgent ? [...delegations].reverse().find((d) => d.toAgentId === selectedAgent.id) : null;
  const agentComms = selectedAgent ? (comms ?? []).filter((c) => c.fromId === selectedAgent.id || c.toId === selectedAgent.id) : [];
  const agentActivity = selectedAgent ? (activity ?? []).filter((e) => e.agentId === selectedAgent.id) : [];

  /** Send a message to the selected agent or interrupt it */
  const sendMessage = async (mode: 'queue' | 'interrupt') => {
    if (!selectedAgent) return;
    if (!agentMsg.trim()) {
      // Ctrl+Enter with no text = just interrupt
      if (mode === 'interrupt') {
        apiFetch(`/agents/${selectedAgent.id}/interrupt`, { method: 'POST' }).then(() => {
          useToastStore.getState().add('success', `Interrupted ${selectedAgent.role.name}`);
        }).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          useToastStore.getState().add('error', `Failed to interrupt: ${message}`);
        });
      }
      return;
    }
    setSendingMsg(true);
    try {
      await apiFetch(`/agents/${selectedAgent.id}/message`, {
        method: 'POST',
        body: JSON.stringify({ text: agentMsg.trim(), mode }),
      });
      setAgentMsg('');
      const label = mode === 'interrupt' ? 'Interrupt' : 'Message';
      useToastStore.getState().add('success', `${label} sent to ${selectedAgent.role.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      useToastStore.getState().add('error', `Failed to send: ${msg}`);
    } finally {
      setSendingMsg(false);
    }
  };

  return (
    <>
      <div className="h-full overflow-y-auto p-1.5 space-y-1">
        {agents.length === 0 ? (
          <p className="text-xs text-th-text-muted text-center py-4 font-mono">No crew members yet</p>
        ) : (
          agents.map((agent) => {
            const delegation = [...delegations].reverse().find((d) => d.toAgentId === agent.id);
            const colorClass = agentStatusText(agent.status);
            return (
              <div
                key={agent.id}
                className="bg-th-bg-alt border border-th-border rounded p-1.5 cursor-pointer hover:border-th-border-hover transition-colors"
                onClick={() => { setSelectedAgent(agent); setAgentMsg(''); setSendingMsg(false); }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm leading-none">{agent.role.icon}</span>
                  <span className="text-xs font-mono font-semibold text-th-text-alt truncate" title={agent.role.name}>{agent.role.name}</span>
                  <span className={`text-[10px] font-mono ${colorClass} ml-auto shrink-0`}>{agent.status}</span>
                  {onOpenChat && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onOpenChat(agent.id); }}
                      className="flex items-center gap-0.5 text-[10px] font-mono leading-none px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 transition-colors shrink-0"
                      title="Open agent chat panel"
                    >
                      <MessageSquare size={10} /> Chat
                    </button>
                  )}
                  <span className="text-[10px] font-mono text-th-text-muted shrink-0">{shortAgentId(agent.id)}</span>
                </div>
                {delegation && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <p className="text-[10px] font-mono text-th-text-muted truncate flex-1 min-w-0" title={delegation.task}>{delegation.task}</p>
                    <ProviderBadge provider={agent.provider} />
                    {(agent.model) && (
                      <span className="text-[9px] font-mono text-th-text-muted bg-th-bg-muted/50 px-1 rounded shrink-0">{agent.model}</span>
                    )}
                  </div>
                )}
                {!delegation && (agent.model || agent.provider) && (
                  <div className="flex items-center justify-end gap-1.5 mt-0.5">
                    <ProviderBadge provider={agent.provider} />
                    {(agent.model) && (
                      <span className="text-[9px] font-mono text-th-text-muted bg-th-bg-muted/50 px-1 rounded shrink-0">{agent.model}</span>
                    )}
                  </div>
                )}
                {(() => {
                  const latestAct = (activity ?? []).filter((e) => e.agentId === agent.id).slice(-1)[0];
                  if (!latestAct) return null;
                  const actTime = formatTime(latestAct.timestamp);
                  return (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[9px] text-th-text-muted">{actTime}</span>
                      <span className="text-[10px] text-th-text-muted truncate" title={latestAct.summary}>{latestAct.summary}</span>
                    </div>
                  );
                })()}
              </div>
            );
          })
        )}
      </div>

      {/* Agent detail modal */}
      {selectedAgent && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedAgent(null); }}
        >
          <div
            className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-th-border">
              <span className="text-2xl">{selectedAgent.role.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-th-text">{selectedAgent.role.name}</span>
                  <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${agentStatusText(selectedAgent.status)} bg-th-bg-muted`}>
                    {selectedAgent.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-th-text-muted font-mono">
                  <span>{shortAgentId(selectedAgent.id)}</span>
                  <ProviderBadge provider={selectedAgent.provider} size="md" />
                  {(selectedAgent.model || selectedAgent.role.model) && (
                    <span className="bg-th-bg-muted/50 px-1.5 rounded">{selectedAgent.model || selectedAgent.role.model}</span>
                  )}
                </div>
                {selectedAgent.sessionId && (
                  <button
                    className="mt-1 text-[10px] font-mono text-th-text-muted bg-th-bg-muted/50 px-1.5 py-0.5 rounded hover:bg-th-bg-muted transition-colors block truncate max-w-full"
                    title={`Session: ${selectedAgent.sessionId} — click to copy`}
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(selectedAgent.sessionId!); }}
                  >
                    Session: {selectedAgent.sessionId}
                  </button>
                )}
              </div>
              {(selectedAgent.status === 'running' || selectedAgent.status === 'idle') && (
                <div className="flex items-center gap-1 mr-2">
                  <button
                    onClick={() => apiFetch(`/agents/${selectedAgent.id}/interrupt`, { method: 'POST' })}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-orange-600/20 text-orange-400 hover:bg-orange-600/40 transition-colors"
                    title="Interrupt agent"
                  >
                    <Zap size={12} /> Interrupt
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Stop this agent?')) {
                        apiFetch(`/agents/${selectedAgent.id}`, { method: 'DELETE' });
                        setSelectedAgent(null);
                      }
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-red-600/20 text-red-400 hover:bg-red-600/40 transition-colors"
                    title="Stop agent"
                  >
                    <Square size={12} /> Stop
                  </button>
                </div>
              )}
              <button
                onClick={() => setSelectedAgent(null)}
                className="text-th-text-muted hover:text-th-text text-lg leading-none p-1"
              >
                ×
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Assigned Task */}
              {selectedDelegation && (
                <div className="px-5 py-3 border-b border-th-border">
                  <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Assigned Task</h4>
                  <p className="text-sm font-mono text-th-text-alt whitespace-pre-wrap">{selectedDelegation.task}</p>
                  {selectedDelegation.status && (
                    <span className={`inline-block mt-1 text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      selectedDelegation.status === 'completed' ? 'text-purple-400 bg-purple-900/30' :
                      selectedDelegation.status === 'active' ? 'text-blue-400 bg-blue-900/30' :
                      'text-red-400 bg-red-900/30'
                    }`}>{selectedDelegation.status}</span>
                  )}
                </div>
              )}

              {/* Token Usage — hidden (issue #106) */}

              {/* Context Window — keep this, it's real data from ACP */}
              {(selectedAgent.contextWindowSize ?? 0) > 0 && (() => {
                const used = selectedAgent.contextWindowUsed ?? 0;
                const size = selectedAgent.contextWindowSize ?? 1;
                const pct = Math.round((used / size) * 100);
                return (
                <div className="px-5 py-3 border-b border-th-border">
                  <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Context Window</h4>
                  <div className="mt-1.5">
                    <div className="flex items-center gap-2 text-[10px] font-mono text-th-text-muted">
                      <span>Context: {formatTokens(used)} / {formatTokens(size)}</span>
                      <span>({pct}%)</span>
                    </div>
                    <div className="w-full bg-th-bg-muted rounded-full h-1 mt-1">
                      <div
                        className={`h-1 rounded-full transition-all ${
                          pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                  </div>
                </div>
                );
              })()}

              {/* Agent Output Preview */}
              {selectedAgent.outputPreview && (
                <div className="px-5 py-3 border-b border-th-border">
                  <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Latest Output</h4>
                  <pre className="text-xs font-mono text-th-text-alt whitespace-pre-wrap max-h-40 overflow-y-auto bg-th-bg/50 rounded p-2">
                    {selectedAgent.outputPreview}
                  </pre>
                </div>
              )}

              {/* Communications */}
              {agentComms.length > 0 && (
                <div className="px-5 py-3 border-b border-th-border">
                  <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-2">
                    Communications ({agentComms.length})
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {agentComms.slice(-20).map((c) => {
                      const time = formatTime(c.timestamp);
                      const isSender = c.fromId === selectedAgent.id;
                      return (
                        <div
                          key={c.id}
                          className="text-xs font-mono cursor-pointer hover:bg-th-bg-muted/40 rounded px-1 py-0.5 transition-colors"
                          onClick={() => setSelectedComm(c)}
                        >
                          <div className="flex items-center gap-1">
                            <span className={isSender ? 'text-cyan-400' : 'text-green-400'}>{isSender ? c.fromRole : c.toRole}</span>
                            <span className="text-th-text-muted">{isSender ? '→' : '←'}</span>
                            <span className={isSender ? 'text-green-400' : 'text-cyan-400'}>{isSender ? c.toRole : c.fromRole}</span>
                            <span className="text-th-text-muted ml-auto">{time}</span>
                          </div>
                          <p className="text-th-text-alt mt-0.5 break-words whitespace-pre-wrap">
                            <MentionText text={c.content.length > 200 ? c.content.slice(0, 200) + '…' : c.content} agents={useAppStore.getState().agents} onClickAgent={(id) => useAppStore.getState().setSelectedAgent(id)} />
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Activity */}
              {agentActivity.length > 0 && (
                <div className="px-5 py-3">
                  <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-2">
                    Activity ({agentActivity.length})
                  </h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {agentActivity.slice(-15).map((evt) => {
                      const time = formatTime(evt.timestamp);
                      return (
                        <div key={evt.id} className="flex items-center gap-2 text-xs font-mono">
                          <span className="text-th-text-muted">{time}</span>
                          <span className="text-th-text-alt truncate" title={evt.summary}>{evt.summary}</span>
                          {evt.status && (
                            <span className={`ml-auto shrink-0 text-[10px] ${
                              evt.status === 'completed' ? 'text-purple-400' :
                              evt.status === 'in_progress' ? 'text-blue-400' : 'text-th-text-muted'
                            }`}>{evt.status}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {!selectedDelegation && !selectedAgent.outputPreview && agentComms.length === 0 && agentActivity.length === 0 && (
                <div className="px-5 py-8 text-center text-th-text-muted text-xs font-mono">
                  No activity yet for this agent
                </div>
              )}
            </div>

            {/* Message Input */}
            <div className="px-4 py-3 border-t border-th-border">
              <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1.5">Send Message</h4>
              <div className="flex gap-2">
                <textarea
                  value={agentMsg}
                  onChange={(e) => setAgentMsg(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                      e.preventDefault();
                      if (agentMsg.trim() && !sendingMsg) sendMessage('queue');
                    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      sendMessage('interrupt');
                    }
                  }}
                  placeholder={`Message ${selectedAgent.role.name}...`}
                  className="flex-1 bg-th-bg border border-th-border rounded px-2 py-1.5 text-xs font-mono text-th-text resize-none focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                  rows={2}
                  disabled={sendingMsg}
                />
                <div className="flex flex-col gap-1 self-end shrink-0">
                  <button
                    onClick={() => { if (agentMsg.trim() && !sendingMsg) sendMessage('queue'); }}
                    disabled={!agentMsg.trim() || sendingMsg}
                    className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium flex items-center gap-1 transition-colors"
                    title="Send message (Enter)"
                  >
                    <Send size={12} /> {sendingMsg ? 'Sending…' : 'Send'}
                  </button>
                  <button
                    onClick={() => { if (!sendingMsg) sendMessage('interrupt'); }}
                    disabled={sendingMsg}
                    className="px-3 py-1.5 rounded bg-orange-600/80 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium flex items-center gap-1 transition-colors"
                    title="Interrupt agent (Ctrl+Enter)"
                  >
                    <Zap size={12} /> Interrupt
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-th-text-muted mt-1">Enter to send · Shift+Enter for newline · Ctrl+Enter to interrupt</p>
            </div>

          </div>
        </div>
      )}

      {/* Comm detail popup */}
      {selectedComm && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedComm(null); }}
        >
          <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-th-border">
              <div className="flex items-center gap-2 text-sm">
                <MessageSquare className="w-4 h-4 text-blue-400" />
                <span className="font-mono font-semibold text-cyan-400">{selectedComm.fromRole}</span>
                <span className="text-th-text-muted">→</span>
                <span className="font-mono font-semibold text-green-400">{selectedComm.toRole}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-th-text-muted">
                  {formatTime(selectedComm.timestamp)}
                </span>
                <button type="button" aria-label="Close communication detail" onClick={() => setSelectedComm(null)} className="text-th-text-muted hover:text-th-text text-lg leading-none">×</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {selectedComm.content.startsWith('[Agent Report]') || selectedComm.content.startsWith('[Agent ACK]')
                ? <AgentReportBlock content={selectedComm.content} />
                : (
                  <pre className="text-sm font-mono text-th-text-alt whitespace-pre-wrap break-words leading-relaxed">
                    <MentionText text={selectedComm.content} agents={useAppStore.getState().agents} onClickAgent={(id) => { useAppStore.getState().setSelectedAgent(id); setSelectedComm(null); }} />
                  </pre>
                )
              }
            </div>
          </div>
        </div>
      )}
    </>
  );
}
