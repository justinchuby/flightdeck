import { useRef, useState, useMemo, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { resolveShortId } from '../../utils/resolveShortId';
import { apiFetch } from '../../hooks/useApi';
import { useToastStore } from '../Toast';
import { X, Send, Maximize2, Minimize2, Megaphone, Zap } from 'lucide-react';
import { AcpOutput } from './AcpOutput';
import { AgentIdBadge } from '../../utils/markdown';
import { useFileDrop } from '../../hooks/useFileDrop';

interface Props {
  agentId: string;
  ws: {
    subscribe: (id: string) => void;
    unsubscribe: (id: string) => void;
    sendInput: (id: string, text: string) => void;
    resizeAgent: (id: string, cols: number, rows: number) => void;
    send: (msg: any) => void;
  };
}

export function ChatPanel({ agentId, ws }: Props) {
  const [inputText, setInputText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [broadcast, setBroadcast] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { agents, setSelectedAgent } = useAppStore();
  const agent = agents.find((a) => a.id === agentId);

  const handleFileInsert = useCallback((text: string) => {
    setInputText((prev) => (prev ? prev + ' ' + text : text));
    inputRef.current?.focus();
  }, []);
  const { isDragOver, handleDragOver, handleDragLeave, handleDrop, dropZoneClassName } = useFileDrop({
    onInsertText: handleFileInsert,
  });

  const activeAgents = useMemo(
    () => agents.filter((a) => a.status === 'running' || a.status === 'idle'),
    [agents],
  );

  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return activeAgents.filter(
      (a) =>
        a.id.slice(0, 8).toLowerCase().startsWith(q) ||
        a.role.name.toLowerCase().includes(q),
    );
  }, [mentionQuery, activeAgents]);

  const updateMentionState = (value: string, cursorPos: number) => {
    const before = value.slice(0, cursorPos);
    const match = before.match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  };

  const insertMention = (mentionAgent: typeof agents[0]) => {
    const shortId = mentionAgent.id.slice(0, 8);
    const cursorPos = inputRef.current?.selectionStart ?? inputText.length;
    const before = inputText.slice(0, cursorPos);
    const after = inputText.slice(cursorPos);
    const atIdx = before.lastIndexOf('@');
    const newText = before.slice(0, atIdx) + `@${shortId} ` + after;
    setInputText(newText);
    setMentionQuery(null);
    inputRef.current?.focus();
  };

  const runningAgents = agents.filter((a) => a.status === 'running');

  const sendToAgent = (targetId: string, text: string, mode: 'queue' | 'interrupt' = 'queue') => {
    apiFetch(`/agents/${targetId}/message`, {
      method: 'POST',
      body: JSON.stringify({ text, mode }),
    }).catch((err: Error) => {
      useToastStore.getState().add('error', `Failed to send: ${err.message}`);
    });
  };

  const interruptAgent = (targetId: string) => {
    apiFetch(`/agents/${targetId}/interrupt`, { method: 'POST' }).catch((err: Error) => {
      useToastStore.getState().add('error', `Failed to interrupt: ${err.message}`);
    });
  };

  const handleSend = (mode: 'queue' | 'interrupt' = 'queue') => {
    if (!inputText.trim()) return;

    // Record user message in store so it appears in chat
    const existing = useAppStore.getState().agents.find((a) => a.id === agentId);
    const isAgentBusy = existing?.status === 'running';
    const msgs = [...(existing?.messages ?? [])];
    // For interrupts, insert a separator so the post-interrupt response appears as a new bubble
    if (mode === 'interrupt' && isAgentBusy) {
      const last = msgs[msgs.length - 1];
      if (last?.sender === 'agent') {
        msgs.push({ type: 'text', text: '---', sender: 'system' as any, timestamp: Date.now() });
      }
    }
    msgs.push({ type: 'text', text: inputText, sender: 'user', timestamp: Date.now(), ...(isAgentBusy && mode === 'queue' ? { queued: true } : {}) });
    useAppStore.getState().updateAgent(agentId, { messages: msgs });

    if (broadcast) {
      const running = useAppStore.getState().agents.filter((a) => a.status === 'running');
      running.forEach((a) => sendToAgent(a.id, inputText, mode));
    } else {
      sendToAgent(agentId, inputText, mode);
    }
    // Send to @mentioned agents
    const mentionPattern = /@([a-f0-9]{4,8})\b/g;
    let m;
    while ((m = mentionPattern.exec(inputText)) !== null) {
      const fullId = useAppStore.getState().agents.find((a) => a.id.startsWith(m![1]))?.id;
      if (fullId && fullId !== agentId) {
        sendToAgent(fullId, inputText, mode);
      }
    }
    setInputText('');
    setMentionQuery(null);
  };

  return (
    <div className={`flex flex-col h-full ${expanded ? 'fixed inset-0 z-50 bg-surface' : ''}`}>
      <div className="h-10 border-b border-th-border flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2">
          <span>{agent?.role.icon}</span>
          <span className="text-sm font-medium">{agent?.role.name}</span>
          <span className="text-xs text-th-text-muted font-mono">{agentId.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-th-text-muted hover:text-th-text"
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={() => setSelectedAgent(null)}
            className="p-1 text-th-text-muted hover:text-th-text"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <AcpOutput agentId={agentId} />

      <div className="border-t border-th-border p-2 shrink-0 relative">
        {mentionSuggestions.length > 0 && (
          <div className="absolute bottom-full left-2 right-2 mb-1 bg-th-bg-alt border border-th-border rounded-lg shadow-lg max-h-40 overflow-y-auto z-10">
            {mentionSuggestions.map((a, i) => (
              <button
                key={a.id}
                onClick={() => insertMention(a)}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-th-bg-muted ${i === mentionIndex ? 'bg-th-bg-muted' : ''}`}
              >
                <span>{a.role.icon}</span>
                <span>{a.role.name}</span>
                <AgentIdBadge id={a.id} />
              </button>
            ))}
          </div>
        )}
        {broadcast && (
          <div className="text-xs text-accent mb-1 px-1">
            Broadcasting to {runningAgents.length} agents
          </div>
        )}
        <div
          className={`flex gap-2 items-end relative rounded-lg transition-all ${dropZoneClassName}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragOver && (
            <div className="absolute inset-0 flex items-center justify-center bg-accent/10 border-2 border-dashed border-accent rounded-lg z-10 pointer-events-none">
              <span className="text-xs font-medium text-accent">Drop file to mention or attach</span>
            </div>
          )}
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              updateMentionState(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (mentionSuggestions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMentionIndex((i) => Math.min(i + 1, mentionSuggestions.length - 1));
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMentionIndex((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === 'Tab' || e.key === 'Enter') {
                  if (mentionSuggestions[mentionIndex]) {
                    e.preventDefault();
                    insertMention(mentionSuggestions[mentionIndex]);
                    return;
                  }
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setMentionQuery(null);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                handleSend();
              } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (inputText.trim()) {
                  handleSend('interrupt');
                } else {
                  interruptAgent(agentId);
                }
              }
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 150) + 'px';
            }}
            rows={1}
            placeholder="Type a message... (Enter = send, Shift+Enter = newline, Ctrl+Enter = interrupt, @ to mention)"
            className={`flex-1 bg-surface border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent resize-none overflow-y-auto ${broadcast ? 'border-accent' : 'border-th-border'}`}
            style={{ maxHeight: 150 }}
          />
          <button
            onClick={() => setBroadcast(!broadcast)}
            className={`p-2 rounded-lg transition-colors ${broadcast ? 'text-accent bg-accent/10' : 'text-th-text-muted hover:text-th-text'}`}
            title="Broadcast to all running agents"
          >
            <Megaphone size={14} />
          </button>
          <button
            onClick={() => {
              if (inputText.trim()) {
                handleSend('interrupt');
              } else {
                interruptAgent(agentId);
              }
            }}
            className="p-2 text-amber-500 hover:bg-amber-500/10 rounded-lg transition-colors"
            title="Interrupt agent (Ctrl+Enter)"
          >
            <Zap size={14} />
          </button>
          <button
            onClick={() => handleSend()}
            className="p-2 bg-accent text-black rounded-lg hover:bg-accent-muted transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
