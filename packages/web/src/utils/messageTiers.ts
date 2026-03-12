import type { AgentComm } from '../stores/leadStore';
import type { GroupMessage } from '../types';

// ── Types ────────────────────────────────────────────────────────────

export type MessageTier = 'critical' | 'notable' | 'routine';

export type FeedItem =
  | { type: '1:1'; item: AgentComm }
  | { type: 'group'; item: GroupMessage };

// ── Classification patterns ──────────────────────────────────────────

const CRITICAL_PATTERNS = [
  /\bbuild fail/i,
  /\btest fail/i,
  /\bcompil(?:e|ation) (?:error|fail)/i,
  /\bcrash(?:ed|ing)?\b/i,
  /\bblocked\b/i,
  /\bP0\b/,
  /\bURGENT\b/i,
  /\b(?:type|syntax|runtime)error\b/i,
  /\bagent (?:stuck|failed|crashed)/i,
  /\bdecision (?:needed|pending|required)/i,
  /\bneeds(?:Confirmation| confirmation| your (?:input|decision))/i,
  /\bbreaking change/i,
  /\btimeout\b/i,
  /\bOOM\b|\bout of memory\b/i,
  /\bfatal\b/i,
  /\b5\d{2}\b.*error/i,
  /\bSIGTERM\b|\bSIGKILL\b/,
  /\bENOMEM\b/,
  /\bheap (?:out|limit|exceeded)/i,
  /\bsegfault\b|\bsegmentation fault\b/i,
  /\bstack overflow\b/i,
  /⚠️|🔴|❌/,
];

const NOTABLE_PATTERNS = [
  /\btask completed\b|\bwork completed\b|completed successfully/i,
  /\b\[Done\]/,
  /\bfinished\b/i,
  /\ball \d+ tests pass/i,
  /\bbuild (?:passes|succeeded|✅)/i,
  /\bmerged?\b/i,
  /\bshipped\b/i,
  /\breview (?:complete|done|ready|submitted)/i,
  /\bprogress/i,
  /\bdelegat(?:ed|ion)/i,
  /\bnew feature/i,
  /\bfixed?\b/i,
  /✅|🎉|📋/,
];

const ROUTINE_ROLES = new Set([
  'secretary',
]);

// ── Classifier ───────────────────────────────────────────────────────

/** Classify a feed item into a message tier */
export function classifyMessage(entry: FeedItem, leadId?: string): MessageTier {
  const content = entry.type === '1:1' ? entry.item.content : entry.item.content;
  const fromRole = entry.type === '1:1' ? entry.item.fromRole : entry.item.fromRole;

  // Messages TO the user (lead) are at least notable
  if (entry.type === '1:1' && leadId && entry.item.toId === leadId) {
    // But could be critical if content matches
    if (CRITICAL_PATTERNS.some(p => p.test(content))) return 'critical';
    return 'notable';
  }

  // Check critical patterns first
  if (CRITICAL_PATTERNS.some(p => p.test(content))) return 'critical';

  // Check notable patterns
  if (NOTABLE_PATTERNS.some(p => p.test(content))) return 'notable';

  // Agent reports are notable
  if (content.startsWith('[Agent Report]')) return 'notable';

  // Secretary routine updates
  if (ROUTINE_ROLES.has(fromRole)) return 'routine';

  // Default: routine for short messages, notable for substantial ones
  return content.length > 200 ? 'notable' : 'routine';
}

// ── Tier metadata ────────────────────────────────────────────────────

export const TIER_CONFIG = {
  critical: {
    label: 'Critical',
    icon: '🔴',
    borderClass: 'border-l-red-500/70',
    bgClass: 'bg-red-500/[0.08]',
    borderBClass: 'border-b-red-500/20',
  },
  notable: {
    label: 'Notable',
    icon: '🔵',
    borderClass: 'border-l-blue-400/50',
    bgClass: 'bg-blue-500/[0.04]',
    borderBClass: 'border-b-blue-400/20',
  },
  routine: {
    label: 'Routine',
    icon: '⚪',
    borderClass: 'border-l-transparent',
    bgClass: '',
    borderBClass: 'border-b-gray-700/30',
  },
} as const;

export type TierFilter = 'all' | 'notable' | 'critical';

/** Returns true if the tier passes the given filter */
export function tierPassesFilter(tier: MessageTier, filter: TierFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'critical') return tier === 'critical';
  // 'notable' shows critical + notable
  return tier === 'critical' || tier === 'notable';
}
