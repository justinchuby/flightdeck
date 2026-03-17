import { useCallback } from 'react';
import { useLeadStore } from '../../stores/leadStore';
import { useMessageStore } from '../../stores/messageStore';
import { apiFetch } from '../../hooks/useApi';
import type { AcpTextChunk } from '../../types';
import type { Attachment } from '../../hooks/useAttachments';

const EMPTY_MESSAGES: AcpTextChunk[] = [];

/**
 * Encapsulates send, remove-queued, and reorder-queued message actions
 * for the selected lead agent.
 */
export function useMessageActions(
  selectedLeadId: string | null,
  input: string,
  setInput: (text: string) => void,
  attachments: Attachment[],
  clearAttachments: () => void,
) {
  const sendMessage = useCallback(async (
    mode: 'queue' | 'interrupt' = 'queue',
    opts: { broadcast: boolean } = { broadcast: false },
  ) => {
    if (!input.trim() || !selectedLeadId) return;
    const text = input.trim();
    setInput('');
    const ms = useMessageStore.getState();
    ms.ensureChannel(selectedLeadId);
    // For interrupts, insert a separator so post-interrupt response appears as a new bubble
    if (mode === 'interrupt') {
      const msgs = ms.channels[selectedLeadId]?.messages ?? EMPTY_MESSAGES;
      const last = msgs[msgs.length - 1];
      if (last?.sender === 'agent') {
        ms.addMessage(selectedLeadId, { type: 'text', text: '---', sender: 'system', timestamp: Date.now() });
      }
    }
    ms.addMessage(selectedLeadId, {
      type: 'text',
      text,
      sender: 'user',
      queued: mode === 'queue',
      timestamp: Date.now(),
      attachments: attachments.length > 0
        ? attachments
            .filter((a) => a.kind === 'image')
            .map((a) => ({ name: a.name, mimeType: a.mimeType, thumbnailDataUrl: a.thumbnailDataUrl }))
        : undefined,
    });
    const payload: Record<string, unknown> = { text, mode };
    if (opts.broadcast) payload.broadcast = true;
    if (attachments.length > 0) {
      payload.attachments = attachments
        .filter((a) => a.data)
        .map((a) => ({ name: a.name, mimeType: a.mimeType, data: a.data }));
    }
    try {
      await apiFetch(`/lead/${selectedLeadId}/message`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      clearAttachments();
    } catch {
      // Network error — keep attachments so user can retry
    }
  }, [input, selectedLeadId, attachments, clearAttachments, setInput]);

  const removeQueuedMessage = useCallback(async (queueIndex: number) => {
    if (!selectedLeadId) return;
    try {
      await apiFetch(`/agents/${selectedLeadId}/queue/${queueIndex}`, { method: 'DELETE' });
      const ms = useMessageStore.getState();
      const msgs = ms.channels[selectedLeadId]?.messages || [];
      let seen = 0;
      const updated = msgs.filter((m: AcpTextChunk) => {
        if (!m.queued) return true;
        return seen++ !== queueIndex;
      });
      ms.setMessages(selectedLeadId, updated);
    } catch { /* ignore */ }
  }, [selectedLeadId]);

  const reorderQueuedMessage = useCallback(async (fromIndex: number, toIndex: number) => {
    if (!selectedLeadId) return;
    try {
      await apiFetch(`/agents/${selectedLeadId}/queue/reorder`, {
        method: 'POST',
        body: JSON.stringify({ from: fromIndex, to: toIndex }),
      });
      const ms = useMessageStore.getState();
      const msgs = ms.channels[selectedLeadId]?.messages || [];
      const queued = msgs.filter((m: AcpTextChunk) => m.queued);
      const nonQueued = msgs.filter((m: AcpTextChunk) => !m.queued);
      if (fromIndex < queued.length && toIndex < queued.length) {
        const [moved] = queued.splice(fromIndex, 1);
        queued.splice(toIndex, 0, moved);
        ms.setMessages(selectedLeadId, [...nonQueued, ...queued]);
      }
    } catch { /* ignore */ }
  }, [selectedLeadId]);

  return { sendMessage, removeQueuedMessage, reorderQueuedMessage };
}
