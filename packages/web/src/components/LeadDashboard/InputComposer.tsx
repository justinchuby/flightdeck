import { Send, Clock, ChevronUp, ChevronDown, X, Loader2, Zap } from 'lucide-react';
import type { AcpTextChunk } from '../../types';
import type { Attachment } from '../../hooks/useAttachments';
import { AttachmentBar } from '../AttachmentBar';
import { apiFetch } from '../../hooks/useApi';

interface InputComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  isActive: boolean;
  selectedLeadId: string | null;
  messages: AcpTextChunk[];
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  onSendMessage: (mode: 'queue' | 'interrupt') => void;
  onRemoveQueuedMessage: (index: number) => void;
  onReorderQueuedMessage: (from: number, to: number) => void;
}

export function InputComposer({
  input,
  onInputChange,
  isActive,
  selectedLeadId,
  messages,
  attachments,
  onRemoveAttachment,
  onSendMessage,
  onRemoveQueuedMessage,
  onReorderQueuedMessage,
}: InputComposerProps) {
  return (
    <>
      {messages.some((m) => m.queued) && (
        <div className="border-t border-dashed border-th-border px-4 py-2 bg-th-bg-alt/50 max-h-48 overflow-y-auto">
          <div className="text-[10px] text-th-text-muted uppercase tracking-wider mb-1 flex items-center gap-1 sticky top-0 bg-th-bg-alt/50">
            <Clock className="w-3 h-3" />
            Queued ({messages.filter((m) => m.queued).length})
          </div>
          {messages.filter((m) => m.queued).map((msg, i, arr) => (
            <div key={`q-${i}`} className="flex justify-end items-center gap-1.5 py-0.5 group">
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {i > 0 && (
                  <button type="button" aria-label="Move message up" onClick={() => onReorderQueuedMessage(i, i - 1)} className="p-0.5 rounded hover:bg-th-bg-muted text-th-text-muted hover:text-th-text" title="Move up">
                    <ChevronUp className="w-3 h-3" />
                  </button>
                )}
                {i < arr.length - 1 && (
                  <button type="button" aria-label="Move message down" onClick={() => onReorderQueuedMessage(i, i + 1)} className="p-0.5 rounded hover:bg-th-bg-muted text-th-text-muted hover:text-th-text" title="Move down">
                    <ChevronDown className="w-3 h-3" />
                  </button>
                )}
                <button type="button" aria-label="Remove queued message" onClick={() => onRemoveQueuedMessage(i)} className="p-0.5 rounded hover:bg-red-500/20 text-th-text-muted hover:text-red-400" title="Remove">
                  <X className="w-3 h-3" />
                </button>
              </div>
              <span className="text-[10px] text-th-text-muted">
                {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
              <div className="max-w-[70%] rounded-lg px-3 py-1.5 bg-blue-600/40 text-blue-600 dark:text-blue-200 font-mono text-sm whitespace-pre-wrap border border-blue-500/30">
                {msg.text}
              </div>
              <Loader2 className="w-3 h-3 animate-spin text-blue-400 shrink-0" />
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-th-border p-3">
        <AttachmentBar attachments={attachments} onRemove={onRemoveAttachment} />
        <div className="flex gap-2 items-end relative rounded transition-all">
          <textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                onSendMessage('queue');
              } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (input.trim()) {
                  onSendMessage('interrupt');
                } else if (selectedLeadId) {
                  apiFetch(`/agents/${selectedLeadId}/interrupt`, { method: 'POST' });
                }
              }
            }}
            placeholder={isActive ? 'Message the Lead... (Enter = send, Ctrl+Enter = interrupt, @ to mention files, drag & drop images)' : 'Project Lead is not active'}
            disabled={!isActive}
            rows={1}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 150) + 'px';
            }}
            className="flex-1 bg-th-bg-alt border border-th-border rounded px-3 py-2 text-sm font-mono text-th-text-alt focus:outline-none focus:border-yellow-500 disabled:opacity-50 resize-none overflow-y-auto"
            style={{ maxHeight: 150 }}
          />
          <div className="flex flex-col gap-1 shrink-0">
            <button type="button" onClick={() => onSendMessage('queue')} disabled={!isActive || !input.trim()} title="Send (queued) — Enter" className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-th-bg-hover text-black px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1">
              <Send className="w-3.5 h-3.5" />
              Queue
            </button>
            <button type="button" onClick={() => { if (input.trim()) { onSendMessage('interrupt'); } else if (selectedLeadId) { apiFetch(`/agents/${selectedLeadId}/interrupt`, { method: 'POST' }); } }} disabled={!isActive} title="Interrupt agent (Ctrl+Enter)" className="bg-red-700 hover:bg-red-600 disabled:bg-th-bg-hover text-white px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1">
              <Zap className="w-3.5 h-3.5" />
              Interrupt
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
