// packages/web/src/components/Settings/telegram/BindChallengeFlow.tsx
// Inline challenge-response flow for binding a chat to a project.

import { useState, useCallback, useEffect, useRef } from 'react';
import { Loader2, AlertCircle, Check } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { VerificationCodeInput } from './VerificationCodeInput';

interface BindChallengeFlowProps {
  chatId: string;
  projects: Array<{ id: string; name?: string }>;
  onBound: (projectId: string) => void;
  onCancel: () => void;
}

type FlowState = 'select-project' | 'waiting-for-code' | 'verifying' | 'success' | 'error';

export function BindChallengeFlow({ chatId, projects, onBound, onCancel }: BindChallengeFlowProps) {
  const [selectedProject, setSelectedProject] = useState(projects[0]?.id || '');
  const [flowState, setFlowState] = useState<FlowState>('select-project');
  const [error, setError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState(false);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeLeft, setTimeLeft] = useState('');

  // Countdown timer
  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, expiresAt.getTime() - Date.now());
      if (remaining <= 0) {
        setError('Code expired.');
        setFlowState('error');
        clearInterval(interval);
        return;
      }
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      setTimeLeft(`${minutes}:${String(seconds).padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const handleSendChallenge = useCallback(async () => {
    if (!selectedProject) return;
    setFlowState('verifying');
    setError(null);

    try {
      const result = await apiFetch<{ status: string; expiresAt: string }>('/integrations/sessions', {
        method: 'POST',
        body: JSON.stringify({
          chatId,
          platform: 'telegram',
          projectId: selectedProject,
        }),
      });

      setExpiresAt(new Date(result.expiresAt));
      setFlowState('waiting-for-code');
    } catch (err) {
      setError((err as Error).message);
      setFlowState('error');
    }
  }, [chatId, selectedProject]);

  const handleVerifyCode = useCallback(async (code: string) => {
    setFlowState('verifying');
    setCodeError(false);
    setError(null);

    try {
      await apiFetch('/integrations/sessions/verify', {
        method: 'POST',
        body: JSON.stringify({ chatId, code }),
      });

      setFlowState('success');
      setTimeout(() => onBound(selectedProject), 1000);
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('429') || message.includes('rate')) {
        setError('Too many attempts — please wait 1 minute.');
        setFlowState('error');
      } else {
        setCodeError(true);
        setError('Invalid code — check Telegram and try again.');
        setFlowState('waiting-for-code');
      }
    }
  }, [chatId, selectedProject, onBound]);

  const handleResend = useCallback(() => {
    setError(null);
    setCodeError(false);
    handleSendChallenge();
  }, [handleSendChallenge]);

  if (flowState === 'select-project') {
    return (
      <div className="bg-th-bg-alt border border-th-border rounded-md p-3 space-y-3" data-testid="telegram-bind-flow">
        <div className="text-xs text-th-text-alt">
          Select a project to bind to this chat:
        </div>
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          className="w-full bg-th-bg-alt border border-th-border rounded px-2 py-1.5 text-sm"
          data-testid="telegram-project-select"
        >
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name || p.id}</option>
          ))}
        </select>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-th-text-muted hover:text-th-text rounded-md hover:bg-th-bg-alt transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSendChallenge}
            disabled={!selectedProject}
            className="px-3 py-1.5 text-xs bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors disabled:opacity-50"
            data-testid="telegram-send-challenge"
          >
            Send Challenge
          </button>
        </div>
      </div>
    );
  }

  if (flowState === 'verifying') {
    return (
      <div className="bg-th-bg-alt border border-th-border rounded-md p-3 flex items-center justify-center gap-2" data-testid="telegram-bind-flow">
        <Loader2 className="w-4 h-4 animate-spin text-accent" />
        <span className="text-xs text-th-text-muted">Verifying…</span>
      </div>
    );
  }

  if (flowState === 'success') {
    return (
      <div className="bg-green-400/10 border border-green-400/30 rounded-md p-3 flex items-center gap-2" data-testid="telegram-bind-flow">
        <Check className="w-4 h-4 text-green-400" />
        <span className="text-xs text-green-400 font-medium">Bound to {selectedProject}</span>
      </div>
    );
  }

  if (flowState === 'error' && !expiresAt) {
    return (
      <div className="bg-red-400/10 border border-red-400/30 rounded-md p-3 space-y-2" data-testid="telegram-bind-flow">
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-th-text-muted hover:text-th-text rounded-md">
            Cancel
          </button>
          <button onClick={handleResend} className="px-3 py-1.5 text-xs bg-accent/10 text-accent rounded-md hover:bg-accent/20">
            Send New Code
          </button>
        </div>
      </div>
    );
  }

  // waiting-for-code state
  return (
    <div className="bg-th-bg-alt border border-th-border rounded-md p-3 space-y-3" data-testid="telegram-bind-flow">
      <div className="text-xs text-th-text-alt">
        📱 A 6-digit code was sent to this chat.
      </div>

      <div>
        <div className="text-xs text-th-text-muted mb-2">Verification code:</div>
        <VerificationCodeInput
          onComplete={handleVerifyCode}
          error={codeError}
        />
      </div>

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-400" role="alert">
          <AlertCircle className="w-3 h-3" />
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-th-text-muted">
          ⏱️ Expires in {timeLeft}
        </span>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-th-text-muted hover:text-th-text rounded-md"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
