import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, MessageSquare, Users } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

interface SearchResult {
  source: 'conversation' | 'group';
  id: number | string;
  content: string;
  timestamp: string | null;
  // conversation fields
  agentId?: string | null;
  agentRole?: string | null;
  sender?: string;
  // group fields
  groupName?: string;
  leadId?: string;
  fromAgentId?: string;
  fromRole?: string;
}

interface SearchResponse {
  query: string;
  count: number;
  results: SearchResult[];
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function timeAgo(ts: string | null): string {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agents = useAppStore((s) => s.agents);
  const setSelectedAgent = useAppStore((s) => s.setSelectedAgent);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSearched(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Keyboard: Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=50`);
      if (res.ok) {
        const data: SearchResponse = await res.json();
        setResults(data.results);
      }
    } catch { /* skip */ }
    finally {
      setLoading(false);
      setSearched(true);
    }
  }, []);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  }, [doSearch]);

  // Resolve agent name
  const agentLabel = useCallback((id: string | null | undefined, role: string | null | undefined): string => {
    if (!id) return role ?? 'Unknown';
    if (id === 'human') return 'You';
    const agent = agents.find((a) => a.id === id);
    return agent?.role.name ?? role ?? id.slice(0, 8);
  }, [agents]);

  // Click result → open agent chat panel
  const handleResultClick = useCallback((result: SearchResult) => {
    if (result.source === 'conversation' && result.agentId) {
      setSelectedAgent(result.agentId);
      onClose();
    } else if (result.source === 'group') {
      // Could navigate to /groups, for now just close
      onClose();
    }
  }, [setSelectedAgent, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[60vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700">
          <Search className="w-5 h-5 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInput}
            placeholder="Search chat history…"
            className="flex-1 bg-transparent text-gray-200 text-sm placeholder-gray-500 outline-none"
          />
          {query && (
            <button onClick={() => { setQuery(''); setResults([]); setSearched(false); }} className="text-gray-500 hover:text-gray-300">
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="text-[10px] text-gray-600 border border-gray-700 rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-8 text-gray-500 text-sm">
              Searching…
            </div>
          )}

          {!loading && searched && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-gray-500 gap-2">
              <Search className="w-6 h-6" />
              <span className="text-sm">No results for &quot;{query}&quot;</span>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="py-1">
              {results.map((r, i) => {
                const preview = r.content.length > 200 ? r.content.slice(0, 200) + '…' : r.content;
                return (
                  <button
                    key={`${r.source}-${r.id}-${i}`}
                    onClick={() => handleResultClick(r)}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-800 transition-colors border-b border-gray-800/50 last:border-0"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {r.source === 'conversation' ? (
                        <Users className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      ) : (
                        <MessageSquare className="w-3.5 h-3.5 text-green-400 shrink-0" />
                      )}
                      <span className="text-xs font-medium text-accent">
                        {r.source === 'conversation'
                          ? agentLabel(r.agentId, r.agentRole)
                          : r.groupName ?? 'Group'}
                      </span>
                      {r.source === 'conversation' && r.sender && (
                        <span className="text-xs text-gray-500">({r.sender})</span>
                      )}
                      {r.source === 'group' && r.fromRole && (
                        <span className="text-xs text-gray-500">({r.fromRole})</span>
                      )}
                      <span className="text-xs text-gray-600 ml-auto shrink-0">
                        {timeAgo(r.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-300 whitespace-pre-wrap break-words line-clamp-2">
                      {highlightMatch(preview, query)}
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {!loading && !searched && (
            <div className="flex flex-col items-center justify-center py-8 text-gray-500 gap-2">
              <Search className="w-6 h-6" />
              <span className="text-sm">Search across all agent and group messages</span>
              <span className="text-xs text-gray-600">Type at least 2 characters</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
