import type { PaletteItem } from './PaletteSearchEngine';

// ── Types ───────────────────────────────────────────────────────────────────

export type NLCategory = 'control' | 'query' | 'navigate' | 'create';

export interface NLPattern {
  id: string;
  phrases: string[];          // trigger phrases (lowercase)
  category: NLCategory;
  destructive: boolean;
  description: string;
  icon: string;
}

// ── The 29 V1 Commands ──────────────────────────────────────────────────────

const PATTERNS: NLPattern[] = [
  // Control (12)
  { id: 'nl-wrap-up', phrases: ['wrap it up', 'finish up', 'wind down'], category: 'control', destructive: true, description: 'Set 10-min deadline, notify all agents, queue summary', icon: '⏱' },
  { id: 'nl-pause-all', phrases: ['pause everything', 'pause all', 'stop all', 'stop everything'], category: 'control', destructive: true, description: 'Pause all running agents', icon: '⏸' },
  { id: 'nl-resume', phrases: ['resume', 'unpause', 'continue', 'go'], category: 'control', destructive: false, description: 'Resume all paused agents', icon: '▶' },
  { id: 'nl-pause-except', phrases: ['pause everyone except', 'pause all except'], category: 'control', destructive: true, description: 'Pause all agents except a specific role', icon: '⏸' },
  { id: 'nl-focus', phrases: ['focus on', 'prioritize'], category: 'control', destructive: true, description: 'Reprioritize tasks matching topic', icon: '🎯' },
  { id: 'nl-speed-up', phrases: ['speed it up', 'go faster', 'faster'], category: 'control', destructive: true, description: 'Switch idle agents to faster models', icon: '⚡' },
  { id: 'nl-slow-down', phrases: ['slow down', 'save money', 'be cheaper'], category: 'control', destructive: true, description: 'Switch non-critical agents to cheaper models', icon: '🐢' },
  { id: 'nl-restart', phrases: ['restart'], category: 'control', destructive: true, description: 'Restart the named agent with handoff briefing', icon: '🔄' },
  { id: 'nl-compact', phrases: ['compact', 'free up context'], category: 'control', destructive: true, description: 'Trigger context compaction for named agent', icon: '📦' },
  { id: 'nl-approve-all', phrases: ['approve all', 'approve everything'], category: 'control', destructive: true, description: 'Batch-approve all pending decisions', icon: '✅' },
  { id: 'nl-reject-all', phrases: ['reject all pending', 'reject all'], category: 'control', destructive: true, description: 'Batch-reject all pending decisions', icon: '❌' },
  { id: 'nl-add-agent', phrases: ['add a', 'spawn a', 'create agent'], category: 'control', destructive: false, description: 'Create new agent with specified role', icon: '➕' },

  // Query (10)
  { id: 'nl-status', phrases: ["what's happening", 'status', "how's it going", 'what is happening'], category: 'query', destructive: false, description: 'Show session summary', icon: '📊' },
  { id: 'nl-cost-estimate', phrases: ['how much will this cost', 'cost estimate', 'estimate cost'], category: 'query', destructive: false, description: 'Show burn rate projection', icon: '💰' },
  { id: 'nl-slow-agent', phrases: ["what's taking so long", 'why so slow', 'why is it slow'], category: 'query', destructive: false, description: 'Identify slowest/stalled agent', icon: '🐌' },
  { id: 'nl-idle', phrases: ["who's idle", 'anyone free', 'idle agents'], category: 'query', destructive: false, description: 'List idle agents with suggested reassignments', icon: '💤' },
  { id: 'nl-catchup', phrases: ['what happened while i was away', 'catch me up', 'catch up'], category: 'query', destructive: false, description: 'Trigger catch-up summary', icon: '📰' },
  { id: 'nl-spent', phrases: ['how much have we spent', 'total cost', 'spending'], category: 'query', destructive: false, description: 'Show current cost + breakdown by agent', icon: '💸' },
  { id: 'nl-agent-status', phrases: ["what's the architect doing", "what is", "what's"], category: 'query', destructive: false, description: "Show agent's current task and activity", icon: '🔍' },
  { id: 'nl-problems', phrases: ['any problems', 'anything wrong', 'issues'], category: 'query', destructive: false, description: 'List agents with issues', icon: '🚨' },
  { id: 'nl-tasks-left', phrases: ['how many tasks left', 'progress', 'tasks remaining'], category: 'query', destructive: false, description: 'Show DAG completion stats', icon: '📋' },
  { id: 'nl-eta', phrases: ['when will this be done', 'eta', 'time remaining'], category: 'query', destructive: false, description: 'Show completion estimate', icon: '⏳' },

  // Navigate (4)
  { id: 'nl-show-agent', phrases: ['show me'], category: 'navigate', destructive: false, description: 'Navigate to focus mode for an agent', icon: '👁' },
  { id: 'nl-go-settings', phrases: ['go to settings', 'open settings'], category: 'navigate', destructive: false, description: 'Navigate to Settings', icon: '⚙️' },
  { id: 'nl-show-timeline', phrases: ['show the timeline', 'open timeline'], category: 'navigate', destructive: false, description: 'Navigate to Timeline', icon: '📅' },
  { id: 'nl-show-approvals', phrases: ['show approvals', 'pending decisions', 'open approvals'], category: 'navigate', destructive: false, description: 'Open approval queue', icon: '🎯' },

  // Create (1)
  { id: 'nl-snapshot', phrases: ['take a snapshot', 'save this moment', 'bookmark'], category: 'create', destructive: false, description: 'Create session replay bookmark', icon: '📸' },
];

// ── Pattern Matching ────────────────────────────────────────────────────────
// Priority: exact → starts-with → keyword overlap (≥ 60%)

export function matchNLCommand(query: string): NLPattern | null {
  const normalized = query.toLowerCase().trim();
  if (!normalized || normalized.length < 3) return null;

  // 1. Exact phrase match
  for (const pattern of PATTERNS) {
    if (pattern.phrases.some(p => normalized === p)) return pattern;
  }

  // 2. Starts-with match
  for (const pattern of PATTERNS) {
    if (pattern.phrases.some(p => normalized.startsWith(p))) return pattern;
  }

  // 3. Keyword overlap (>= 60%)
  const queryWords = normalized.split(/\s+/).filter(w => w.length > 2);
  if (queryWords.length === 0) return null;

  for (const pattern of PATTERNS) {
    const phraseWords = pattern.phrases.flatMap(p => p.split(/\s+/));
    const overlap = queryWords.filter(w => phraseWords.includes(w)).length;
    if (overlap / queryWords.length >= 0.6) return pattern;
  }

  return null;
}

// ── Palette Integration ─────────────────────────────────────────────────────

/** Convert all patterns to PaletteItem format for indexing in the search engine. */
export function getNLPaletteItems(execute: (pattern: NLPattern) => void): PaletteItem[] {
  return PATTERNS.map(p => ({
    id: p.id,
    type: 'nl-command' as const,
    label: p.description,
    description: p.phrases.slice(0, 3).map(ph => `"${ph}"`).join(', '),
    icon: p.icon,
    keywords: p.phrases,
    action: () => execute(p),
  }));
}

/** Get all registered patterns (for help/documentation). */
export function getAllPatterns(): NLPattern[] {
  return [...PATTERNS];
}

// ── Category Labels ─────────────────────────────────────────────────────────

export const NL_CATEGORY_LABELS: Record<NLCategory, string> = {
  control: 'Control',
  query: 'Query',
  navigate: 'Navigate',
  create: 'Create',
};
