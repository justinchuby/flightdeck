import { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  Search,
  Plus,
  Trash2,
  BookOpen,
  Lightbulb,
  Clock,
  Tag,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  AlertTriangle,
  Sparkles,
  History,
  Wrench,
  Database,
  Shield,
  X,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToastStore } from '../Toast';

// ── Types ─────────────────────────────────────────────────

type KnowledgeCategory = 'core' | 'episodic' | 'procedural' | 'semantic';

interface KnowledgeEntry {
  id: number;
  projectId: string;
  category: KnowledgeCategory;
  key: string;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface CategoryStat {
  category: KnowledgeCategory;
  count: number;
  limit: number;
  readOnly: boolean;
}

interface TrainingSummary {
  totalCorrections: number;
  totalFeedback: number;
  positiveFeedback: number;
  negativeFeedback: number;
  topCorrectionTags: Array<{ tag: string; count: number }>;
  topFeedbackTags: Array<{ tag: string; count: number }>;
  agentStats: Array<{ agentId: string; corrections: number; positive: number; negative: number }>;
}

interface FusedSearchResult {
  entry: KnowledgeEntry;
  fusedScore: number;
  estimatedTokens: number;
}

// ── Helpers ───────────────────────────────────────────────

const CATEGORY_META: Record<KnowledgeCategory, { icon: typeof Brain; label: string; color: string; description: string }> = {
  core: { icon: Shield, label: 'Core', color: 'text-blue-500', description: 'Identity, preferences, rules' },
  episodic: { icon: History, label: 'Episodic', color: 'text-amber-500', description: 'Session summaries, events' },
  procedural: { icon: Wrench, label: 'Procedural', color: 'text-emerald-500', description: 'Patterns, corrections, how-to' },
  semantic: { icon: Database, label: 'Semantic', color: 'text-purple-500', description: 'Facts, relationships, context' },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return iso;
  }
}

// ── Sub-components ────────────────────────────────────────

