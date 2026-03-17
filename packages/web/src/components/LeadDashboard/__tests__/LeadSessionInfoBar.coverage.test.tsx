// @vitest-environment jsdom
/**
 * Coverage tests for LeadSessionInfoBar — export and copy button click handlers.
 * Lines 25-46 are uncovered (click handlers).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LeadSessionInfoBar } from '../LeadSessionInfoBar';
import type { AgentInfo } from '../../../types';

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'lead-1',
    role: { id: 'lead', name: 'Lead', icon: '👑', instructions: '' },
    status: 'running',
    childIds: [],
    createdAt: '2024-01-01',
    outputPreview: '',
    model: 'claude-sonnet-4',
    cwd: '/home/user/project',
    sessionId: 'sess-abc-123',
    ...overrides,
  } as AgentInfo;
}

describe('LeadSessionInfoBar — handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard and alert
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('copies sessionId to clipboard on copy click', () => {
    render(<LeadSessionInfoBar leadAgent={makeAgent()} selectedLeadId="lead-1" />);
    const copyBtn = screen.getByText('copy');
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('sess-abc-123');
  });

  it('shows success checkmark after copy', async () => {
    vi.useFakeTimers();
    render(<LeadSessionInfoBar leadAgent={makeAgent()} selectedLeadId="lead-1" />);
    const copyBtn = screen.getByText('copy');
    fireEvent.click(copyBtn);
    expect(copyBtn.textContent).toBe('✓');
    vi.advanceTimersByTime(2000);
    expect(copyBtn.textContent).toBe('copy');
    vi.useRealTimers();
  });

  it('exports session on export click (success)', async () => {
    mockApiFetch.mockResolvedValue({
      outputDir: '/tmp/export',
      files: ['a.json', 'b.json'],
      agentCount: 3,
      eventCount: 10,
    });
    render(<LeadSessionInfoBar leadAgent={makeAgent()} selectedLeadId="lead-1" />);
    const exportBtn = screen.getByTitle('Export session to disk');
    fireEvent.click(exportBtn);
    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/export/lead-1');
    });
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(
        expect.stringContaining('/tmp/export'),
      );
    });
  });

  it('shows error alert when export returns error', async () => {
    mockApiFetch.mockResolvedValue({ error: 'Disk full' });
    render(<LeadSessionInfoBar leadAgent={makeAgent()} selectedLeadId="lead-1" />);
    fireEvent.click(screen.getByTitle('Export session to disk'));
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Export failed: Disk full');
    });
  });

  it('shows generic error when export throws', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    render(<LeadSessionInfoBar leadAgent={makeAgent()} selectedLeadId="lead-1" />);
    fireEvent.click(screen.getByTitle('Export session to disk'));
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(
        'Export failed — server may be unavailable',
      );
    });
  });
});
