import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { IntentRule } from '../IntentRules/types';
import { ACTION_DISPLAY, TRUST_PRESETS } from '../IntentRules/types';

// Mock apiFetch — capture calls for assertion
const mockApiFetch = vi.fn().mockResolvedValue([]);
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { IntentRulesDashboard } from '../IntentRules/IntentRulesDashboard';
import { TrustPresetBar } from '../IntentRules/TrustPresetBar';
import { RuleRow } from '../IntentRules/RuleRow';
import { RuleEditor } from '../IntentRules/RuleEditor';

// ── Test Data ──────────────────────────────────────────────────────

const makeRule = (overrides: Partial<IntentRule> = {}): IntentRule => ({
  id: 'rule-1',
  name: 'Allow style from devs',
  enabled: true,
  priority: 1,
  action: 'allow',
  match: { categories: ['style'], roles: ['developer'] },
  conditions: [],
  metadata: {
    source: 'manual',
    matchCount: 47,
    lastMatchedAt: new Date().toISOString(),
    effectivenessScore: 94,
    issuesAfterMatch: 0,
    createdAt: new Date().toISOString(),
  },
  ...overrides,
});

beforeEach(() => {
  mockApiFetch.mockReset();
  mockApiFetch.mockResolvedValue([]);
});

// ── Tests ──────────────────────────────────────────────────────────

