import { useState, useEffect } from 'react';
import {
  RefreshCw,
  AlertTriangle,
  Clock,
  User,
  Settings,
  Activity,
  X,
  Zap,
  MessageSquare,
  Square,
  Send,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { getRoleIcon } from '../../utils/getRoleIcon';
import { useToastStore } from '../Toast';
import { Tabs } from '../ui/Tabs';
import type { TabItem } from '../ui/Tabs';
import { useModels, deriveModelName } from '../../hooks/useModels';
import type { AgentProfile } from './types';
import { statusBadge } from './utils';

type ProfileTab = 'overview' | 'history' | 'settings';

export function ProfilePanel({ agentId, crewId, onClose }: { agentId: string; crewId: string; onClose: () => void }) {
  const addToast = useToastStore(s => s.add);
  const { models: availableModels } = useModels();
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');
  const [confirmStop, setConfirmStop] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [showMessageInput, setShowMessageInput] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiFetch<AgentProfile>(`/crews/${crewId}/agents/${agentId}/profile`)
      .then(data => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [agentId, crewId]);

  const isAlive = profile?.liveStatus === 'running' || profile?.liveStatus === 'creating' || profile?.liveStatus === 'idle';

  const handleInterrupt = async () => {
    setActionLoading('interrupt');
    try {
      await apiFetch(`/agents/${agentId}/interrupt`, { method: 'POST' });
      addToast('success', 'Interrupt sent');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast('error', `Failed to interrupt agent: ${message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendMessage = async () => {
    if (!messageText.trim()) return;
    setActionLoading('message');
    try {
      await apiFetch(`/agents/${agentId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: messageText.trim() }),
      });
      addToast('success', 'Message sent');
      setMessageText('');
      setShowMessageInput(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast('error', `Failed to send message: ${message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async () => {
    setActionLoading('stop');
    try {
      await apiFetch(`/agents/${agentId}/terminate`, { method: 'POST' });
      addToast('success', 'Agent terminated');
      setConfirmStop(false);
      const data = await apiFetch<AgentProfile>(`/crews/${crewId}/agents/${agentId}/profile`);
      setProfile(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast('error', `Failed to stop agent: ${message}`);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-th-text-alt">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
        Loading profile…
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex items-center justify-center h-48 text-red-400">
        <AlertTriangle className="w-4 h-4 mr-2" />
        Profile not found
      </div>
    );
  }

  const badge = statusBadge(profile.status, profile.liveStatus);
  const tabs: TabItem[] = [
    { id: 'overview', label: 'Overview', icon: <User className="w-3.5 h-3.5" /> },
    { id: 'history', label: 'History', icon: <Clock className="w-3.5 h-3.5" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="bg-surface-raised rounded-lg border border-th-border w-full">
      {/* Profile Header */}
      <div className="p-4 border-b border-th-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-th-bg-alt flex items-center justify-center">
              <span className="text-xl">{getRoleIcon(profile.role)}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-th-text capitalize">{profile.role}</h2>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.bg}`}>{badge.label}</span>
              </div>
              <span className="text-xs font-mono text-th-text-alt">{profile.agentId.slice(0, 12)}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-th-bg-alt text-th-text-alt">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Buttons */}
        {isAlive && (
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => setShowMessageInput(v => !v)}
              disabled={actionLoading !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Message
            </button>
            <button
              onClick={handleInterrupt}
              disabled={actionLoading !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
            >
              {actionLoading === 'interrupt' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Interrupt
            </button>
            <button
              onClick={() => setConfirmStop(true)}
              disabled={actionLoading !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
          </div>
        )}

        {/* Confirm Stop Dialog */}
        {confirmStop && (
          <div className="mt-2 p-3 rounded bg-red-500/10 border border-red-500/30">
            <p className="text-xs text-red-300 mb-2">Are you sure you want to terminate this agent? This cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={handleStop}
                disabled={actionLoading === 'stop'}
                className="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {actionLoading === 'stop' ? 'Stopping...' : 'Confirm Stop'}
              </button>
              <button
                onClick={() => setConfirmStop(false)}
                className="px-3 py-1 text-xs rounded bg-th-bg-alt text-th-text-alt hover:bg-th-border transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Message Input */}
        {showMessageInput && (
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
              placeholder="Type a message to this agent..."
              className="flex-1 px-3 py-1.5 text-sm rounded bg-th-bg-alt border border-th-border text-th-text placeholder:text-th-text-alt"
              autoFocus
            />
            <button
              onClick={handleSendMessage}
              disabled={!messageText.trim() || actionLoading === 'message'}
              className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {actionLoading === 'message' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as ProfileTab)}
        className="px-4"
      />

      {/* Tab Content */}
      <div className="p-4">
        {activeTab === 'overview' && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-th-text-alt">Model:</span> <span className="text-th-text">{profile.model}</span></div>
              <div><span className="text-th-text-alt">Project:</span> <span className="text-th-text">{profile.projectId ?? '—'}</span></div>
              <div><span className="text-th-text-alt">Knowledge:</span> <span className="text-th-text">{profile.knowledgeCount} entries</span></div>
              <div><span className="text-th-text-alt">Created:</span> <span className="text-th-text">{new Date(profile.createdAt).toLocaleDateString()}</span></div>
              <div><span className="text-th-text-alt">Last Active:</span> <span className="text-th-text">{new Date(profile.updatedAt).toLocaleDateString()}</span></div>
              {profile.live?.provider && (
                <div><span className="text-th-text-alt">CLI:</span> <span className="text-th-text capitalize">{profile.live.provider}{profile.live.backend && profile.live.backend !== 'acp' ? ` (${profile.live.backend})` : ''}</span></div>
              )}
              {profile.live?.sessionId && (
                <div className="col-span-2">
                  <span className="text-th-text-alt">Session:</span>{' '}
                  <button
                    className="font-mono text-xs text-th-text bg-th-bg-alt/60 px-1.5 py-0.5 rounded hover:bg-th-bg-alt transition-colors"
                    title="Click to copy session ID"
                    onClick={() => { navigator.clipboard.writeText(profile.live!.sessionId!); }}
                  >
                    {profile.live.sessionId.slice(0, 12)}…
                  </button>
                </div>
              )}
            </div>
            {profile.lastTaskSummary && (
              <div>
                <span className="text-th-text-alt">Last Task:</span>
                <p className="text-th-text mt-1">{profile.lastTaskSummary}</p>
              </div>
            )}
            {profile.live?.exitError && (
              <div className="mt-3 p-3 rounded bg-red-500/10 border border-red-500/20">
                <div className="flex items-center gap-2 text-red-400 text-xs font-medium mb-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Exit Error
                </div>
                <pre className="text-xs font-mono text-red-400 whitespace-pre-wrap break-words">{profile.live.exitError}</pre>
              </div>
            )}
            {profile.live && (
              <div className="mt-3 p-3 rounded bg-green-500/10 border border-green-500/20">
                <div className="flex items-center gap-2 text-green-400 text-xs mb-1">
                  <Activity className="w-3.5 h-3.5" />
                  Live Session
                </div>
                {profile.live.task && <p className="text-sm text-th-text">{profile.live.task}</p>}
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="text-sm text-th-text-alt text-center py-6">
            <Clock className="w-6 h-6 mx-auto mb-2 opacity-50" />
            Task history will be available when AS23 migration completes
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-3 text-sm">
            <div className="space-y-3">
              <div>
                <label className="text-th-text-alt text-xs block mb-1">Model</label>
                {isAlive ? (
                  <select
                    value={profile.live?.model || profile.model}
                    onChange={async (e) => {
                      try {
                        await apiFetch(`/agents/${agentId}`, { method: 'PATCH', body: JSON.stringify({ model: e.target.value }) });
                        setProfile((p: AgentProfile | null) => p ? { ...p, model: e.target.value, live: p.live ? { ...p.live, model: e.target.value } : p.live } : p);
                        addToast('success', 'Model updated');
                      } catch (err: unknown) {
                        const message = err instanceof Error ? err.message : String(err);
                        addToast('error', `Failed to update model: ${message}`);
                      }
                    }}
                    className="w-full text-sm bg-th-bg-alt border border-th-border text-th-text rounded px-2 py-1.5 focus:outline-none focus:border-accent cursor-pointer"
                  >
                    {(() => {
                      const current = profile.live?.model || profile.model;
                      const options = availableModels.includes(current) ? availableModels : [current, ...availableModels];
                      return options.map(m => <option key={m} value={m}>{deriveModelName(m)}</option>);
                    })()}
                  </select>
                ) : (
                  <span className="text-th-text">{profile.model}</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {profile.live?.provider && (
                  <div><span className="text-th-text-alt">CLI Provider:</span> <span className="text-th-text capitalize">{profile.live.provider}</span></div>
                )}
                {profile.live?.backend && (
                  <div><span className="text-th-text-alt">Backend:</span> <span className="text-th-text">{profile.live.backend}</span></div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
