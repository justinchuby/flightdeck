import { logger } from '../utils/logger.js';

export interface CrashReport {
  agentId: string;
  agentRole: string;
  task?: string;
  crashedAt: number;
  error: string;
  stackTrace?: string;
  lastMessages: string[];  // Last N messages before crash
  contextUsage?: { used: number; total: number };
  uptime: number;          // ms since agent was created
  restartCount: number;
}

export class CrashForensics {
  private reports: CrashReport[] = [];
  private maxReports: number;
  private maxLastMessages: number;

  constructor(maxReports: number = 50, maxLastMessages: number = 10) {
    this.maxReports = maxReports;
    this.maxLastMessages = maxLastMessages;
  }

  /** Capture a crash report */
  capture(params: {
    agentId: string;
    agentRole: string;
    task?: string;
    error: string;
    stackTrace?: string;
    lastMessages?: string[];
    contextUsage?: { used: number; total: number };
    createdAt: number;
    restartCount: number;
  }): CrashReport {
    const report: CrashReport = {
      agentId: params.agentId,
      agentRole: params.agentRole,
      task: params.task,
      crashedAt: Date.now(),
      error: params.error,
      stackTrace: params.stackTrace?.slice(0, 2000),
      lastMessages: (params.lastMessages ?? []).slice(-this.maxLastMessages),
      contextUsage: params.contextUsage,
      uptime: Date.now() - params.createdAt,
      restartCount: params.restartCount,
    };

    this.reports.push(report);
    if (this.reports.length > this.maxReports) {
      this.reports = this.reports.slice(-this.maxReports);
    }

    logger.error('crash-forensics', `Agent ${params.agentId.slice(0, 8)} (${params.agentRole}) crashed: ${params.error}`, {
      task: params.task?.slice(0, 100),
      uptime: report.uptime,
      restarts: params.restartCount,
    });

    return report;
  }

  /** Get all crash reports, optionally filtered by agentId */
  getReports(agentId?: string): CrashReport[] {
    if (agentId) return this.reports.filter(r => r.agentId === agentId);
    return [...this.reports];
  }

  /** Get recent crashes (last N) */
  getRecent(count: number = 10): CrashReport[] {
    return this.reports.slice(-count);
  }

  /** Get crash frequency grouped by role */
  getCrashStats(): Record<string, { count: number; lastCrash: number }> {
    const stats: Record<string, { count: number; lastCrash: number }> = {};
    for (const report of this.reports) {
      const entry = stats[report.agentRole] ?? { count: 0, lastCrash: 0 };
      entry.count++;
      entry.lastCrash = Math.max(entry.lastCrash, report.crashedAt);
      stats[report.agentRole] = entry;
    }
    return stats;
  }

  get totalCrashes(): number { return this.reports.length; }
}
