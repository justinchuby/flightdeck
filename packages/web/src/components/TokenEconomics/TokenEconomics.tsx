import { useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore } from '../../stores/leadStore';
import { useHistoricalAgents } from '../../hooks/useHistoricalAgents';
import { formatTokens } from '../../utils/format';
import type { AgentInfo } from '../../types';

// ── Helpers ──────────────────────────────────────────────────────────

function formatBurnRate(tokensPerSecond: number): string {
  const perMin = tokensPerSecond * 60;
  if (perMin >= 1_000) return `~${(perMin / 1_000).toFixed(1)}k/min`;
  return `~${Math.round(perMin)}/min`;
}

function formatTimeRemaining(minutes: number | null | undefined): string {
  if (minutes == null || minutes <= 0) return '';
  if (minutes < 1) return '<1 min left';
  if (minutes < 60) return `~${Math.round(minutes)} min left`;
  return `~${(minutes / 60).toFixed(1)} hr left`;
}

function exhaustionUrgency(minutes: number | null | undefined): 'normal' | 'warning' | 'critical' {
  if (minutes == null || minutes <= 0) return 'normal';
  if (minutes <= 5) return 'critical';
  if (minutes <= 10) return 'warning';
  return 'normal';
}

function exhaustionColor(urgency: 'normal' | 'warning' | 'critical'): string {
  if (urgency === 'critical') return 'text-red-400';
  if (urgency === 'warning') return 'text-yellow-600 dark:text-yellow-400';
  return 'text-th-text-muted';
}

function contextPercent(agent: AgentInfo): number {
  if (!agent.contextWindowSize || !agent.contextWindowUsed) return 0;
  return Math.min(100, (agent.contextWindowUsed / agent.contextWindowSize) * 100);
}

function pressureColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 80) return 'bg-yellow-500';
  return 'bg-blue-500';
}

function pressureTextColor(pct: number): string {
  if (pct >= 90) return 'text-red-400';
  if (pct >= 80) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-th-text-muted';
}

// ── Estimation ───────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4;

/** Estimate tokens from text length (~4 chars/token) */
function estimateTokens(text: string | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

interface AgentTokenData {
  agent: AgentInfo;
  input: number;
  output: number;
  total: number;
  isEstimated: boolean;
}

// ── Component ────────────────────────────────────────────────────────

interface TokenEconomicsProps {
  agents?: AgentInfo[];
}

export function TokenEconomics({ agents: agentsProp }: TokenEconomicsProps) {
  // Token estimation is hidden until accuracy is improved (see GitHub issue #106).
  // The estimation logic (~4 chars/token on outputPreview) severely undercounts
  // actual usage by missing tool calls, input tokens, and thinking tokens.
  return (
    <div className="flex items-center justify-center h-full text-th-text-muted text-xs p-4 text-center" data-testid="token-economics-hidden">
      <p>Token usage tracking is temporarily hidden while we improve estimation accuracy.{' '}
      <span className="text-[10px]">See GitHub issue #106 for details.</span></p>
    </div>
  );
}
