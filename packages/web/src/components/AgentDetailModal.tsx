import { useState } from 'react';
import { Zap, Square, Send, AlertTriangle, ExternalLink } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { apiFetch } from '../hooks/useApi';
import { useToastStore } from './Toast';
import { agentStatusText } from '../utils/statusColors';
import { formatTokens } from '../utils/format';

export interface AgentDetailModalProps {
  agentId: string;
  onClose: () => void;
}

export function AgentDetailModal({ agentId, onClose }: AgentDetailModalProps) {
  const agent = useAppStore((s) => s.agents.find((a) => a.id === agentId));
  const [agentMsg, setAgentMsg] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  if (!agent) return null;

  const sendMessage = async (mode: 'queue' | 'interrupt') => {
    if (!agentMsg.trim()) {
      if (mode === 'interrupt') {
        apiFetch(`/agents/${agent.id}/interrupt`, { method: 'POST' }).then(() => {
          useToastStore.getState().add('success', `Interrupted ${agent.role.name}`);
        }).catch((err: Error) => {
          useToastStore.getState().add('error', `Failed to interrupt: ${err.message}`);
        });
      }
      return;
    }
    setSendingMsg(true);
    try {
      await apiFetch(`/agents/${agent.id}/message`, {
        method: 'POST',
        body: JSON.stringify({ text: agentMsg.trim(), mode }),
      });
      setAgentMsg('');
      const label = mode === 'interrupt' ? 'Interrupt' : 'Message';
      useToastStore.getState().add('success', `${label} sent to ${agent.role.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      useToastStore.getState().add('error', `Failed to send: ${msg}`);
    } finally {
      setSendingMsg(false);
    }
  };

  const totalTokens = (agent.inputTokens ?? 0) + (agent.outputTokens ?? 0)
    + (agent.cacheReadTokens ?? 0) + (agent.cacheWriteTokens ?? 0);

  const isAgentFailed = agent.status === 'failed' || agent.status === 'terminated';

  const openGitHubIssue = () => {
    const title = `Agent failure: ${agent.role.name} ${agent.provider ?? 'unknown'} ${agent.model} - exit code ${agent.exitCode ?? 'unknown'}`;

    const bodyParts = [
      '## Agent Failure Report',
      '',
      '| Field | Value |',
      '|-------|-------|',
      `| **Agent ID** | \`${agent.id}\` |`,
      `| **Role** | ${agent.role.name} |`,
      `| **Provider** | ${agent.provider ?? 'N/A'} |`,
      `| **Model** | ${agent.model} |`,
      `| **Exit Code** | ${agent.exitCode ?? 'N/A'} |`,
      `| **Session ID** | \`${agent.sessionId ?? 'N/A'}\` |`,
      '',
    ];

    if (agent.task) {
      bodyParts.push('## Task', '', agent.task, '');
    }

    if (agent.exitError) {
      bodyParts.push('## Error Output', '', '```', agent.exitError, '```', '');
    }

    bodyParts.push(
      '## Environment',
      '',
      `- **Timestamp**: ${new Date().toISOString()}`,
      `- **Agent Status**: ${agent.status}`,
    );

    const body = bodyParts.join('\n');
    const params = new URLSearchParams({ title, body, labels: 'bug,agent-failure' });
    window.open(`https://github.com/justinchuby/flightdeck/issues/new?${params.toString()}`, '_blank');
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-th-border">
          <span className="text-2xl">{agent.role.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-th-text">{agent.role.name}</span>
              <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${agentStatusText(agent.status)} bg-th-bg-muted`}>
                {agent.status}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-th-text-muted font-mono flex-wrap">
              <span title={agent.id}>{agent.id.slice(0, 8)}</span>
              {agent.provider && (
                <span className="bg-blue-500/15 text-blue-400 px-1.5 rounded">{agent.provider}</span>
              )}
              {agent.model && (
                agent.modelTranslated && agent.requestedModel ? (
                  <span className="bg-th-bg-muted/50 px-1.5 rounded" title={agent.modelResolutionReason}>
                    <span className="line-through text-th-text-muted/60">{agent.requestedModel}</span>
                    {' → '}
                    <span className="text-yellow-400">{agent.resolvedModel ?? agent.model}</span>
                  </span>
                ) : (
                  <span className="bg-th-bg-muted/50 px-1.5 rounded">{agent.model}</span>
                )
              )}
            </div>
            {agent.sessionId && (
              <button
                className="mt-1 text-[10px] font-mono text-th-text-muted bg-th-bg-muted/50 px-1.5 py-0.5 rounded hover:bg-th-bg-muted transition-colors block truncate max-w-full"
                title={`Click to copy session ID: ${agent.sessionId}`}
                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(agent.sessionId!); }}
              >
                Session: {agent.sessionId}
              </button>
            )}
          </div>
          {(agent.status === 'running' || agent.status === 'idle') && (
            <div className="flex items-center gap-1 mr-2">
              <button
                onClick={() => apiFetch(`/agents/${agent.id}/interrupt`, { method: 'POST' })}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-orange-600/20 text-orange-400 hover:bg-orange-600/40 transition-colors"
                title="Interrupt agent"
              >
                <Zap size={12} /> Interrupt
              </button>
              <button
                onClick={() => {
                  if (confirm('Stop this agent?')) {
                    apiFetch(`/agents/${agent.id}/terminate`, { method: 'POST' });
                    onClose();
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
            onClick={onClose}
            className="text-th-text-muted hover:text-th-text text-lg leading-none p-1"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Agent Failed Banner */}
          {isAgentFailed && (agent.exitError || agent.exitCode !== undefined) && (
            <div className="mx-4 mt-3 rounded-lg border border-red-500/40 bg-red-500/10 overflow-hidden">
              <div className="flex items-start gap-3 px-4 py-3">
                <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-red-400">Agent Failed</h4>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-red-300/80">
                    {agent.exitCode != null && (
                      <span>Exit code: <span className="text-red-400 font-semibold">{agent.exitCode}</span></span>
                    )}
                    {agent.provider && (
                      <span>Provider: <span className="text-red-400">{agent.provider}</span></span>
                    )}
                    {agent.model && (
                      <span>Model: <span className="text-red-400">{agent.model}</span></span>
                    )}
                  </div>
                  {agent.exitError && (
                    <pre className="mt-2 text-xs font-mono text-red-400/90 whitespace-pre-wrap break-words bg-red-900/20 rounded p-2 max-h-40 overflow-y-auto">
                      {agent.exitError}
                    </pre>
                  )}
                </div>
              </div>
              <div className="px-4 pb-3 flex justify-end">
                <button
                  onClick={openGitHubIssue}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-red-600/30 text-red-300 hover:bg-red-600/50 hover:text-red-200 transition-colors border border-red-500/30"
                >
                  <ExternalLink size={12} />
                  Submit GitHub Issue
                </button>
              </div>
            </div>
          )}
          {/* Current Task */}
          {agent.task && (
            <div className="px-5 py-3 border-b border-th-border">
              <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Current Task</h4>
              <p className="text-sm font-mono text-th-text-alt whitespace-pre-wrap">{agent.task}</p>
            </div>
          )}

          {/* Token Usage */}
          {totalTokens > 0 && (
            <div className="px-5 py-3 border-b border-th-border">
              <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Token Usage</h4>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono text-th-text-alt">
                <span>Input: {formatTokens(agent.inputTokens)}</span>
                <span>Output: {formatTokens(agent.outputTokens)}</span>
                <span>Cache Read: {formatTokens(agent.cacheReadTokens)}</span>
                <span>Cache Write: {formatTokens(agent.cacheWriteTokens)}</span>
              </div>
              <div className="mt-1 text-xs font-mono text-th-text-muted">
                Total: {formatTokens(totalTokens)}
              </div>
            </div>
          )}

          {/* Context Window */}
          {(agent.contextWindowSize ?? 0) > 0 && (() => {
            const used = agent.contextWindowUsed ?? 0;
            const size = agent.contextWindowSize ?? 1;
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

          {/* Latest Output */}
          {agent.outputPreview && (
            <div className="px-5 py-3 border-b border-th-border">
              <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Latest Output</h4>
              <pre className="text-xs font-mono text-th-text-alt whitespace-pre-wrap max-h-40 overflow-y-auto bg-th-bg/50 rounded p-2">
                {agent.outputPreview}
              </pre>
            </div>
          )}

          {/* Exit Error (shown inline when banner is not visible, e.g. creating status with error) */}
          {agent.exitError && !isAgentFailed && (
            <div className="px-5 py-3 border-b border-th-border">
              <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-1">Exit Error</h4>
              <div className="text-xs font-mono text-red-400 whitespace-pre-wrap bg-red-900/20 border border-red-800/40 rounded p-2">
                {agent.exitError}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!agent.task && totalTokens === 0 && !agent.outputPreview && !agent.exitError && (
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
              placeholder={`Message ${agent.role.name}...`}
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
  );
}

export default AgentDetailModal;