function CategoryTab({
  category,
  count,
  isActive,
  onClick,
}: {
  category: KnowledgeCategory;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
        isActive
          ? 'bg-accent text-black font-medium'
          : 'text-th-text-muted hover:text-th-text hover:bg-th-bg-muted'
      }`}
    >
      <Icon className="w-3 h-3" />
      {meta.label}
      <span className="opacity-70">({count})</span>
    </button>
  );
}

function EntryCard({
  entry,
  isExpanded,
  onToggle,
  onDelete,
  confirmingDeleteId,
  onConfirmDelete,
  onCancelDelete,
}: {
  entry: KnowledgeEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: (id: number) => void;
  confirmingDeleteId: number | null;
  onConfirmDelete: (id: number) => void;
  onCancelDelete: () => void;
}) {
  const meta = CATEGORY_META[entry.category];
  const Icon = meta.icon;
  const isConfirmingDelete = confirmingDeleteId === entry.id;
  const isReadOnly = entry.category === 'core';
  const source = (entry.metadata?.source as string) ?? 'unknown';
  const tags = (entry.metadata?.tags as string[]) ?? [];

  return (
    <div className="bg-surface-raised border border-th-border rounded-lg overflow-hidden transition-colors hover:border-th-border-hover">
      <div
        className="flex items-center gap-3 p-3 cursor-pointer"
        onClick={onToggle}
        role="button"
        aria-expanded={isExpanded}
        aria-label={`Knowledge entry: ${entry.key}`}
      >
        <Icon className={`w-4 h-4 ${meta.color} shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-th-text-alt truncate">{entry.key}</span>
            {isReadOnly && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">read-only</span>
            )}
          </div>
          <div className="text-xs text-th-text-muted truncate mt-0.5">
            {entry.content.slice(0, 100)}{entry.content.length > 100 ? '...' : ''}
          </div>
        </div>
        <span className="text-[10px] text-th-text-muted shrink-0">{formatRelativeTime(entry.updatedAt)}</span>
        {isExpanded ? <ChevronDown className="w-4 h-4 text-th-text-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-th-text-muted shrink-0" />}
      </div>

      {isExpanded && (
        <div className="border-t border-th-border px-4 py-3 bg-th-bg-alt/30 space-y-3">
          <div className="text-xs whitespace-pre-wrap text-th-text-alt leading-relaxed max-h-60 overflow-y-auto font-mono bg-th-bg-alt rounded p-3">
            {entry.content}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div>
              <span className="text-th-text-muted">Category</span>
              <div className={`flex items-center gap-1 ${meta.color}`}>
                <Icon className="w-3 h-3" />
                {meta.label}
              </div>
            </div>
            <div>
              <span className="text-th-text-muted">Source</span>
              <div className="text-th-text-alt">{source}</div>
            </div>
            <div>
              <span className="text-th-text-muted">Created</span>
              <div className="text-th-text-alt">{formatDate(entry.createdAt)}</div>
            </div>
            <div>
              <span className="text-th-text-muted">Updated</span>
              <div className="text-th-text-alt">{formatDate(entry.updatedAt)}</div>
            </div>
          </div>

          {tags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <Tag className="w-3 h-3 text-th-text-muted" />
              {tags.map((t) => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-th-bg-alt text-th-text-muted">{t}</span>
              ))}
            </div>
          )}

          {!isReadOnly && (
            <div className="flex gap-2 pt-1">
              {isConfirmingDelete ? (
                <div className="flex items-center gap-2 w-full bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                  <span className="text-xs text-red-600 dark:text-red-400 flex-1">
                    Delete <strong>{entry.key}</strong>? This cannot be undone.
                  </span>
                  <button
                    onClick={() => onConfirmDelete(entry.id)}
                    className="px-2.5 py-1 text-xs bg-red-500 text-white rounded font-medium hover:bg-red-600 transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    onClick={onCancelDelete}
                    className="px-2.5 py-1 text-xs text-th-text-muted rounded hover:bg-th-bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => onDelete(entry.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-500/80 rounded-md hover:bg-red-500/10 transition-colors ml-auto"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewEntryForm({
  projectId,
  onCreated,
  onCancel,
}: {
  projectId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<KnowledgeCategory>('semantic');
  const [key, setKey] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const addToast = useToastStore((s) => s.add);

  const handleSubmit = async () => {
    if (!key.trim() || !content.trim()) return;
    setSubmitting(true);
    try {
      await apiFetch(`/projects/${projectId}/knowledge`, {
        method: 'POST',
        body: JSON.stringify({ category, key: key.trim(), content: content.trim(), metadata: { source: 'user' } }),
      });
      addToast('success', 'Knowledge entry created');
      onCreated();
    } catch (err: any) {
      addToast('error', `Failed to create: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-surface-raised border border-accent/30 rounded-lg p-4 space-y-3">
      <div className="text-xs font-medium text-accent">New Knowledge Entry</div>

      <div className="flex gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as KnowledgeCategory)}
          aria-label="Category"
          className="bg-th-bg-alt border border-th-border rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
        >
          <option value="semantic">Semantic</option>
          <option value="procedural">Procedural</option>
          <option value="episodic">Episodic</option>
        </select>
        <input
          type="text"
          placeholder="Key (e.g. git-workflow, api-conventions)"
          aria-label="Entry key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="flex-1 bg-th-bg-alt border border-th-border rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-accent"
        />
      </div>

      <textarea
        placeholder="Knowledge content..."
        aria-label="Entry content"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        className="w-full bg-th-bg-alt border border-th-border rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-accent resize-none"
      />

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-th-text-muted hover:text-th-text rounded-md hover:bg-th-bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!key.trim() || !content.trim() || submitting}
          className="px-4 py-1.5 text-xs bg-accent text-black rounded-md font-semibold disabled:opacity-50 transition-colors hover:bg-accent-muted"
        >
          {submitting ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  );
}

function TrainingOverview({ summary }: { summary: TrainingSummary }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface-raised border border-th-border rounded-lg p-3 text-center">
          <div className="text-lg font-semibold text-th-text-alt">{summary.totalCorrections}</div>
          <div className="text-[10px] text-th-text-muted uppercase">Corrections</div>
        </div>
        <div className="bg-surface-raised border border-th-border rounded-lg p-3 text-center">
          <div className="text-lg font-semibold text-th-text-alt">{summary.totalFeedback}</div>
          <div className="text-[10px] text-th-text-muted uppercase">Feedback</div>
        </div>
        <div className="bg-surface-raised border border-th-border rounded-lg p-3 text-center">
          <div className="text-lg font-semibold text-green-500">{summary.positiveFeedback}</div>
          <div className="text-[10px] text-th-text-muted uppercase flex items-center justify-center gap-1">
            <ThumbsUp className="w-2.5 h-2.5" /> Positive
          </div>
        </div>
        <div className="bg-surface-raised border border-th-border rounded-lg p-3 text-center">
          <div className="text-lg font-semibold text-red-500">{summary.negativeFeedback}</div>
          <div className="text-[10px] text-th-text-muted uppercase flex items-center justify-center gap-1">
            <ThumbsDown className="w-2.5 h-2.5" /> Negative
          </div>
        </div>
      </div>

      {summary.agentStats.length > 0 && (
        <div>
          <h4 className="text-[10px] text-th-text-muted uppercase tracking-wider font-medium mb-2">Agent Training Stats</h4>
          <div className="space-y-1">
            {summary.agentStats.map((a) => (
              <div key={a.agentId} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-th-text-muted w-20 truncate">{a.agentId.slice(0, 8)}</span>
                <span className="text-th-text-alt">{a.corrections} corrections</span>
                <span className="text-green-500">{a.positive}+</span>
                <span className="text-red-500">{a.negative}−</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────

interface Props {
  projectId?: string;
}

export function KnowledgePanel({ projectId: propProjectId }: Props) {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [stats, setStats] = useState<CategoryStat[]>([]);
  const [trainingSummary, setTrainingSummary] = useState<TrainingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<KnowledgeCategory | 'all' | 'search' | 'training'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FusedSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(propProjectId ?? '');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const addToast = useToastStore((s) => s.add);

  // Load projects for picker if no projectId prop
  useEffect(() => {
    if (!propProjectId) {
      apiFetch<Array<{ id: string; name: string; status: string }>>('/projects')
        .then((data) => {
          const active = (Array.isArray(data) ? data : []).filter((p) => p.status !== 'archived');
          setProjects(active);
          if (!selectedProjectId && active.length > 0) setSelectedProjectId(active[0].id);
        })
        .catch(() => {});
    }
  }, [propProjectId, selectedProjectId]);

  const effectiveProjectId = propProjectId ?? selectedProjectId;

  const fetchData = useCallback(async () => {
    if (!effectiveProjectId) return;
    setLoading(true);
    try {
      const [entriesData, statsData, trainingData] = await Promise.all([
        apiFetch<KnowledgeEntry[]>(`/projects/${effectiveProjectId}/knowledge`),
        apiFetch<CategoryStat[]>(`/projects/${effectiveProjectId}/knowledge/stats`),
        apiFetch<TrainingSummary>(`/projects/${effectiveProjectId}/knowledge/training`),
      ]);
      setEntries(Array.isArray(entriesData) ? entriesData : []);
      setStats(Array.isArray(statsData) ? statsData : []);
      setTrainingSummary(trainingData);
    } catch (err: any) {
      addToast('error', `Failed to load knowledge: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [effectiveProjectId, addToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = useCallback(async () => {
    if (!effectiveProjectId || !searchQuery.trim()) return;
    setSearching(true);
    setActiveTab('search');
    try {
      const results = await apiFetch<FusedSearchResult[]>(
        `/projects/${effectiveProjectId}/knowledge/search?q=${encodeURIComponent(searchQuery.trim())}`,
      );
      setSearchResults(Array.isArray(results) ? results : []);
    } catch (err: any) {
      addToast('error', `Search failed: ${err.message}`);
    } finally {
      setSearching(false);
    }
  }, [effectiveProjectId, searchQuery, addToast]);

  const handleRequestDelete = useCallback((id: number) => {
    setConfirmingDeleteId(id);
  }, []);

  const handleConfirmDelete = useCallback(
    async (id: number) => {
      const entry = entries.find((e) => e.id === id);
      if (!entry || !effectiveProjectId) return;
      try {
        await apiFetch(`/projects/${effectiveProjectId}/knowledge/${entry.category}/${encodeURIComponent(entry.key)}`, {
          method: 'DELETE',
        });
        addToast('success', 'Entry deleted');
        setEntries((prev) => prev.filter((e) => e.id !== id));
        setConfirmingDeleteId(null);
        if (expandedId === id) setExpandedId(null);
      } catch (err: any) {
        addToast('error', `Failed to delete: ${err.message}`);
      }
    },
    [entries, effectiveProjectId, addToast, expandedId],
  );

  const handleCancelDelete = useCallback(() => setConfirmingDeleteId(null), []);

  const getCountForCategory = (cat: KnowledgeCategory) =>
    stats.find((s) => s.category === cat)?.count ?? entries.filter((e) => e.category === cat).length;

  const filtered =
    activeTab === 'all'
      ? entries
      : activeTab === 'search' || activeTab === 'training'
        ? []
        : entries.filter((e) => e.category === activeTab);

  const totalEntries = entries.length;

  return (
    <div className="flex-1 overflow-auto p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Brain className="w-6 h-6 text-th-text-muted" />
          <h2 className="text-xl font-semibold">Knowledge</h2>
          <span className="text-sm text-th-text-muted">{totalEntries} entries</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Project picker (when no projectId prop) */}
          {!propProjectId && projects.length > 0 && (
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              aria-label="Select project"
              className="bg-th-bg-alt border border-th-border rounded-md px-2 py-1 text-xs focus:outline-none focus:border-accent"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowNewForm(!showNewForm)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-accent text-black rounded-lg font-medium hover:bg-accent-muted transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Entry
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-th-text-muted hover:text-th-text rounded-lg hover:bg-th-bg-muted transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* New entry form */}
      {showNewForm && effectiveProjectId && (
        <div className="mb-4">
          <NewEntryForm
            projectId={effectiveProjectId}
            onCreated={() => { setShowNewForm(false); fetchData(); }}
            onCancel={() => setShowNewForm(false)}
          />
        </div>
      )}

      {/* Category stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {(['core', 'episodic', 'procedural', 'semantic'] as KnowledgeCategory[]).map((cat) => {
          const meta = CATEGORY_META[cat];
          const Icon = meta.icon;
          const stat = stats.find((s) => s.category === cat);
          const count = stat?.count ?? 0;
          const limit = stat?.limit ?? 0;
          const pct = limit > 0 ? Math.round((count / limit) * 100) : 0;
          return (
            <button
              key={cat}
              onClick={() => setActiveTab(cat)}
              className={`bg-surface-raised border rounded-lg p-3 text-left transition-colors ${
                activeTab === cat ? 'border-accent' : 'border-th-border hover:border-th-border-hover'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                <span className="text-xs font-medium text-th-text-alt">{meta.label}</span>
              </div>
              <div className="text-lg font-semibold text-th-text-alt">{count}</div>
              {limit > 0 && (
                <div className="mt-1">
                  <div className="h-1 bg-th-bg-alt rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-accent'}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <div className="text-[9px] text-th-text-muted mt-0.5">{count}/{limit}</div>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Search bar */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-th-text-muted" />
          <input
            type="text"
            placeholder="Search knowledge..."
            aria-label="Search knowledge"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="w-full bg-th-bg-alt border border-th-border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setSearchResults([]); if (activeTab === 'search') setActiveTab('all'); }}
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
              <X className="w-3.5 h-3.5 text-th-text-muted hover:text-th-text" />
            </button>
          )}
        </div>
        <button
          onClick={handleSearch}
          disabled={!searchQuery.trim() || searching}
          className="px-4 py-2 text-xs bg-th-bg-alt border border-th-border rounded-lg hover:bg-th-bg-muted transition-colors disabled:opacity-50"
        >
          {searching ? 'Searching...' : 'Search'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 flex-wrap">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
            activeTab === 'all' ? 'bg-accent text-black font-medium' : 'text-th-text-muted hover:text-th-text hover:bg-th-bg-muted'
          }`}
        >
          All <span className="opacity-70">({totalEntries})</span>
        </button>
        {(['core', 'episodic', 'procedural', 'semantic'] as KnowledgeCategory[]).map((cat) => (
          <CategoryTab
            key={cat}
            category={cat}
            count={getCountForCategory(cat)}
            isActive={activeTab === cat}
            onClick={() => setActiveTab(cat)}
          />
        ))}
        {searchResults.length > 0 && (
          <button
            onClick={() => setActiveTab('search')}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
              activeTab === 'search' ? 'bg-accent text-black font-medium' : 'text-th-text-muted hover:text-th-text hover:bg-th-bg-muted'
            }`}
          >
            <Sparkles className="w-3 h-3" />
            Results <span className="opacity-70">({searchResults.length})</span>
          </button>
        )}
        <button
          onClick={() => setActiveTab('training')}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
            activeTab === 'training' ? 'bg-accent text-black font-medium' : 'text-th-text-muted hover:text-th-text hover:bg-th-bg-muted'
          }`}
        >
          <Lightbulb className="w-3 h-3" />
          Training
        </button>
      </div>

      {/* Content */}
      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-th-text-muted/30 border-t-accent rounded-full animate-spin" />
        </div>
      ) : activeTab === 'training' ? (
        trainingSummary ? (
          <TrainingOverview summary={trainingSummary} />
        ) : (
          <div className="bg-surface-raised border border-th-border rounded-lg p-12 text-center">
            <Lightbulb className="w-12 h-12 text-th-text-muted/30 mx-auto mb-3" />
            <p className="text-sm text-th-text-muted">No training data yet.</p>
          </div>
        )
      ) : activeTab === 'search' ? (
        searchResults.length === 0 ? (
          <div className="bg-surface-raised border border-th-border rounded-lg p-12 text-center">
            <Search className="w-12 h-12 text-th-text-muted/30 mx-auto mb-3" />
            <p className="text-sm text-th-text-muted">
              {searching ? 'Searching...' : 'No results found. Try a different query.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {searchResults.map((r) => (
              <div key={r.entry.id} className="relative">
                <span className="absolute -left-6 top-3 text-[9px] font-mono text-th-text-muted" title="Relevance score">
                  {r.fusedScore.toFixed(2)}
                </span>
                <EntryCard
                  entry={r.entry}
                  isExpanded={expandedId === r.entry.id}
                  onToggle={() => setExpandedId(expandedId === r.entry.id ? null : r.entry.id)}
                  onDelete={handleRequestDelete}
                  confirmingDeleteId={confirmingDeleteId}
                  onConfirmDelete={handleConfirmDelete}
                  onCancelDelete={handleCancelDelete}
                />
              </div>
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <div className="bg-surface-raised border border-th-border rounded-lg p-12 text-center">
          <BookOpen className="w-12 h-12 text-th-text-muted/30 mx-auto mb-3" />
          <p className="text-sm text-th-text-muted">
            {activeTab === 'all'
              ? 'No knowledge entries yet. Add one to get started.'
              : `No ${activeTab} entries.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              isExpanded={expandedId === entry.id}
              onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              onDelete={handleRequestDelete}
              confirmingDeleteId={confirmingDeleteId}
              onConfirmDelete={handleConfirmDelete}
              onCancelDelete={handleCancelDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
