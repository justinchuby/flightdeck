// packages/web/src/components/Settings/TelegramDashboard.tsx
// Post-setup dashboard for managing Telegram integration.

import { useState, useCallback } from 'react';
import { Plus, Settings2 } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { ChatRow } from './telegram/ChatRow';
import { StepConfigure } from './telegram/StepConfigure';
import {
  NOTIFICATION_CATEGORIES,
  type TelegramConfig,
  type TelegramStatus,
  type TelegramSession,
} from './telegram/types';

interface TelegramDashboardProps {
  config: TelegramConfig;
  status: TelegramStatus;
  onReconfigure: () => void;
  onRefresh?: () => void;
}

export function TelegramDashboard({ config, status, onReconfigure, onRefresh }: TelegramDashboardProps) {
  const [showAddChat, setShowAddChat] = useState(false);
  const [newChatId, setNewChatId] = useState('');
  const [editingNotifications, setEditingNotifications] = useState(false);

  const isConnected = status.adapters.some(a => a.platform === 'telegram' && a.running);
  const botAdapter = status.adapters.find(a => a.platform === 'telegram');

  const handleAddChat = useCallback(async () => {
    const trimmed = newChatId.trim();
    if (!trimmed || config.allowedChatIds.includes(trimmed)) return;

    try {
      const updatedIds = [...config.allowedChatIds, trimmed];
      await apiFetch('/integrations/telegram', {
        method: 'PATCH',
        body: JSON.stringify({ allowedChatIds: updatedIds }),
      });
      setNewChatId('');
      setShowAddChat(false);
      onRefresh?.();
    } catch {
      // Error handling in real implementation
    }
  }, [newChatId, config.allowedChatIds, onRefresh]);

  const handleRemoveChat = useCallback(async (chatId: string) => {
    try {
      const updatedIds = config.allowedChatIds.filter(id => id !== chatId);
      await apiFetch('/integrations/telegram', {
        method: 'PATCH',
        body: JSON.stringify({ allowedChatIds: updatedIds }),
      });
      onRefresh?.();
    } catch {
      // Error handling
    }
  }, [config.allowedChatIds, onRefresh]);

  const handleUnbind = useCallback(async (chatId: string) => {
    try {
      await apiFetch(`/integrations/sessions/${chatId}`, { method: 'DELETE' });
      onRefresh?.();
    } catch {
      // Endpoint may not exist yet — graceful degradation
    }
  }, [onRefresh]);

  const handleDisable = useCallback(async () => {
    if (!confirm('This will stop the Telegram bot. Existing sessions will expire.')) return;
    try {
      await apiFetch('/integrations/telegram', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: false }),
      });
      onRefresh?.();
    } catch {
      // Error handling
    }
  }, [onRefresh]);

  const getSessionForChat = (chatId: string): TelegramSession | undefined => {
    return status.sessions.find(s => s.chatId === chatId);
  };

  // Build projects list from sessions
  const projects = [...new Set(status.sessions.map(s => s.projectId))].map(id => ({ id }));

  // Notification summary
  const enabledCats = new Set(config.notifications?.enabledCategories || []);
  const notifSummary = NOTIFICATION_CATEGORIES.map(c => ({
    ...c,
    enabled: c.critical || enabledCats.has(c.id),
  }));

  return (
    <div className="space-y-4" data-testid="telegram-dashboard">
      {/* Status card */}
      <div className="bg-th-bg-alt border border-th-border rounded-md p-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
          <span className="text-xs font-medium text-th-text">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
          <span className="text-[10px] text-th-text-muted">
            {isConnected ? '• Polling' : '— check bot token'}
          </span>
        </div>
      </div>

      {/* Linked chats */}
      <div>
        <h5 className="text-xs font-medium text-th-text-muted uppercase tracking-wider mb-2">
          Linked Chats ({config.allowedChatIds.length})
        </h5>
        <div className="space-y-1.5">
          {config.allowedChatIds.map(chatId => (
            <ChatRow
              key={chatId}
              chatId={chatId}
              session={getSessionForChat(chatId)}
              projects={projects.length > 0 ? projects : [{ id: 'default' }]}
              onRemove={handleRemoveChat}
              onBound={() => onRefresh?.()}
              onUnbind={handleUnbind}
            />
          ))}
        </div>

        {/* Add chat inline */}
        {showAddChat ? (
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={newChatId}
              onChange={(e) => setNewChatId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddChat(); if (e.key === 'Escape') setShowAddChat(false); }}
              placeholder="Chat ID"
              autoFocus
              className="flex-1 bg-th-bg-alt border border-th-border rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-accent"
            />
            <button
              onClick={handleAddChat}
              disabled={!newChatId.trim()}
              className="px-3 py-1.5 text-xs bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              Add
            </button>
            <button
              onClick={() => setShowAddChat(false)}
              className="px-3 py-1.5 text-xs text-th-text-muted hover:text-th-text rounded-md"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddChat(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-accent bg-accent/10 rounded-md hover:bg-accent/20 transition-colors mt-2"
          >
            <Plus className="w-3 h-3" /> Add Chat
          </button>
        )}
      </div>

      {/* Notifications summary */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h5 className="text-xs font-medium text-th-text-muted uppercase tracking-wider">
            Notifications
          </h5>
          <button
            onClick={() => setEditingNotifications(!editingNotifications)}
            className="flex items-center gap-1 text-[10px] text-accent hover:underline"
          >
            <Settings2 className="w-3 h-3" />
            {editingNotifications ? 'Collapse' : 'Edit'}
          </button>
        </div>

        {editingNotifications ? (
          <StepConfigure
            config={config}
            onUpdate={() => onRefresh?.()}
            onNext={() => setEditingNotifications(false)}
            onBack={() => setEditingNotifications(false)}
          />
        ) : (
          <div className="bg-th-bg-alt border border-th-border rounded-md p-3">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {notifSummary.map(c => (
                <span key={c.id} className={c.enabled ? 'text-th-text-alt' : 'text-th-text-muted'}>
                  {c.enabled ? '✓' : '○'} {c.label.split(' ')[0]}
                </span>
              ))}
            </div>
            {config.notifications?.quietHours?.enabled && (
              <div className="text-[10px] text-th-text-muted mt-1.5">
                🌙 Quiet: {String(config.notifications.quietHours.startHour).padStart(2, '0')}:00–
                {String(config.notifications.quietHours.endHour).padStart(2, '0')}:00
                {' • '}⚡ {config.rateLimitPerMinute}/min
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick stats */}
      <div className="flex items-center gap-4 text-xs text-th-text-muted">
        <span>{status.pendingNotifications} pending</span>
        <span>•</span>
        <span>{status.subscriptions} subscription{status.subscriptions !== 1 ? 's' : ''}</span>
        <span>•</span>
        <span>{status.sessions.length} active session{status.sessions.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Footer actions */}
      <div className="flex justify-between pt-2 border-t border-th-border">
        <button
          onClick={handleDisable}
          className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 rounded-md hover:bg-red-400/10 transition-colors"
        >
          Disable Integration
        </button>
        <button
          onClick={onReconfigure}
          className="px-3 py-1.5 text-xs text-accent hover:underline"
        >
          Run Setup Again
        </button>
      </div>
    </div>
  );
}
