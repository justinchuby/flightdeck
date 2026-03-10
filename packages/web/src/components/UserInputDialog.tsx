import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { useApi } from '../hooks/useApi';
import type { AgentInfo, AcpUserInputRequest } from '../types';
import { AgentIdBadge } from '../utils/markdown';

export function UserInputDialog() {
  const agents = useAppStore((s) => s.agents);
  const clearUserInput = useAppStore((s) => s.clearUserInput);
  const api = useApi();

  const agentWithInput: AgentInfo | undefined = agents.find((a) => a.pendingUserInput);
  const request: AcpUserInputRequest | undefined = agentWithInput?.pendingUserInput;

  const [response, setResponse] = useState('');

  // Reset state when a new request appears
  useEffect(() => {
    if (request) {
      setResponse('');
    }
  }, [request?.id]);

  const handleSubmit = useCallback(() => {
    if (!agentWithInput || !request || !response.trim()) return;
    api.resolveUserInput(agentWithInput.id, response.trim());
    clearUserInput(agentWithInput.id);
  }, [agentWithInput, request, response, api, clearUserInput]);

  const handleDismiss = useCallback(() => {
    if (!agentWithInput) return;
    // Send a fallback response indicating user dismissed
    api.resolveUserInput(agentWithInput.id, 'User did not respond. Use your best judgement.');
    clearUserInput(agentWithInput.id);
  }, [agentWithInput, api, clearUserInput]);

  if (!agentWithInput || !request) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-raised border border-th-border rounded-xl shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-th-border">
          <MessageSquare size={20} className="text-blue-400" />
          <h2 className="text-base font-semibold text-th-text flex-1">Agent Question</h2>
          <button
            onClick={handleDismiss}
            className="text-th-text-muted hover:text-th-text-alt"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Agent info */}
          <div className="flex items-center gap-2">
            <span className="text-lg">{agentWithInput.role.icon}</span>
            <span className="text-sm font-medium text-th-text-alt">
              {agentWithInput.role.name}
            </span>
            <AgentIdBadge id={agentWithInput.id} />
          </div>

          {/* Question */}
          <div className="text-sm text-th-text bg-th-bg-alt rounded px-4 py-3">
            {request.question}
          </div>

          {/* Input */}
          <textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Type your response..."
            className="w-full px-3 py-2 text-sm rounded-lg bg-th-bg-alt border border-th-border text-th-text placeholder-th-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500/30 resize-none"
            rows={3}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-th-border">
          <span className="text-xs text-th-text-muted">⌘+Enter to send</span>
          <div className="flex items-center gap-3">
            <button
              onClick={handleDismiss}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-th-bg-alt text-th-text-muted border border-th-border hover:bg-th-bg-alt/80 transition-colors"
            >
              Skip
            </button>
            <button
              onClick={handleSubmit}
              disabled={!response.trim()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600/20 text-blue-400 border border-blue-600/30 hover:bg-blue-600/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
