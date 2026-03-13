import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertEngine } from '../coordination/alerts/AlertEngine.js';
import type { Alert, AlertAction } from '../coordination/alerts/AlertEngine.js';

describe('AlertEngine — Actionable Alerts', () => {
  it('Alert interface supports actions array', () => {
    const action: AlertAction = {
      label: 'Compress context',
      description: 'Restart agent with context handoff',
      actionType: 'api_call',
      endpoint: '/api/agents/123/restart',
      method: 'POST',
      confidence: 90,
    };

    const alert: Alert = {
      id: 1,
      type: 'context_pressure',
      severity: 'warning',
      message: 'Agent at 90%',
      timestamp: new Date().toISOString(),
      agentId: 'agent-123',
      actions: [action],
    };

    expect(alert.actions).toHaveLength(1);
    expect(alert.actions![0].label).toBe('Compress context');
    expect(alert.actions![0].confidence).toBe(90);
  });

  it('AlertAction supports optional body and confidence fields', () => {
    const action: AlertAction = {
      label: 'Switch model',
      description: 'Change to a larger model',
      actionType: 'api_call',
      endpoint: '/api/agents/123',
      method: 'POST',
      body: { model: 'claude-opus-4.6-1m' },
      confidence: 70,
    };

    expect(action.body).toEqual({ model: 'claude-opus-4.6-1m' });
    expect(action.confidence).toBe(70);
  });

  it('Alert without actions is valid (backwards compatible)', () => {
    const alert: Alert = {
      id: 2,
      type: 'stuck_agent',
      severity: 'info',
      message: 'Agent stuck',
      timestamp: new Date().toISOString(),
    };

    expect(alert.actions).toBeUndefined();
  });

  it('Dismiss action uses dismiss actionType (client-side only)', () => {
    const dismiss: AlertAction = {
      label: 'Dismiss',
      description: 'Ignore this alert',
      actionType: 'dismiss',
      endpoint: '',
      method: 'POST',
      confidence: 10,
    };

    expect(dismiss.actionType).toBe('dismiss');
    expect(dismiss.confidence).toBe(10);
  });

  it('actions can be sorted by confidence descending', () => {
    const actions: AlertAction[] = [
      { label: 'Dismiss', description: '', actionType: 'dismiss', endpoint: '', method: 'POST', confidence: 10 },
      { label: 'Compress', description: '', actionType: 'api_call', endpoint: '/api/restart', method: 'POST', confidence: 90 },
      { label: 'Switch', description: '', actionType: 'api_call', endpoint: '/api/model', method: 'POST', confidence: 70 },
    ];

    const sorted = [...actions].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    expect(sorted[0].label).toBe('Compress');
    expect(sorted[1].label).toBe('Switch');
    expect(sorted[2].label).toBe('Dismiss');
  });

  it('AlertEngine attaches actions to context pressure alerts', () => {
    const highPressureAgent = {
      id: 'agent-high',
      role: { id: 'developer', name: 'Developer' },
      status: 'running',
      contextWindowSize: 100_000,
      contextWindowUsed: 90_000,
      estimatedExhaustionMinutes: 5,
      createdAt: new Date(Date.now() - 600_000),
      isPrompting: false,
      promptingStartedAt: null,
    };

    const mockAgentManager = { getAll: () => [highPressureAgent], getProjectIdForAgent: () => 'proj-1' };
    const mockLockRegistry = { getAll: () => [] };
    const mockDecisionLog = { getAll: () => [], getNeedingConfirmation: () => [] };
    const mockActivityLedger = { on: vi.fn(), off: vi.fn() };
    const mockTaskDAG = { getTasks: () => [] };

    const engine = new AlertEngine(
      mockAgentManager as any,
      mockLockRegistry as any,
      mockDecisionLog as any,
      mockActivityLedger as any,
      mockTaskDAG as any,
    );

    const emittedAlerts: Alert[] = [];
    engine.on('alert', (alert: Alert) => emittedAlerts.push(alert));
    engine.start();

    // Find context_pressure alerts
    const pressureAlerts = engine.getAlerts().filter(a => a.type === 'context_pressure');
    expect(pressureAlerts.length).toBeGreaterThanOrEqual(1);

    const alert = pressureAlerts[0];
    expect(alert.actions).toBeDefined();
    expect(alert.actions!.length).toBe(3);
    expect(alert.actions![0].actionType).toBe('api_call');
    expect(alert.actions![0].endpoint).toContain('/compact');
    expect(alert.actions![1].actionType).toBe('api_call');
    expect(alert.actions![1].endpoint).toContain('/restart');
    expect(alert.actions![2].actionType).toBe('dismiss');

    engine.stop();
  });
});
