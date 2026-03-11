import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users,
  Search,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  ArrowUpDown,
  User,
  Cpu,
  BookOpen,
  Wrench,
  Settings,
  Activity,
  Clock,
  PauseCircle,
  UserMinus,
  X,
  Download,
  Upload,
  FolderDown,
  Package,
  CheckCircle,
  Info,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { useToastStore } from '../components/Toast';
import { AgentLifecycle } from '../components/AgentLifecycle';
import { StatusBadge, agentStatusProps } from '../components/ui/StatusBadge';
import { EmptyState } from '../components/ui/EmptyState';
import { Tabs } from '../components/ui/Tabs';
import type { TabItem } from '../components/ui/Tabs';

// ── Types ─────────────────────────────────────────────────

type CrewTab = 'roster' | 'health' | 'export';
type AgentStatus = 'idle' | 'busy' | 'terminated' | 'retired';
type LiveStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed' | 'terminated' | null;
type ProfileTab = 'overview' | 'history' | 'knowledge' | 'skills' | 'settings';
type SortField = 'role' | 'status' | 'updatedAt';
type SortDir = 'asc' | 'desc';
type StatusFilter = AgentStatus | 'all';

interface CrewInfo {
  teamId: string;
  agentCount: number;
  roles: string[];
}

interface RosterAgent {
  agentId: string;
  role: string;
  model: string;
  status: AgentStatus;
  liveStatus: LiveStatus;
  teamId: string;
  projectId: string | null;
  lastTaskSummary: string | null;
  createdAt: string;
  updatedAt: string;
  uptimeMs?: number;
  clonedFromId?: string;
}

/** Exported for AgentLifecycle compatibility */
export interface AgentHealthInfo {
  agentId: string;
  role: string;
  model: string;
  status: string;
  uptimeMs: number;
  lastTaskSummary?: string;
  retiredAt?: string;
  clonedFromId?: string;
}

interface AgentProfile {
  agentId: string;
  role: string;
  model: string;
  status: AgentStatus;
  liveStatus: LiveStatus;
  teamId: string;
  projectId: string | null;
  lastTaskSummary: string | null;
  createdAt: string;
  updatedAt: string;
  knowledgeCount: number;
  live: {
    task: string | null;
    outputPreview: string | null;
    model: string | null;
  } | null;
}

interface HealthData {
  teamId: string;
  totalAgents: number;
  statusCounts: Record<string, number>;
  massFailurePaused: boolean;
  agents: AgentHealthInfo[];
}

interface CrewDetail {
  teamId: string;
  agentCount: number;
  agents: Array<{ agentId: string; role: string; model: string; status: string }>;
  knowledgeCount: number;
  trainingSummary: { corrections?: number; feedback?: number } | null;
}

interface ExportResult {
  success: boolean;
  bundle?: unknown;
  bundlePath?: string;
  manifest?: { exportedAt: string; agentCount: number; knowledgeCount: number };
  filesWritten?: number;
}

interface ImportReport {
  success: boolean;
  teamId: string;
  agents: Array<{ name: string; action: string; newAgentId: string; renamedTo?: string }>;
  knowledge: { imported: number; skipped: number; conflicts: number };
  training: { correctionsImported: number; feedbackImported: number };
  warnings: string[];
  validation: { valid: boolean; issues: Array<{ severity: string; message: string; phase?: string }> };
}

// ── Helpers ───────────────────────────────────────────────

