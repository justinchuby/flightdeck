// Shareable Replay types — aligned with designer spec

export interface ReplayAnnotation {
  id: string;
  timestamp: string;
  author: string;
  text: string;
  type: 'comment' | 'flag' | 'bookmark';
}

export interface ReplayHighlight {
  timestamp: string;
  type: 'decision' | 'crash' | 'milestone' | 'cost_spike';
  summary: string;
  significance: number; // 0-100
}

export interface ShareableReplay {
  id: string;
  sessionId: string;
  leadId: string;
  title: string;
  description?: string;
  createdAt: string;
  createdBy: string;
  format: 'link' | 'html' | 'json';
  accessToken?: string;
  expiresAt?: string;
  annotations: ReplayAnnotation[];
  highlights: ReplayHighlight[];
  stats: {
    duration: number;
    agentCount: number;
    taskCount: number;
    totalCost: number;
  };
}
