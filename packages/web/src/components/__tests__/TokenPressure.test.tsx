// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useAppStore } from '../../stores/appStore';
import type { AgentInfo, Role } from '../../types';
import { TokenEconomics } from '../TokenEconomics/TokenEconomics';
import { detectAlerts } from '../MissionControl/AlertsPanel';

afterEach(cleanup);

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'developer',
    name: 'Developer',
    description: 'Writes code',
    systemPrompt: '',
    color: '#3B82F6',
    icon: '💻',
    builtIn: true,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: `agent-${Math.random().toString(36).slice(2, 10)}`,
    role: makeRole(),
    status: 'running',
    childIds: [],
    createdAt: new Date().toISOString(),
    outputPreview: '',
    ...overrides,
  };
}

beforeEach(() => {
  useAppStore.getState().setAgents([]);
});

describe('TokenEconomics — hidden state (issue #106)', () => {
  it('shows hidden notice instead of burn rate data', () => {
    useAppStore.getState().setAgents([
      makeAgent({
        inputTokens: 100_000,
        outputTokens: 50_000,
        contextWindowSize: 200_000,
        contextWindowUsed: 120_000,
        contextBurnRate: 50,
        estimatedExhaustionMinutes: 8,
      }),
    ]);
    render(<TokenEconomics />);
    expect(screen.getByTestId('token-economics-hidden')).toBeDefined();
    expect(screen.queryByText('~3.0k/min')).toBeNull();
  });

  it('does not render token table or burn rate column', () => {
    useAppStore.getState().setAgents([
      makeAgent({ inputTokens: 1000, outputTokens: 500 }),
    ]);
    render(<TokenEconomics />);
    expect(screen.queryByText('Burn Rate')).toBeNull();
    expect(screen.getByTestId('token-economics-hidden')).toBeDefined();
  });
});

describe('detectAlerts — context pressure (informational)', () => {
  it('shows info alert at 95%+ context (no action buttons)', () => {
    const agents = [
      makeAgent({
        contextWindowSize: 200_000,
        contextWindowUsed: 192_000, // 96%
        contextBurnRate: 100,
        estimatedExhaustionMinutes: 3,
      }),
    ];
    const alerts = detectAlerts(agents, [], null);
    const ctxAlert = alerts.find((a) => a.id.startsWith('ctx-'));
    expect(ctxAlert).toBeDefined();
    expect(ctxAlert!.severity).toBe('info');
    expect(ctxAlert!.actions).toBeUndefined();
    expect(ctxAlert!.detail).toContain('compact automatically');
  });

  it('does NOT alert at 85% — threshold raised to 95%', () => {
    const agents = [
      makeAgent({
        contextWindowSize: 200_000,
        contextWindowUsed: 180_000, // 90%
        contextBurnRate: 100,
        estimatedExhaustionMinutes: 7,
      }),
    ];
    const alerts = detectAlerts(agents, [], null);
    const ctxAlert = alerts.find((a) => a.id.startsWith('ctx-'));
    expect(ctxAlert).toBeUndefined();
  });

  it('does NOT fire burn-rate alerts — Copilot handles context automatically', () => {
    const agents = [
      makeAgent({
        contextWindowSize: 200_000,
        contextWindowUsed: 100_000, // 50%
        contextBurnRate: 500,
        estimatedExhaustionMinutes: 3,
      }),
    ];
    const alerts = detectAlerts(agents, [], null);
    const burnAlert = alerts.find((a) => a.id.startsWith('burn-'));
    expect(burnAlert).toBeUndefined();
  });

  it('includes burn rate info when alert fires', () => {
    const agents = [
      makeAgent({
        contextWindowSize: 200_000,
        contextWindowUsed: 196_000, // 98%
        contextBurnRate: 50,
        estimatedExhaustionMinutes: 7,
      }),
    ];
    const alerts = detectAlerts(agents, [], null);
    const ctxAlert = alerts.find((a) => a.id.startsWith('ctx-'));
    expect(ctxAlert).toBeDefined();
    expect(ctxAlert!.detail).toContain('tok/min');
    expect(ctxAlert!.detail).toContain('min remaining');
  });
});
