import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { RecoveryEvent, RecoveryMetrics } from '../Recovery/types';
import { STATUS_DISPLAY, TRIGGER_LABELS } from '../Recovery/types';

// Mock apiFetch
vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
}));

import { PulseRecoveryIndicator } from '../Recovery/PulseRecoveryIndicator';
import { RecoveryBriefingCard } from '../Recovery/RecoveryBriefingCard';
import { TimelineRecoveryMarker } from '../Recovery/TimelineRecoveryMarker';
import { RecoveryMetricsCard } from '../Recovery/RecoveryMetricsCard';

// ── Test Data ──────────────────────────────────────────────────────

const makeEvent = (overrides: Partial<RecoveryEvent> = {}): RecoveryEvent => ({
  id: 'rec-001',
  sessionId: 'session-1',
  originalAgentId: 'agent-dev-12345678',
  replacementAgentId: null,
  trigger: 'crash',
  status: 'generating_briefing',
  briefing: {
    id: 'brief-1',
    narrative: 'Dev agent was implementing auth endpoints. 3 of 5 complete.',
    lastMessages: [{ role: 'Developer', content: 'Working on auth...' }],
    currentTask: { id: 'task-7', title: 'API refactor', progress: '60% complete' },
    uncommittedChanges: [{ file: 'src/api/users.ts', additions: 47, deletions: 3 }],
    activeIntentRules: ['Auto-approve style'],
    discoveries: ['User service needs pagination'],
    contextUsageAtCrash: 96,
  },
  attempts: 1,
  startedAt: new Date(Date.now() - 10_000).toISOString(),
  recoveredAt: null,
  failedAt: null,
  preservedFiles: ['src/api/users.ts'],
  transferredLocks: ['src/api/users.ts'],
  ...overrides,
});

const makeMetrics = (overrides: Partial<RecoveryMetrics> = {}): RecoveryMetrics => ({
  sessionId: 'session-1',
  totalCrashes: 3,
  totalRecoveries: 3,
  successRate: 100,
  avgRecoveryTimeMs: 12_000,
  tasksCompletedPostRecovery: 3,
  tasksAssignedPostRecovery: 3,
  ...overrides,
});

// ── Tests ──────────────────────────────────────────────────────────

describe('Self-Healing Crews', () => {
  describe('PulseRecoveryIndicator', () => {
    it('renders nothing when no events', () => {
      const { container } = render(<PulseRecoveryIndicator events={[]} />);
      expect(container.innerHTML).toBe('');
    });

    it('shows recovering state for active event', () => {
      render(<PulseRecoveryIndicator events={[makeEvent()]} />);
      expect(screen.getByTestId('pulse-recovery-indicator')).toBeInTheDocument();
      expect(screen.getByText(/agent-de.*recovering/i)).toBeInTheDocument();
    });

    it('shows count when multiple agents recovering', () => {
      const events = [
        makeEvent({ id: 'r1', originalAgentId: 'agent-aaa' }),
        makeEvent({ id: 'r2', originalAgentId: 'agent-bbb' }),
      ];
      render(<PulseRecoveryIndicator events={events} />);
      expect(screen.getByText('2 agents recovering...')).toBeInTheDocument();
    });

    it('shows failed state', () => {
      render(
        <PulseRecoveryIndicator
          events={[makeEvent({ status: 'failed', failedAt: new Date().toISOString() })]}
        />,
      );
      expect(screen.getByText(/recovery failed/i)).toBeInTheDocument();
    });
  });

  describe('RecoveryBriefingCard', () => {
    it('renders briefing content', () => {
      render(<RecoveryBriefingCard event={makeEvent({ status: 'awaiting_review' })} />);
      expect(screen.getByTestId('recovery-briefing-card')).toBeInTheDocument();
      expect(screen.getByText(/implementing auth endpoints/)).toBeInTheDocument();
      expect(screen.getByText(/API refactor.*60%/)).toBeInTheDocument();
    });

    it('shows edit/approve/cancel buttons', () => {
      render(<RecoveryBriefingCard event={makeEvent({ status: 'awaiting_review' })} />);
      expect(screen.getByText('Edit Briefing')).toBeInTheDocument();
      expect(screen.getByText('Approve & Restart')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('enters edit mode on Edit click', () => {
      render(<RecoveryBriefingCard event={makeEvent({ status: 'awaiting_review' })} />);
      fireEvent.click(screen.getByText('Edit Briefing'));
      expect(screen.getByText('Save & Restart →')).toBeInTheDocument();
    });
  });

  describe('TimelineRecoveryMarker', () => {
    it('renders marker with agent label', () => {
      render(<TimelineRecoveryMarker event={makeEvent()} />);
      expect(screen.getByTestId('timeline-recovery-marker')).toBeInTheDocument();
      expect(screen.getByText('agent-de')).toBeInTheDocument();
    });

    it('shows replacement agent when different ID', () => {
      render(<TimelineRecoveryMarker event={makeEvent({ replacementAgentId: 'agent-new-99999999' })} />);
      expect(screen.getByText('→ agent-ne')).toBeInTheDocument();
    });
  });

  describe('RecoveryMetricsCard', () => {
    it('shows celebration for zero crashes', () => {
      render(<RecoveryMetricsCard metrics={makeMetrics({ totalCrashes: 0 })} />);
      expect(screen.getByText('Zero crashes this session')).toBeInTheDocument();
    });

    it('renders stats for active crashes', () => {
      render(<RecoveryMetricsCard metrics={makeMetrics()} />);
      expect(screen.getByText('3')).toBeInTheDocument(); // crashes
      expect(screen.getByText('100%')).toBeInTheDocument(); // rate
      expect(screen.getByText('12.0s')).toBeInTheDocument(); // avg time
      expect(screen.getByText('3/3')).toBeInTheDocument(); // tasks
    });

    it('shows trigger breakdown', () => {
      render(
        <RecoveryMetricsCard
          metrics={makeMetrics()}
          triggerBreakdown={{ context_exhaustion: 2, unresponsive: 1 }}
        />,
      );
      expect(screen.getByText('Context exhaustion')).toBeInTheDocument();
      expect(screen.getByText('Unresponsive')).toBeInTheDocument();
    });
  });

  describe('types', () => {
    it('STATUS_DISPLAY covers all states', () => {
      const states = ['detecting', 'generating_briefing', 'awaiting_review', 'restarting', 'recovered', 'failed'];
      for (const s of states) {
        expect(STATUS_DISPLAY[s as keyof typeof STATUS_DISPLAY]).toBeDefined();
      }
    });

    it('TRIGGER_LABELS covers all triggers', () => {
      expect(TRIGGER_LABELS.crash).toBe('Crash');
      expect(TRIGGER_LABELS.context_exhaustion).toBe('Context exhaustion');
    });
  });
});