function formatUptime(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

// ── Sub-components ────────────────────────────────────────

function OverviewCard({ label, count, icon, color, testId }: {
  label: string;
  count: number;
  icon: React.ReactNode;
  color: string;
  testId?: string;
}) {
  return (
    <div className="bg-th-bg-alt border border-th-border rounded-lg p-4" data-testid={testId}>
      <div className={`flex items-center gap-2 ${color}`}>
        {icon}
        <span className="text-2xl font-bold">{count}</span>
      </div>
      <span className="text-xs text-th-text-muted mt-1 block">{label}</span>
    </div>
  );
}

function AgentCard({ agent, selected, onSelect, onManage }: {
  agent: RosterAgent;
  selected: boolean;
  onSelect: (id: string) => void;
  onManage: (id: string) => void;
}) {
  const badge = agentStatusProps(agent.status, agent.liveStatus);

  return (
    <div
      className={`bg-surface-raised rounded-lg border p-4 transition-colors ${
        selected ? 'border-th-accent' : 'border-th-border hover:bg-th-bg-alt/50'
      }`}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={() => onSelect(agent.agentId)}
          className="flex-1 flex items-center gap-3 text-left min-w-0"
        >
          <div className="w-8 h-8 rounded-full bg-th-bg-alt flex items-center justify-center flex-shrink-0">
            <User className="w-4 h-4 text-th-text-alt" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-th-text capitalize">{agent.role}</span>
              <span className="text-xs font-mono text-th-text-alt">{agent.agentId.slice(0, 8)}</span>
              {agent.clonedFromId && <span title="Cloned agent">🧬</span>}
            </div>
            <div className="flex items-center gap-2 text-xs text-th-text-alt truncate">
              <span className="truncate">{agent.lastTaskSummary ?? 'No recent task'}</span>
              {agent.uptimeMs != null && (
                <span className="flex items-center gap-0.5 flex-shrink-0">
                  <Clock className="w-3 h-3" />
                  {formatUptime(agent.uptimeMs)}
                </span>
              )}
            </div>
          </div>
          <StatusBadge variant={badge.variant} label={badge.label} className="flex-shrink-0" />
          <ChevronRight className="w-4 h-4 text-th-text-alt flex-shrink-0" />
        </button>
        <button
          onClick={() => onManage(agent.agentId)}
          className="text-xs text-accent hover:underline flex-shrink-0"
          data-testid={`manage-${agent.agentId.slice(0, 8)}`}
        >
          Manage
        </button>
      </div>
    </div>
  );
}

function ProfilePanel({ agentId, teamId, onClose }: {
  agentId: string;
  teamId: string;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTab>('overview');

  useEffect(() => {
    setLoading(true);
    apiFetch<AgentProfile>(`/teams/${teamId}/agents/${agentId}/profile`)
      .then(data => setProfile(data))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [agentId, teamId]);

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

  const badge = agentStatusProps(profile.status, profile.liveStatus);
  const tabs: TabItem[] = [
    { id: 'overview', label: 'Overview', icon: <User className="w-3.5 h-3.5" /> },
    { id: 'history', label: 'History', icon: <Clock className="w-3.5 h-3.5" /> },
    { id: 'knowledge', label: 'Knowledge', icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: 'skills', label: 'Skills', icon: <Wrench className="w-3.5 h-3.5" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="bg-surface-raised rounded-lg border border-th-border">
      {/* Header */}
      <div className="p-4 border-b border-th-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-th-bg-alt flex items-center justify-center">
              <User className="w-5 h-5 text-th-text-alt" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-th-text capitalize">{profile.role}</h2>
                <StatusBadge variant={badge.variant} label={badge.label} />
              </div>
              <span className="text-xs font-mono text-th-text-alt">{profile.agentId.slice(0, 12)}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-th-bg-alt text-th-text-alt">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as ProfileTab)}
        className="px-4"
      />

      {/* Tab content */}
      <div className="p-4">
        {activeTab === 'overview' && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-th-text-alt">Model:</span> <span className="text-th-text">{profile.model}</span></div>
              <div><span className="text-th-text-alt">Team:</span> <span className="text-th-text">{profile.teamId}</span></div>
              <div><span className="text-th-text-alt">Project:</span> <span className="text-th-text">{profile.projectId ?? '—'}</span></div>
              <div><span className="text-th-text-alt">Knowledge:</span> <span className="text-th-text">{profile.knowledgeCount} entries</span></div>
              <div><span className="text-th-text-alt">Created:</span> <span className="text-th-text">{new Date(profile.createdAt).toLocaleDateString()}</span></div>
              <div><span className="text-th-text-alt">Last Active:</span> <span className="text-th-text">{new Date(profile.updatedAt).toLocaleDateString()}</span></div>
            </div>
            {profile.lastTaskSummary && (
              <div>
                <span className="text-th-text-alt">Last Task:</span>
                <p className="text-th-text mt-1">{profile.lastTaskSummary}</p>
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
            Task history will be available when migration completes
          </div>
        )}

        {activeTab === 'knowledge' && (
          <div className="text-sm text-th-text-alt text-center py-6">
            <BookOpen className="w-6 h-6 mx-auto mb-2 opacity-50" />
            {profile.knowledgeCount > 0
              ? `${profile.knowledgeCount} knowledge entries — use Knowledge panel for details`
              : 'No knowledge entries yet'}
          </div>
        )}

        {activeTab === 'skills' && (
          <div className="text-sm text-th-text-alt text-center py-6">
            <Wrench className="w-6 h-6 mx-auto mb-2 opacity-50" />
            Skills and training data will be available when migration completes
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-th-text-alt">Model:</span> <span className="text-th-text">{profile.model}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Export Dialog ──────────────────────────────────────────

function ExportDialog({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const addToast = useToastStore(s => s.add);
  const [includeKnowledge, setIncludeKnowledge] = useState(true);
  const [includeTraining, setIncludeTraining] = useState(true);
  const [excludeEpisodic, setExcludeEpisodic] = useState(false);
  const [outputPath, setOutputPath] = useState('');
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);

  const handleExport = async (toDirectory: boolean) => {
    setExporting(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = { includeKnowledge, includeTraining, excludeEpisodic };
      if (toDirectory && outputPath.trim()) {
        body.outputPath = outputPath.trim();
      }
      const data = await apiFetch<ExportResult>(
        `/teams/${encodeURIComponent(teamId)}/export`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      setResult(data);
      if (data.success && !toDirectory && data.bundle) {
        // Download as JSON file
        const blob = new Blob([JSON.stringify(data.bundle, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${teamId}-team-bundle.json`;
        a.click();
        URL.revokeObjectURL(url);
        addToast('success', 'Crew bundle downloaded');
      } else if (data.success && toDirectory) {
        addToast('success', `Exported to ${data.bundlePath ?? outputPath}`);
      }
    } catch (err: any) {
      addToast('error', err.message ?? 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid="export-dialog"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-th-bg border border-th-border rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-th-border">
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-th-accent" />
            <h2 className="text-base font-semibold text-th-text">Export Crew</h2>
          </div>
          <button onClick={onClose} className="text-th-text-muted hover:text-th-text p-1" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-400 flex items-start gap-2">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Export packages your crew&apos;s agents, knowledge, and training data into a portable
              bundle. Use <strong>&quot;Export to Directory&quot;</strong> to create a <code>.flightdeck-team/</code> folder
              you can copy between machines, or download a JSON bundle file.
            </span>
          </div>

          {/* Options */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-th-text cursor-pointer">
              <input type="checkbox" checked={includeKnowledge} onChange={e => setIncludeKnowledge(e.target.checked)} className="rounded" />
              Include knowledge entries
            </label>
            <label className="flex items-center gap-2 text-sm text-th-text cursor-pointer">
              <input type="checkbox" checked={includeTraining} onChange={e => setIncludeTraining(e.target.checked)} className="rounded" />
              Include training data (corrections &amp; feedback)
            </label>
            <label className="flex items-center gap-2 text-sm text-th-text-alt cursor-pointer">
              <input type="checkbox" checked={excludeEpisodic} onChange={e => setExcludeEpisodic(e.target.checked)} className="rounded" />
              Exclude episodic knowledge (session-specific memories)
            </label>
          </div>

          {/* Directory path */}
          <div>
            <label className="text-xs text-th-text-alt block mb-1">Export directory (optional — for .flightdeck-team/ folder)</label>
            <input
              type="text"
              value={outputPath}
              onChange={e => setOutputPath(e.target.value)}
              placeholder="/path/to/export/directory"
              className="w-full px-3 py-2 text-sm rounded bg-th-bg-alt border border-th-border text-th-text placeholder:text-th-text-alt"
              data-testid="export-path-input"
            />
          </div>

          {/* Result */}
          {result?.success && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-400 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              {result.bundlePath
                ? `Exported to ${result.bundlePath} (${result.filesWritten ?? 0} files)`
                : 'Bundle downloaded successfully'}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => handleExport(true)}
              disabled={exporting || !outputPath.trim()}
              className="px-4 py-2 text-sm rounded bg-th-bg-alt hover:bg-th-border text-th-text-alt transition-colors flex items-center gap-1.5 disabled:opacity-40"
              data-testid="export-directory-btn"
            >
              <FolderDown className="w-4 h-4" />
              Export to Directory
            </button>
            <button
              onClick={() => handleExport(false)}
              disabled={exporting}
              className="px-4 py-2 text-sm rounded bg-th-accent/20 hover:bg-th-accent/30 text-th-accent border border-th-accent/30 transition-colors flex items-center gap-1.5 disabled:opacity-40"
              data-testid="export-download-btn"
            >
              <Download className="w-4 h-4" />
              {exporting ? 'Exporting…' : 'Download Bundle'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Import Dialog ─────────────────────────────────────────

function ImportDialog({ teamId, onClose, onImported }: {
  teamId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const addToast = useToastStore(s => s.add);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bundleJson, setBundleJson] = useState('');
  const [projectId, setProjectId] = useState('');
  const [agentConflict, setAgentConflict] = useState<'skip' | 'rename' | 'overwrite'>('skip');
  const [knowledgeConflict, setKnowledgeConflict] = useState<'prefer_existing' | 'prefer_import' | 'keep_both' | 'skip'>('prefer_existing');
  const [importing, setImporting] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<ImportReport | null>(null);
  const [importResult, setImportResult] = useState<ImportReport | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setBundleJson(text);
      addToast('success', `Loaded ${file.name}`);
    } catch {
      addToast('error', 'Failed to read file');
    }
  };

  const parseBundle = (): unknown | null => {
    try {
      return JSON.parse(bundleJson);
    } catch {
      addToast('error', 'Invalid JSON in bundle');
      return null;
    }
  };

  const handleDryRun = async () => {
    const bundle = parseBundle();
    if (!bundle || !projectId.trim()) {
      addToast('error', 'Bundle and project ID are required');
      return;
    }
    setImporting(true);
    setDryRunResult(null);
    try {
      const data = await apiFetch<{ success: boolean; report: ImportReport }>(
        '/teams/import',
        {
          method: 'POST',
          body: JSON.stringify({
            bundle,
            projectId: projectId.trim(),
            teamId,
            agentConflict,
            knowledgeConflict,
            dryRun: true,
          }),
        },
      );
      setDryRunResult(data.report);
    } catch (err: any) {
      addToast('error', err.message ?? 'Dry run failed');
    } finally {
      setImporting(false);
    }
  };

  const handleImport = async () => {
    const bundle = parseBundle();
    if (!bundle || !projectId.trim()) return;
    setImporting(true);
    setImportResult(null);
    try {
      const data = await apiFetch<{ success: boolean; report: ImportReport }>(
        '/teams/import',
        {
          method: 'POST',
          body: JSON.stringify({
            bundle,
            projectId: projectId.trim(),
            teamId,
            agentConflict,
            knowledgeConflict,
            dryRun: false,
          }),
        },
      );
      setImportResult(data.report);
      if (data.success) {
        addToast('success', 'Crew imported successfully');
        onImported();
      }
    } catch (err: any) {
      addToast('error', err.message ?? 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid="import-dialog"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-th-bg border border-th-border rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-th-border sticky top-0 bg-th-bg z-10">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-th-accent" />
            <h2 className="text-base font-semibold text-th-text">Import Crew</h2>
          </div>
          <button onClick={onClose} className="text-th-text-muted hover:text-th-text p-1" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* File picker */}
          <div>
            <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileSelect} className="hidden" data-testid="import-file-input" />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full px-4 py-3 rounded-lg border-2 border-dashed border-th-border hover:border-th-accent/50 text-sm text-th-text-alt hover:text-th-text transition-colors flex items-center justify-center gap-2"
              data-testid="import-file-btn"
            >
              <Package className="w-5 h-5" />
              {bundleJson ? 'Bundle loaded ✓ — click to replace' : 'Choose crew bundle file (.json)'}
            </button>
          </div>

          {/* Project ID */}
          <div>
            <label className="text-xs text-th-text-alt block mb-1">Target project ID (required)</label>
            <input
              type="text"
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              placeholder="my-project"
              className="w-full px-3 py-2 text-sm rounded bg-th-bg-alt border border-th-border text-th-text placeholder:text-th-text-alt"
              data-testid="import-project-input"
            />
          </div>

          {/* Conflict strategies */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-th-text-alt block mb-1">Agent conflicts</label>
              <select
                value={agentConflict}
                onChange={e => setAgentConflict(e.target.value as typeof agentConflict)}
                className="w-full px-2 py-1.5 text-sm rounded bg-th-bg-alt border border-th-border text-th-text"
              >
                <option value="skip">Skip existing</option>
                <option value="rename">Rename new</option>
                <option value="overwrite">Overwrite</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-th-text-alt block mb-1">Knowledge conflicts</label>
              <select
                value={knowledgeConflict}
                onChange={e => setKnowledgeConflict(e.target.value as typeof knowledgeConflict)}
                className="w-full px-2 py-1.5 text-sm rounded bg-th-bg-alt border border-th-border text-th-text"
              >
                <option value="prefer_existing">Keep existing</option>
                <option value="prefer_import">Prefer import</option>
                <option value="keep_both">Keep both</option>
                <option value="skip">Skip all</option>
              </select>
            </div>
          </div>

          {/* Dry-run result */}
          {dryRunResult && (
            <div className="p-3 rounded-lg border border-th-border bg-th-bg-alt space-y-2" data-testid="dry-run-result">
              <h3 className="text-sm font-medium text-th-text">Import Preview</h3>
              {dryRunResult.validation?.issues?.length > 0 && (
                <div className="space-y-1">
                  {dryRunResult.validation.issues.map((issue, i) => (
                    <div key={i} className={`text-xs flex items-center gap-1 ${issue.severity === 'error' ? 'text-red-400' : 'text-yellow-400'}`}>
                      <AlertTriangle className="w-3 h-3" />
                      {issue.message}
                    </div>
                  ))}
                </div>
              )}
              <div className="text-xs text-th-text-alt space-y-0.5">
                <p>Agents: {dryRunResult.agents?.length ?? 0} to process</p>
                <p>Knowledge: {dryRunResult.knowledge?.imported ?? 0} to import, {dryRunResult.knowledge?.skipped ?? 0} skipped</p>
                <p>Training: {dryRunResult.training?.correctionsImported ?? 0} corrections, {dryRunResult.training?.feedbackImported ?? 0} feedback</p>
              </div>
              {dryRunResult.warnings?.length > 0 && (
                <div className="text-xs text-yellow-400">
                  {dryRunResult.warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
                </div>
              )}
            </div>
          )}

          {/* Import result */}
          {importResult?.success && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-green-400 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              Crew imported to {importResult.teamId}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleDryRun}
              disabled={importing || !bundleJson || !projectId.trim()}
              className="px-4 py-2 text-sm rounded bg-th-bg-alt hover:bg-th-border text-th-text-alt transition-colors flex items-center gap-1.5 disabled:opacity-40"
              data-testid="import-preview-btn"
            >
              Preview Import
            </button>
            <button
              onClick={handleImport}
              disabled={importing || !bundleJson || !projectId.trim()}
              className="px-4 py-2 text-sm rounded bg-th-accent/20 hover:bg-th-accent/30 text-th-accent border border-th-accent/30 transition-colors flex items-center gap-1.5 disabled:opacity-40"
              data-testid="import-confirm-btn"
            >
              <Upload className="w-4 h-4" />
              {importing ? 'Importing…' : 'Import Crew'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────

export function CrewPage() {
  const addToast = useToastStore(s => s.add);

  // Data state
  const [teams, setTeams] = useState<CrewInfo[]>([]);
  const [selectedTeam, setSelectedTeam] = useState('default');
  const [agents, setAgents] = useState<RosterAgent[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamDetail, setTeamDetail] = useState<CrewDetail | null>(null);

  // UI state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortField, setSortField] = useState<SortField>('role');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [managingAgent, setManagingAgent] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [activeTab, setActiveTab] = useState<CrewTab>('roster');

  // ── Data fetching ────────────────────────────────────────

  const fetchTeams = useCallback(async () => {
    try {
      const data = await apiFetch<{ teams: CrewInfo[] }>('/teams');
      setTeams(data.teams ?? []);
      if (data.teams?.length && !data.teams.find(t => t.teamId === selectedTeam)) {
        setSelectedTeam(data.teams[0].teamId);
      }
    } catch { /* teams list is non-critical */ }
  }, [selectedTeam]);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const agentUrl = statusFilter === 'all'
        ? `/teams/${selectedTeam}/agents`
        : `/teams/${selectedTeam}/agents?status=${statusFilter}`;

      const [agentData, healthData, crewDetailData] = await Promise.allSettled([
        apiFetch<RosterAgent[]>(agentUrl),
        apiFetch<HealthData>(`/teams/${encodeURIComponent(selectedTeam)}/health`),
        apiFetch<CrewDetail>(`/teams/${encodeURIComponent(selectedTeam)}`),
      ]);

      if (agentData.status === 'fulfilled') {
        const roster = Array.isArray(agentData.value) ? agentData.value : [];
        // Enrich roster with health data (uptime, clone info)
        if (healthData.status === 'fulfilled') {
          const healthMap = new Map(healthData.value.agents.map(a => [a.agentId, a]));
          for (const agent of roster) {
            const h = healthMap.get(agent.agentId);
            if (h) {
              agent.uptimeMs = h.uptimeMs;
              agent.clonedFromId = h.clonedFromId;
            }
          }
        }
        setAgents(roster);
      } else {
        throw agentData.reason;
      }

      if (healthData.status === 'fulfilled') setHealth(healthData.value);
      if (crewDetailData.status === 'fulfilled') setTeamDetail(crewDetailData.value);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load crew data');
    } finally {
      setLoading(false);
    }
  }, [selectedTeam, statusFilter]);

  useEffect(() => { fetchTeams(); }, [fetchTeams]);
  useEffect(() => { setLoading(true); fetchData(); }, [fetchData]);

  // Polling
  useEffect(() => {
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // WebSocket events
  useEffect(() => {
    function onWsMessage(event: Event) {
      try {
        const raw = (event as MessageEvent).data;
        const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (msg.type === 'team:agent_retired' || msg.type === 'team:agent_cloned') {
          fetchData();
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('ws-message', onWsMessage);
    return () => window.removeEventListener('ws-message', onWsMessage);
  }, [fetchData]);

  // ── Actions ──────────────────────────────────────────────

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // ── Filter & sort ────────────────────────────────────────

  const filtered = agents
    .filter(a => {
      if (!search) return true;
      const q = search.toLowerCase();
      return a.role.toLowerCase().includes(q)
        || a.agentId.toLowerCase().includes(q)
        || (a.lastTaskSummary?.toLowerCase().includes(q) ?? false);
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'role') return a.role.localeCompare(b.role) * dir;
      if (sortField === 'status') return a.status.localeCompare(b.status) * dir;
      return (a.updatedAt > b.updatedAt ? 1 : -1) * dir;
    });

  // ── Render ───────────────────────────────────────────────

  if (loading && agents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-th-text-alt">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading crew…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400">
        <AlertTriangle className="w-5 h-5 mr-2" />
        {error}
      </div>
    );
  }

  const statusCounts = health?.statusCounts ?? {};

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header with team identity and actions */}
      <div className="bg-surface-raised rounded-lg border border-th-border p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-th-accent/20 flex items-center justify-center">
              <Users className="w-6 h-6 text-th-accent" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-th-text capitalize">{selectedTeam}</h1>
                {teams.length > 1 && (
                  <select
                    value={selectedTeam}
                    onChange={e => setSelectedTeam(e.target.value)}
                    className="px-2 py-0.5 text-xs rounded bg-th-bg-alt border border-th-border text-th-text"
                  >
                    {teams.map(t => (
                      <option key={t.teamId} value={t.teamId}>{t.teamId}</option>
                    ))}
                  </select>
                )}
              </div>
              <p className="text-sm text-th-text-alt">Persistent crew — agents, knowledge, and training data</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setLoading(true); fetchData(); }}
              className="px-3 py-1.5 text-sm rounded bg-th-bg-alt hover:bg-th-border text-th-text-alt transition-colors flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
        </div>

        {/* Team stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm" data-testid="crew-identity">
          <div>
            <span className="text-th-text-alt">Agents</span>
            <p className="font-semibold text-th-text text-lg">{teamDetail?.agentCount ?? agents.length}</p>
          </div>
          <div>
            <span className="text-th-text-alt">Knowledge</span>
            <p className="font-semibold text-th-text text-lg">{teamDetail?.knowledgeCount ?? 0} entries</p>
          </div>
          <div>
            <span className="text-th-text-alt">Training</span>
            <p className="font-semibold text-th-text text-lg">
              {teamDetail?.trainingSummary
                ? `${teamDetail.trainingSummary.corrections ?? 0} corrections`
                : '—'}
            </p>
          </div>
          <div>
            <span className="text-th-text-alt">Crew ID</span>
            <p className="font-mono text-th-text text-sm">{selectedTeam}</p>
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-th-border" data-testid="crew-tabs">
        {([
          { id: 'roster' as const, label: 'Roster', icon: Users },
          { id: 'health' as const, label: 'Health', icon: Activity },
          { id: 'export' as const, label: 'Export / Import', icon: Download },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-th-accent text-th-accent'
                : 'border-transparent text-th-text-alt hover:text-th-text'
            }`}
            data-testid={`tab-${tab.id}`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Roster tab ──────────────────────────────────────── */}
      {activeTab === 'roster' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-th-text-alt" />
              <input
                type="text"
                placeholder="Search agents..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded bg-th-bg-alt border border-th-border text-th-text placeholder:text-th-text-alt"
              />
            </div>

            <div className="flex gap-1">
              {(['all', 'busy', 'idle', 'retired', 'terminated'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 text-xs rounded capitalize transition-colors ${
                    statusFilter === s
                      ? 'bg-th-accent/20 text-th-accent border border-th-accent/30'
                      : 'bg-th-bg-alt text-th-text-alt border border-th-border hover:bg-th-border'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            <button
              onClick={() => toggleSort(sortField === 'role' ? 'status' : sortField === 'status' ? 'updatedAt' : 'role')}
              className="px-3 py-1.5 text-xs rounded bg-th-bg-alt border border-th-border text-th-text-alt hover:bg-th-border flex items-center gap-1"
            >
              <ArrowUpDown className="w-3 h-3" />
              {sortField}
            </button>
          </div>

          {/* Agent list + profile */}
          <div className="flex gap-6">
            <div className={`space-y-2 ${selectedAgent ? 'w-1/2' : 'w-full'}`}>
              {filtered.length === 0 ? (
                <EmptyState
                  icon={<Cpu className="w-10 h-10 opacity-50" />}
                  title={search ? 'No agents match your search' : 'No agents in this crew'}
                  description={search ? 'Try a different search term.' : 'Agents will appear here when they join the crew.'}
                  compact
                />
              ) : (
                filtered.map(agent => (
                  <AgentCard
                    key={agent.agentId}
                    agent={agent}
                    selected={agent.agentId === selectedAgent}
                    onSelect={setSelectedAgent}
                    onManage={setManagingAgent}
                  />
                ))
              )}
            </div>

            {selectedAgent && (
              <div className="w-1/2">
                <ProfilePanel
                  agentId={selectedAgent}
                  teamId={selectedTeam}
                  onClose={() => setSelectedAgent(null)}
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Health tab ──────────────────────────────────────── */}
      {activeTab === 'health' && (
        <>
          {/* Mass failure alert */}
          {health?.massFailurePaused && (
            <div
              className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2"
              role="alert"
              data-testid="mass-failure-alert"
            >
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="text-sm text-red-400">
                Mass failure detected — agent spawning is paused
              </span>
            </div>
          )}

          {/* Overview cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <OverviewCard
              label="Total"
              count={health?.totalAgents ?? agents.length}
              icon={<Users className="w-4 h-4" />}
              color="text-th-text"
              testId="card-total"
            />
            <OverviewCard
              label="Active"
              count={statusCounts.busy ?? 0}
              icon={<Activity className="w-4 h-4" />}
              color="text-green-400"
              testId="card-active"
            />
            <OverviewCard
              label="Idle"
              count={statusCounts.idle ?? 0}
              icon={<PauseCircle className="w-4 h-4" />}
              color="text-blue-400"
              testId="card-idle"
            />
            <OverviewCard
              label="Retired"
              count={statusCounts.retired ?? 0}
              icon={<UserMinus className="w-4 h-4" />}
              color="text-gray-400"
              testId="card-retired"
            />
          </div>
        </>
      )}

      {/* ── Export/Import tab ───────────────────────────────── */}
      {activeTab === 'export' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Export section */}
            <div className="bg-surface-raised rounded-lg border border-th-border p-5">
              <div className="flex items-center gap-2 mb-3">
                <Download className="w-5 h-5 text-th-accent" />
                <h2 className="font-semibold text-th-text">Export Crew</h2>
              </div>
              <p className="text-sm text-th-text-alt mb-4">
                Package your crew&apos;s agents, knowledge, and training data into a portable
                bundle. Creates a <code className="text-th-accent">.flightdeck-team/</code> directory
                you can copy between machines, or download a JSON file.
              </p>
              <button
                onClick={() => setShowExport(true)}
                className="px-4 py-2 text-sm rounded bg-th-accent/20 hover:bg-th-accent/30 text-th-accent border border-th-accent/30 transition-colors flex items-center gap-1.5"
                data-testid="export-crew-btn"
              >
                <Download className="w-4 h-4" />
                Export Crew
              </button>
            </div>

            {/* Import section */}
            <div className="bg-surface-raised rounded-lg border border-th-border p-5">
              <div className="flex items-center gap-2 mb-3">
                <Upload className="w-5 h-5 text-th-accent" />
                <h2 className="font-semibold text-th-text">Import Crew</h2>
              </div>
              <p className="text-sm text-th-text-alt mb-4">
                Import a crew bundle from another Flightdeck instance. Validates the bundle,
                previews changes, and lets you choose how to handle conflicts.
              </p>
              <button
                onClick={() => setShowImport(true)}
                className="px-4 py-2 text-sm rounded bg-th-bg-alt hover:bg-th-border text-th-text-alt border border-th-border transition-colors flex items-center gap-1.5"
                data-testid="import-crew-btn"
              >
                <Upload className="w-4 h-4" />
                Import Crew
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lifecycle modal */}
      {managingAgent && (
        <AgentLifecycle
          agentId={managingAgent}
          teamId={selectedTeam}
          agent={health?.agents.find(a => a.agentId === managingAgent)}
          onClose={() => setManagingAgent(null)}
          onActionComplete={() => { fetchData(); setManagingAgent(null); }}
        />
      )}

      {/* Export dialog */}
      {showExport && (
        <ExportDialog teamId={selectedTeam} onClose={() => setShowExport(false)} />
      )}

      {/* Import dialog */}
      {showImport && (
        <ImportDialog
          teamId={selectedTeam}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); fetchData(); }}
        />
      )}
    </div>
  );
}
