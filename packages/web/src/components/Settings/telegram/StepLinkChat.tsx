// packages/web/src/components/Settings/telegram/StepLinkChat.tsx
// Step 2: Connect at least one Telegram chat to the bot.

import { useState, useCallback } from 'react';
import { Plus, Loader2, Check, AlertCircle, X, Info } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import type { StepProps, TestResult } from './types';

interface LinkedChat {
  chatId: string;
  testStatus: 'pending' | 'success' | 'failed';
  error?: string;
}

export function StepLinkChat({ config, onUpdate, onNext, onBack }: StepProps) {
  const [newChatId, setNewChatId] = useState('');
  const [linkedChats, setLinkedChats] = useState<LinkedChat[]>(
    (config.allowedChatIds || []).map(id => ({ chatId: id, testStatus: 'success' as const })),
  );
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const handleAddAndTest = useCallback(async () => {
    const trimmed = newChatId.trim();
    if (!trimmed) return;
    if (linkedChats.some(c => c.chatId === trimmed)) {
      setAddError('This chat ID is already added.');
      return;
    }

    setAdding(true);
    setAddError(null);

    // Add to list optimistically
    const newChat: LinkedChat = { chatId: trimmed, testStatus: 'pending' };
    setLinkedChats(prev => [...prev, newChat]);

    try {
      // Save the updated allowlist first
      const updatedIds = [...linkedChats.map(c => c.chatId), trimmed];
      await apiFetch('/integrations/telegram', {
        method: 'PATCH',
        body: JSON.stringify({ allowedChatIds: updatedIds }),
      });

      // Send test message
      const result = await apiFetch<TestResult>('/integrations/test-message', {
        method: 'POST',
        body: JSON.stringify({
          platform: 'telegram',
          chatId: trimmed,
          text: '🛩️ Flightdeck connection test — if you see this, Telegram is working!',
        }),
      });

      setLinkedChats(prev =>
        prev.map(c =>
          c.chatId === trimmed
            ? { ...c, testStatus: result.sent ? 'success' : 'failed', error: result.error }
            : c,
        ),
      );
      onUpdate({ allowedChatIds: updatedIds });
      setNewChatId('');
    } catch (err) {
      setLinkedChats(prev =>
        prev.map(c =>
          c.chatId === trimmed
            ? { ...c, testStatus: 'failed', error: (err as Error).message }
            : c,
        ),
      );
      setAddError('Could not reach this chat. Make sure your bot has been added to this chat.');
    } finally {
      setAdding(false);
    }
  }, [newChatId, linkedChats, onUpdate]);

  const handleRemove = useCallback((chatId: string) => {
    setLinkedChats(prev => prev.filter(c => c.chatId !== chatId));
    const updatedIds = linkedChats.filter(c => c.chatId !== chatId).map(c => c.chatId);
    onUpdate({ allowedChatIds: updatedIds });
  }, [linkedChats, onUpdate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAddAndTest();
  };

  const hasLinkedChats = linkedChats.length > 0;

  return (
    <div data-testid="telegram-wizard-step-2" className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-th-text mb-1">Link a Telegram Chat</h4>
        <p className="text-xs text-th-text-muted">
          Add at least one Telegram chat ID to authorize. Your bot will only respond to messages from authorized chats.
        </p>
      </div>

      {/* Manual entry */}
      <div className="bg-th-bg-alt border border-th-border rounded-md p-3">
        <div className="flex items-center gap-1.5 text-xs text-th-text-alt mb-2">
          <Info className="w-3 h-3" /> Enter your chat ID
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newChatId}
            onChange={(e) => { setNewChatId(e.target.value); setAddError(null); }}
            onKeyDown={handleKeyDown}
            placeholder="e.g. -1001234567890"
            disabled={adding}
            data-testid="telegram-chatid-input"
            aria-label="Telegram chat ID"
            className="flex-1 bg-th-bg-alt border border-th-border rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-accent disabled:opacity-50"
          />
          <button
            onClick={handleAddAndTest}
            disabled={adding || !newChatId.trim()}
            data-testid="telegram-add-test-btn"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent/10 text-accent rounded-md hover:bg-accent/20 transition-colors disabled:opacity-50"
          >
            {adding ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> Testing…</>
            ) : (
              <><Plus className="w-3 h-3" /> Add & Test</>
            )}
          </button>
        </div>
        <p className="text-[10px] text-th-text-muted mt-1.5">
          ℹ️ Use <span className="font-mono">@userinfobot</span> in Telegram to find your chat ID.
        </p>
        {addError && (
          <div className="flex items-center gap-1.5 text-xs text-red-400 mt-1.5" role="alert">
            <AlertCircle className="w-3 h-3" />
            {addError}
          </div>
        )}
      </div>

      {/* Linked chats list */}
      <div>
        <h5 className="text-xs font-medium text-th-text-muted uppercase tracking-wider mb-2">
          Linked Chats
        </h5>
        {hasLinkedChats ? (
          <div className="space-y-1.5" data-testid="telegram-linked-chats">
            {linkedChats.map(chat => (
              <div
                key={chat.chatId}
                className="flex items-center justify-between bg-th-bg-alt border border-th-border rounded-md px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono">{chat.chatId}</span>
                  {chat.testStatus === 'success' && (
                    <span className="flex items-center gap-1 text-[10px] text-green-400">
                      <Check className="w-3 h-3" /> Test sent
                    </span>
                  )}
                  {chat.testStatus === 'pending' && (
                    <span className="flex items-center gap-1 text-[10px] text-th-text-muted">
                      <Loader2 className="w-3 h-3 animate-spin" /> Testing…
                    </span>
                  )}
                  {chat.testStatus === 'failed' && (
                    <span className="flex items-center gap-1 text-[10px] text-red-400">
                      <AlertCircle className="w-3 h-3" /> {chat.error || 'Failed'}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleRemove(chat.chatId)}
                  aria-label={`Remove chat ${chat.chatId}`}
                  className="text-th-text-muted hover:text-red-400 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-th-text-muted bg-th-bg-alt rounded-md p-3 text-center">
            No chats linked yet. Add at least one chat to continue.
          </p>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <button
          onClick={onBack}
          className="px-3 py-1.5 text-xs text-th-text-muted hover:text-th-text rounded-md hover:bg-th-bg-alt transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={onNext}
          disabled={!hasLinkedChats}
          data-testid="telegram-next-2"
          title={!hasLinkedChats ? 'Add at least one chat to continue' : undefined}
          className="px-4 py-1.5 text-xs bg-accent text-black rounded-md font-semibold hover:bg-accent-muted transition-colors disabled:opacity-50"
        >
          Next: Configure →
        </button>
      </div>
    </div>
  );
}
