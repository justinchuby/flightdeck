import type { ActivityLedger, ActivityEntry } from '../activity/ActivityLedger.js';
import type { AgentManager } from '../../agents/AgentManager.js';
import { isTerminalStatus } from '../../agents/Agent.js';

export interface AgentScorecard {
  agentId: string;
  agentRole: string;
  overallScore: number; // 0-100
  metrics: {
    speed: MetricScore;
    quality: MetricScore;
    tokenEfficiency: MetricScore;
    reliability: MetricScore;
    collaboration: MetricScore;
  };
  stats: {
    tasksCompleted: number;
    tasksFailed: number;
    totalActiveTime: number; // ms
    avgTaskDuration: number; // ms
    totalTokensUsed: number;
    tokensPerTask: number;
    messagesReceived: number;
    messagesSent: number;
    filesEdited: number;
    errorsEncountered: number;
  };
}

interface MetricScore {
  score: number; // 0-100
  label: string;
  detail: string;
}

export class PerformanceTracker {
  constructor(
    private activityLedger: ActivityLedger,
    private agentManager: AgentManager,
  ) {}

  /** Generate scorecard for a specific agent */
  getScorecard(agentId: string): AgentScorecard | null {
    const agent = this.agentManager.get(agentId);
    if (!agent) return null;

    const events = this.activityLedger.getRecent(50_000).filter((e) => e.agentId === agentId);

    const stats = this.computeStats(events, agent);
    const metrics = this.computeMetrics(stats);
    const overallScore = Math.round(
      metrics.speed.score * 0.2 +
        metrics.quality.score * 0.3 +
        metrics.tokenEfficiency.score * 0.2 +
        metrics.reliability.score * 0.2 +
        metrics.collaboration.score * 0.1,
    );

    return {
      agentId,
      agentRole: agent.role.id,
      overallScore,
      metrics,
      stats,
    };
  }

  /** Generate scorecards for all agents under a lead */
  getTeamScorecards(leadId: string): AgentScorecard[] {
    const agents = this.agentManager.getAll().filter((a) => {
      const aLeadId = a.parentId || a.id;
      return aLeadId === leadId && !isTerminalStatus(a.status);
    });
    return agents.map((a) => this.getScorecard(a.id)).filter((s): s is AgentScorecard => s !== null);
  }

  /** Get leaderboard sorted by overall score */
  getLeaderboard(leadId: string): AgentScorecard[] {
    return this.getTeamScorecards(leadId).sort((a, b) => b.overallScore - a.overallScore);
  }

  private computeStats(events: ActivityEntry[], agent: any) {
    const tasksCompleted = events.filter((e) => e.actionType === 'task_completed').length;
    const tasksFailed = events.filter((e) => e.actionType === 'error').length;
    const filesEdited = events.filter((e) => e.actionType === 'file_edit').length;
    const messagesSent = events.filter(
      (e) => e.actionType === 'message_sent' || e.actionType === 'group_message',
    ).length;
    const messagesReceived = events.filter((e) => e.actionType === 'delegated').length;
    const errorsEncountered = events.filter((e) => e.actionType === 'error').length;

    // Estimate active time from event timestamps
    const timestamps = events
      .map((e) => new Date(e.timestamp).getTime())
      .filter((t) => !isNaN(t))
      .sort((a, b) => a - b);
    let totalActiveTime = 0;
    for (let i = 1; i < timestamps.length; i++) {
      const gap = timestamps[i] - timestamps[i - 1];
      if (gap < 5 * 60_000) totalActiveTime += gap; // Count gaps < 5min as active
    }

    const totalTokensUsed = (agent as any).contextWindowUsed ?? 0;
    const avgTaskDuration = tasksCompleted > 0 ? totalActiveTime / tasksCompleted : 0;
    const tokensPerTask = tasksCompleted > 0 ? totalTokensUsed / tasksCompleted : 0;

    return {
      tasksCompleted,
      tasksFailed,
      totalActiveTime,
      avgTaskDuration,
      totalTokensUsed,
      tokensPerTask,
      messagesReceived,
      messagesSent,
      filesEdited,
      errorsEncountered,
    };
  }

  private computeMetrics(stats: ReturnType<typeof this.computeStats>) {
    // Speed: based on avg task duration (faster = better)
    const speedScore =
      stats.tasksCompleted === 0
        ? 50
        : stats.avgTaskDuration < 60_000
          ? 95
          : stats.avgTaskDuration < 180_000
            ? 85
            : stats.avgTaskDuration < 300_000
              ? 70
              : stats.avgTaskDuration < 600_000
                ? 55
                : 40;

    // Quality: based on error rate
    const total = stats.tasksCompleted + stats.tasksFailed;
    const errorRate = total > 0 ? stats.tasksFailed / total : 0;
    const qualityScore =
      total === 0
        ? 50
        : errorRate === 0
          ? 95
          : errorRate < 0.1
            ? 80
            : errorRate < 0.25
              ? 60
              : 40;

    // Token efficiency: tokens per task (lower = better)
    const effScore =
      stats.tasksCompleted === 0
        ? 50
        : stats.tokensPerTask < 5_000
          ? 95
          : stats.tokensPerTask < 15_000
            ? 80
            : stats.tokensPerTask < 30_000
              ? 65
              : stats.tokensPerTask < 50_000
                ? 50
                : 35;

    // Reliability: completion rate
    const reliabilityScore =
      total === 0 ? 50 : Math.round((stats.tasksCompleted / total) * 100);

    // Collaboration: message activity
    const collabScore =
      stats.messagesSent === 0 && stats.messagesReceived === 0
        ? 30
        : stats.messagesSent > 5
          ? 85
          : stats.messagesSent > 0
            ? 65
            : 50;

    const label = (s: number) =>
      s >= 90
        ? 'Excellent'
        : s >= 75
          ? 'Good'
          : s >= 60
            ? 'Fair'
            : s >= 40
              ? 'Below Average'
              : 'Poor';

    return {
      speed: {
        score: speedScore,
        label: label(speedScore),
        detail: `Avg task: ${Math.round(stats.avgTaskDuration / 1000)}s`,
      },
      quality: {
        score: qualityScore,
        label: label(qualityScore),
        detail: `${stats.tasksFailed} errors / ${total} tasks`,
      },
      tokenEfficiency: {
        score: effScore,
        label: label(effScore),
        detail: `${Math.round(stats.tokensPerTask)} tokens/task`,
      },
      reliability: {
        score: reliabilityScore,
        label: label(reliabilityScore),
        detail: `${stats.tasksCompleted}/${total} completed`,
      },
      collaboration: {
        score: collabScore,
        label: label(collabScore),
        detail: `${stats.messagesSent} messages sent`,
      },
    };
  }
}
