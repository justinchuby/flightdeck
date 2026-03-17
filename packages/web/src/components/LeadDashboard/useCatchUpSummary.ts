import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentComm, AgentReport } from '../../stores/leadStore';
import type { Decision } from '../../types';
import type { CatchUpSummary } from './ChatMessages';

const EMPTY_DECISIONS: Decision[] = [];
const EMPTY_COMMS: AgentComm[] = [];
const EMPTY_REPORTS: AgentReport[] = [];

export function useCatchUpSummary(
  selectedLeadId: string | null,
  effectiveLeadId: string | null | undefined,
  agents: Array<{ id: string; parentId?: string; status: string }>,
  currentProject: { decisions?: Decision[]; comms?: AgentComm[]; agentReports?: AgentReport[] } | null,
) {
  const lastInteractionRef = useRef(Date.now());
  const snapshotRef = useRef<{ tasks: number; decisions: number; comms: number; reports: number }>({ tasks: 0, decisions: 0, comms: 0, reports: 0 });
  const [catchUpSummary, setCatchUpSummary] = useState<CatchUpSummary | null>(null);

  // Track user interactions
  useEffect(() => {
    const markActive = () => {
      lastInteractionRef.current = Date.now();
    };
    const markScroll = () => {
      lastInteractionRef.current = Date.now();
      // Auto-dismiss banner on scroll (designer spec)
      if (catchUpSummary) setCatchUpSummary(null);
    };
    window.addEventListener('click', markActive);
    window.addEventListener('keydown', markActive);
    window.addEventListener('scroll', markScroll, true);
    return () => {
      window.removeEventListener('click', markActive);
      window.removeEventListener('keydown', markActive);
      window.removeEventListener('scroll', markScroll, true);
    };
  }, [catchUpSummary]);

  // Snapshot current counts on each interaction; check for inactivity on data changes
  useEffect(() => {
    if (!currentProject) return;
    const currentCounts = {
      tasks: agents.filter(a => a.parentId === effectiveLeadId && (a.status === 'completed' || a.status === 'failed')).length,
      decisions: (currentProject.decisions ?? EMPTY_DECISIONS).filter((d: Decision) => d.needsConfirmation && d.status === 'recorded').length,
      comms: (currentProject.comms ?? EMPTY_COMMS).length,
      reports: (currentProject.agentReports ?? EMPTY_REPORTS).length,
    };
    const elapsed = Date.now() - lastInteractionRef.current;
    if (elapsed >= 60_000 && !catchUpSummary) {
      const prev = snapshotRef.current;
      const tasksCompleted = Math.max(0, currentCounts.tasks - prev.tasks);
      const newMessages = Math.max(0, currentCounts.comms - prev.comms);
      const newReports = Math.max(0, currentCounts.reports - prev.reports);
      const totalNew = tasksCompleted + newMessages + newReports;
      if (totalNew >= 5 || currentCounts.decisions > 0) {
        setCatchUpSummary({ tasksCompleted, pendingDecisions: currentCounts.decisions, newMessages, newReports });
      }
    }
    // Always update snapshot when user is active
    if (elapsed < 60_000) {
      snapshotRef.current = currentCounts;
    }
  }, [agents, currentProject, selectedLeadId, catchUpSummary]);

  // Reset snapshot when switching projects
  useEffect(() => {
    snapshotRef.current = { tasks: 0, decisions: 0, comms: 0, reports: 0 };
    setCatchUpSummary(null);
  }, [selectedLeadId]);

  const dismissCatchUp = useCallback(() => setCatchUpSummary(null), []);

  return { catchUpSummary, dismissCatchUp };
}
