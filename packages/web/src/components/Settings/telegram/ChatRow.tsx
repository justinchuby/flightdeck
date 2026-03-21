// packages/web/src/components/Settings/telegram/ChatRow.tsx
// Individual chat row in the Telegram dashboard with bind/unbind support.

import { useState } from 'react';
import { X, Link2, Unlink } from 'lucide-react';
import { BindChallengeFlow } from './BindChallengeFlow';
import type { TelegramSession } from './types';

interface ChatRowProps {
  chatId: string;
  session?: TelegramSession;
  projects: Array<{ id: string; name?: string }>;
  onRemove: (chatId: string) => void;
  onBound: () => void;
  onUnbind: (chatId: string) => void;
}

export function ChatRow({ chatId, session, projects, onRemove, onBound, onUnbind }: ChatRowProps) {
  const [showBind, setShowBind] = useState(false);

  const expiresIn = session
    ? Math.max(0, new Date(session.expiresAt).getTime() - Date.now())
    : 0;
  const expiresHours = Math.floor(expiresIn / (60 * 60 * 1000));
  const expiresMinutes = Math.floor((expiresIn % (60 * 60 * 1000)) / (60 * 1000));

  return (
    <div className="bg-th-bg-alt border border-th-border rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2">
        <div>
          <span className="text-xs font-mono text-th-text">{chatId}</span>
          {session && (
            <div className="text-[10px] text-th-text-muted mt-0.5">
              Bound → {session.projectId} • Expires: {expiresHours}h {expiresMinutes}m remaining
            </div>
          )}
          {!session && !showBind && (
            <div className="text-[10px] text-th-text-muted mt-0.5">Not bound to a project</div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {session ? (
            <>
              <button
                onClick={() => setShowBind(true)}
                className="px-2 py-1 text-[10px] text-accent bg-accent/10 rounded hover:bg-accent/20 transition-colors"
                title="Rebind to a different project"
              >
                Rebind
              </button>
              <button
                onClick={() => onUnbind(chatId)}
                className="px-2 py-1 text-[10px] text-red-400 hover:bg-red-400/10 rounded transition-colors"
                title="Unbind from project"
              >
                <Unlink className="w-3 h-3" />
              </button>
            </>
          ) : !showBind ? (
            <button
              onClick={() => setShowBind(true)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-accent bg-accent/10 rounded hover:bg-accent/20 transition-colors"
              data-testid="telegram-bind-btn"
            >
              <Link2 className="w-3 h-3" /> Bind to Project
            </button>
          ) : null}
          <button
            onClick={() => onRemove(chatId)}
            aria-label={`Remove chat ${chatId}`}
            className="text-th-text-muted hover:text-red-400 transition-colors ml-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {showBind && (
        <div className="px-3 pb-3">
          <BindChallengeFlow
            chatId={chatId}
            projects={projects}
            onBound={(projectId) => {
              setShowBind(false);
              onBound();
            }}
            onCancel={() => setShowBind(false)}
          />
        </div>
      )}
    </div>
  );
}
