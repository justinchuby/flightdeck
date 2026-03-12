export interface Prediction {
  id: string;
  type: PredictionType;
  severity: 'info' | 'warning' | 'critical';
  confidence: number; // 0-100
  title: string;
  detail: string;
  timeHorizon: number; // minutes until predicted event
  dataPoints: number;
  agentId?: string;
  taskId?: string;
  actions: PredictionAction[];
  createdAt: string;
  expiresAt: string;
  outcome?: 'correct' | 'avoided' | 'wrong' | null;
}

export type PredictionType =
  | 'context_exhaustion'
  | 'cost_overrun'
  | 'agent_stall'
  | 'task_duration'
  | 'completion_estimate'
;

export interface PredictionAction {
  label: string;
  description: string;
  actionType: 'api_call' | 'navigate' | 'dismiss';
  endpoint?: string;
  method?: 'POST' | 'DELETE';
  body?: Record<string, unknown>;
  route?: string;
  confidence?: number;
}

export interface PredictionConfig {
  enabled: boolean;
  refreshIntervalMs: number;
  minConfidence: number;
  minDataPoints: number;
  enabledTypes: Record<PredictionType, boolean>;
}

export interface PredictionAccuracy {
  total: number;
  correct: number;
  avoided: number;
  wrong: number;
  accuracy: number;
}

export const PREDICTION_TYPE_LABELS: Record<PredictionType, string> = {
  context_exhaustion: 'Context Exhaustion',
  cost_overrun: 'Cost Overrun',
  agent_stall: 'Agent Stall',
  task_duration: 'Task Duration',
  completion_estimate: 'Completion Estimate',
};

export const SEVERITY_COLORS: Record<string, string> = {
  info: 'text-th-text-muted',
  warning: 'text-amber-400',
  critical: 'text-red-400',
};

export const SEVERITY_BG: Record<string, string> = {
  info: 'bg-th-bg-muted',
  warning: 'bg-amber-500/10',
  critical: 'bg-red-500/10',
};

export const PREDICTION_ICONS: Record<PredictionType, string> = {
  context_exhaustion: '⚠',
  cost_overrun: '💰',
  agent_stall: '🐌',
  task_duration: '⏱',
  completion_estimate: '📊',
};

export function confidenceLabel(confidence: number): { text: string; color: string } {
  if (confidence >= 80) return { text: 'High', color: 'text-green-400' };
  if (confidence >= 60) return { text: `${confidence}%`, color: 'text-amber-400' };
  return { text: `${confidence}%`, color: 'text-th-text-muted' };
}