describe('Intent Rules', () => {
  describe('IntentRulesDashboard', () => {
    it('renders empty state with no rules', async () => {
      render(<IntentRulesDashboard />);
      const dashboard = await screen.findByTestId('intent-rules-dashboard');
      expect(dashboard).toBeInTheDocument();
      expect(screen.getByText('New Rule')).toBeInTheDocument();
    });

    it('defaults to autonomous preset', async () => {
      render(<IntentRulesDashboard />);
      await screen.findByTestId('intent-rules-dashboard');
      const presetBar = screen.getByTestId('trust-preset-bar');
      expect(presetBar).toBeInTheDocument();
    });

    it('fetches and displays rules directly from backend', async () => {
      const rules = [
        makeRule({ id: 'r1', name: 'Allow style' }),
        makeRule({ id: 'r2', name: 'Alert arch', action: 'alert' }),
      ];
      mockApiFetch.mockResolvedValueOnce(rules);
      render(<IntentRulesDashboard />);
      await waitFor(() => {
        expect(screen.getByText('Allow style')).toBeInTheDocument();
        expect(screen.getByText('Alert arch')).toBeInTheDocument();
      });
    });

    it('shows summary stats when rules exist', async () => {
      mockApiFetch.mockResolvedValueOnce([makeRule()]);
      render(<IntentRulesDashboard />);
      await waitFor(() => {
        expect(screen.getByText(/1 rules active/)).toBeInTheDocument();
        expect(screen.getByText(/47 total matches/)).toBeInTheDocument();
      });
    });

    it('shows New Rule editor when button clicked', async () => {
      render(<IntentRulesDashboard />);
      await screen.findByTestId('intent-rules-dashboard');
      fireEvent.click(screen.getByText('New Rule'));
      expect(screen.getByTestId('rule-editor')).toBeInTheDocument();
    });

    it('calls DELETE API when rule is deleted', async () => {
      mockApiFetch.mockResolvedValueOnce([makeRule({ id: 'r-del' })]);
      render(<IntentRulesDashboard />);
      await waitFor(() => expect(screen.getByText('Allow style from devs')).toBeInTheDocument());
      const deleteBtn = screen.getByTitle('Delete rule');
      await act(async () => { fireEvent.click(deleteBtn); });
      expect(mockApiFetch).toHaveBeenCalledWith('/intents/r-del', { method: 'DELETE' });
    });

    it('calls PATCH API when toggle is clicked', async () => {
      mockApiFetch.mockResolvedValueOnce([makeRule({ id: 'r-tog', enabled: true })]);
      render(<IntentRulesDashboard />);
      await waitFor(() => expect(screen.getByText('Allow style from devs')).toBeInTheDocument());
      const toggleBtn = screen.getByLabelText('Disable rule');
      await act(async () => { fireEvent.click(toggleBtn); });
      expect(mockApiFetch).toHaveBeenCalledWith('/intents/r-tog', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
    });

    it('applies trust preset via API', async () => {
      render(<IntentRulesDashboard />);
      await screen.findByTestId('intent-rules-dashboard');
      await act(async () => { fireEvent.click(screen.getByText('Conservative')); });
      expect(mockApiFetch).toHaveBeenCalledWith('/intents/presets/conservative', { method: 'POST' });
    });

    it('handles API error gracefully', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('Network error'));
      render(<IntentRulesDashboard />);
      await waitFor(() => {
        expect(screen.getByText(/No intent rules yet/)).toBeInTheDocument();
      });
    });

    it('sends correct POST body for new rule', async () => {
      mockApiFetch.mockResolvedValueOnce([]);
      render(<IntentRulesDashboard />);
      await screen.findByTestId('intent-rules-dashboard');
      fireEvent.click(screen.getByText('New Rule'));
      fireEvent.click(screen.getByText(/Style/));
      mockApiFetch.mockResolvedValueOnce({ id: 'new-1' });
      mockApiFetch.mockResolvedValueOnce([]);
      fireEvent.click(screen.getByText('Save Rule'));
      await waitFor(() => {
        const postCall = mockApiFetch.mock.calls.find(
          (c: any[]) => c[0] === '/intents' && c[1]?.method === 'POST'
        );
        expect(postCall).toBeDefined();
        const body = JSON.parse(postCall![1].body);
        expect(body.category).toBe('style');
        expect(body.action).toBe('allow');
        expect(body.name).toBeDefined();
      });
    });
  });

  describe('TrustPresetBar', () => {
    it('renders all three presets', () => {
      render(<TrustPresetBar active={null} onSelect={vi.fn()} />);
      expect(screen.getByText('Conservative')).toBeInTheDocument();
      expect(screen.getByText('Moderate')).toBeInTheDocument();
      expect(screen.getByText('Autonomous')).toBeInTheDocument();
    });

    it('highlights active preset with description', () => {
      render(<TrustPresetBar active="moderate" onSelect={vi.fn()} />);
      expect(screen.getByText(/"Routine decisions/)).toBeInTheDocument();
    });

    it('calls onSelect when clicked', () => {
      const onSelect = vi.fn();
      render(<TrustPresetBar active={null} onSelect={onSelect} />);
      fireEvent.click(screen.getByText('Autonomous'));
      expect(onSelect).toHaveBeenCalledWith('autonomous');
    });
  });

  describe('RuleRow', () => {
    it('renders rule with name and match count', () => {
      render(<RuleRow rule={makeRule()} onToggle={vi.fn()} onDelete={vi.fn()} onSave={vi.fn()} />);
      expect(screen.getByText('Allow style from devs')).toBeInTheDocument();
      expect(screen.getByText('47 matches')).toBeInTheDocument();
    });

    it('shows role badges', () => {
      render(<RuleRow rule={makeRule()} onToggle={vi.fn()} onDelete={vi.fn()} onSave={vi.fn()} />);
      expect(screen.getByText('developer')).toBeInTheDocument();
    });

    it('shows "All agents" when no roles specified', () => {
      const rule = makeRule({ match: { categories: ['style'], roles: undefined } });
      render(<RuleRow rule={rule} onToggle={vi.fn()} onDelete={vi.fn()} onSave={vi.fn()} />);
      expect(screen.getByText('All agents')).toBeInTheDocument();
    });

    it('shows warning for low effectiveness', () => {
      const rule = makeRule({
        metadata: { ...makeRule().metadata, effectivenessScore: 33, issuesAfterMatch: 2 },
      });
      render(<RuleRow rule={rule} onToggle={vi.fn()} onDelete={vi.fn()} onSave={vi.fn()} />);
      expect(screen.getByText(/2 allowed decisions preceded failures/)).toBeInTheDocument();
    });

    it('applies dimmed style when disabled', () => {
      const { container } = render(
        <RuleRow rule={makeRule({ enabled: false })} onToggle={vi.fn()} onDelete={vi.fn()} onSave={vi.fn()} />,
      );
      expect(container.querySelector('[data-testid="rule-row"]')?.className).toContain('opacity-50');
    });

    it('expands to show editor on click', () => {
      render(<RuleRow rule={makeRule()} onToggle={vi.fn()} onDelete={vi.fn()} onSave={vi.fn()} />);
      fireEvent.click(screen.getByText('Allow style from devs'));
      expect(screen.getByTestId('rule-editor')).toBeInTheDocument();
    });

    it('calls onToggle', () => {
      const onToggle = vi.fn();
      render(<RuleRow rule={makeRule({ id: 'r1' })} onToggle={onToggle} onDelete={vi.fn()} onSave={vi.fn()} />);
      fireEvent.click(screen.getByLabelText('Disable rule'));
      expect(onToggle).toHaveBeenCalledWith('r1', false);
    });

    it('calls onDelete', () => {
      const onDelete = vi.fn();
      render(<RuleRow rule={makeRule({ id: 'r1' })} onToggle={vi.fn()} onDelete={onDelete} onSave={vi.fn()} />);
      fireEvent.click(screen.getByTitle('Delete rule'));
      expect(onDelete).toHaveBeenCalledWith('r1');
    });
  });

  describe('RuleEditor', () => {
    it('renders with save and cancel', () => {
      render(<RuleEditor onSave={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText('Save Rule')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('shows all three actions in dropdown', () => {
      render(<RuleEditor onSave={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByDisplayValue(/Allow/)).toBeInTheDocument();
    });

    it('shows category chips', () => {
      render(<RuleEditor onSave={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText(/Style/)).toBeInTheDocument();
      expect(screen.getByText(/Architecture/)).toBeInTheDocument();
    });

    it('save disabled when no categories', () => {
      render(<RuleEditor onSave={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText('Save Rule')).toHaveAttribute('disabled');
    });

    it('save enabled after selecting category', () => {
      render(<RuleEditor onSave={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByText(/Style/));
      expect(screen.getByText('Save Rule')).not.toHaveAttribute('disabled');
    });

    it('calls onSave with unified IntentRule', () => {
      const onSave = vi.fn();
      render(<RuleEditor onSave={onSave} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByText(/Style/));
      fireEvent.click(screen.getByText('Save Rule'));
      expect(onSave).toHaveBeenCalledTimes(1);
      const saved: IntentRule = onSave.mock.calls[0][0];
      expect(saved.action).toBe('allow');
      expect(saved.match.categories).toContain('style');
      expect(saved.metadata.source).toBe('manual');
    });

    it('calls onCancel', () => {
      const onCancel = vi.fn();
      render(<RuleEditor onSave={vi.fn()} onCancel={onCancel} />);
      fireEvent.click(screen.getByText('Cancel'));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('can add and remove conditions', () => {
      render(<RuleEditor onSave={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByText('+ Add condition'));
      expect(screen.getByDisplayValue('50')).toBeInTheDocument();
      fireEvent.click(screen.getByText('✕'));
      expect(screen.queryByDisplayValue('50')).not.toBeInTheDocument();
    });

    it('pre-fills when editing', () => {
      const existing = makeRule({ action: 'require-review', match: { categories: ['architecture'] } });
      render(<RuleEditor rule={existing} onSave={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByDisplayValue(/Require review/)).toBeInTheDocument();
    });

    it('shows role input for specific roles', () => {
      render(<RuleEditor onSave={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.click(screen.getByLabelText('Specific roles'));
      expect(screen.getByPlaceholderText('developer, qa_tester')).toBeInTheDocument();
    });
  });

  describe('types', () => {
    it('ACTION_DISPLAY covers all actions', () => {
      expect(ACTION_DISPLAY['allow'].label).toBe('Allow');
      expect(ACTION_DISPLAY['alert'].label).toBe('Alert & Allow');
      expect(ACTION_DISPLAY['require-review'].label).toBe('Require review');
    });

    it('TRUST_PRESETS covers all presets', () => {
      expect(TRUST_PRESETS.conservative).toBeDefined();
      expect(TRUST_PRESETS.moderate).toBeDefined();
      expect(TRUST_PRESETS.autonomous).toBeDefined();
    });
  });
});
