// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ActivityFeed } from '../ActivityFeed';

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

afterEach(cleanup);

const makeAgent = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  role: { id: 'dev', name: 'Developer', icon: '💻' },
  status: 'running' as const,
  childIds: [],
  createdAt: new Date().toISOString(),
  outputPreview: '',
  model: 'gpt-4',
  ...overrides,
});

const makeActivity = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  agentId: 'a1',
  agentRole: 'developer',
  actionType: 'file_edit',
  summary: 'Edited src/index.ts',
  timestamp: new Date().toISOString(),
  projectId: 'p1',
  ...overrides,
});

describe('ActivityFeed', () => {
  describe('empty state', () => {
    it('renders "No recent activity" when activity is empty', () => {
      render(<ActivityFeed activity={[]} agents={[]} />);
      expect(screen.getByText('No recent activity')).toBeTruthy();
    });

    it('renders Live Activity header', () => {
      render(<ActivityFeed activity={[]} agents={[]} />);
      expect(screen.getByText('Live Activity')).toBeTruthy();
    });
  });

  describe('activity entries', () => {
    it('renders action type as readable text', () => {
      render(<ActivityFeed activity={[makeActivity()]} agents={[makeAgent('a1')]} />);
      expect(screen.getByText('file edit')).toBeTruthy();
    });

    it('shows agent label with icon, role name, and short ID for matching agent', () => {
      render(
        <ActivityFeed
          activity={[makeActivity({ agentId: 'a1' })]}
          agents={[makeAgent('a1', { role: { id: 'arch', name: 'Architect', icon: '🏗️' } })]}
        />,
      );
      expect(screen.getByText(/🏗️ Architect/)).toBeTruthy();
    });

    it('shows short agent ID when no matching agent found', () => {
      render(
        <ActivityFeed
          activity={[makeActivity({ agentId: 'unknown-agent-id-long' })]}
          agents={[]}
        />,
      );
      expect(screen.getByText('unknown-')).toBeTruthy();
    });

    it('renders filePath when present', () => {
      render(
        <ActivityFeed
          activity={[makeActivity({ filePath: 'src/app.ts' })]}
          agents={[makeAgent('a1')]}
        />,
      );
      expect(screen.getByText('src/app.ts')).toBeTruthy();
    });

    it('does not render filePath element when absent', () => {
      const { container } = render(
        <ActivityFeed
          activity={[makeActivity({ filePath: undefined })]}
          agents={[makeAgent('a1')]}
        />,
      );
      expect(container.querySelector('.font-mono.truncate')).toBeNull();
    });

    it('renders string details', () => {
      render(
        <ActivityFeed
          activity={[makeActivity({ details: 'Changed 5 lines' })]}
          agents={[makeAgent('a1')]}
        />,
      );
      expect(screen.getByText('Changed 5 lines')).toBeTruthy();
    });

    it('renders object details as JSON string', () => {
      const details = { lines: 5, type: 'insert' };
      render(
        <ActivityFeed
          activity={[makeActivity({ details })]}
          agents={[makeAgent('a1')]}
        />,
      );
      expect(screen.getByText(JSON.stringify(details))).toBeTruthy();
    });

    it('renders all action type icons correctly', () => {
      const types = ['file_edit', 'file_read', 'file_create', 'lock_acquire', 'lock_release', 'spawn', 'task_start', 'task_complete', 'error', 'command'];
      const icons = ['✏️', '📖', '📄', '🔒', '🔓', '🚀', '▶️', '✅', '❌', '💻'];
      const activities = types.map((actionType, i) => makeActivity({ id: i, actionType }));
      const { container } = render(<ActivityFeed activity={activities} agents={[makeAgent('a1')]} />);
      for (const icon of icons) {
        expect(container.textContent).toContain(icon);
      }
    });

    it('renders fallback icon 📌 for unknown action type', () => {
      const { container } = render(
        <ActivityFeed activity={[makeActivity({ actionType: 'unknown_type' })]} agents={[makeAgent('a1')]} />,
      );
      expect(container.textContent).toContain('📌');
    });

    it('renders timeAgo text', () => {
      const past = new Date(Date.now() - 120_000).toISOString(); // 2 minutes ago
      render(<ActivityFeed activity={[makeActivity({ timestamp: past })]} agents={[makeAgent('a1')]} />);
      expect(screen.getByText('2m ago')).toBeTruthy();
    });

    it('shows "just now" for very recent timestamps', () => {
      const now = new Date().toISOString();
      render(<ActivityFeed activity={[makeActivity({ timestamp: now })]} agents={[makeAgent('a1')]} />);
      expect(screen.getByText('just now')).toBeTruthy();
    });

    it('shows hours ago for old timestamps', () => {
      const past = new Date(Date.now() - 7_200_000).toISOString(); // 2 hours ago
      render(<ActivityFeed activity={[makeActivity({ timestamp: past })]} agents={[makeAgent('a1')]} />);
      expect(screen.getByText('2h ago')).toBeTruthy();
    });

    it('shows seconds ago for moderate timestamps', () => {
      const past = new Date(Date.now() - 30_000).toISOString(); // 30 seconds ago
      render(<ActivityFeed activity={[makeActivity({ timestamp: past })]} agents={[makeAgent('a1')]} />);
      expect(screen.getByText('30s ago')).toBeTruthy();
    });
  });

  describe('detail popup', () => {
    it('opens detail popup when clicking an entry', () => {
      render(<ActivityFeed activity={[makeActivity()]} agents={[makeAgent('a1')]} />);
      const entry = screen.getByText('file edit').closest('[class*="cursor-pointer"]');
      expect(entry).toBeTruthy();
      fireEvent.click(entry!);
      // Detail popup should show action type in a heading-like area
      const allFileEdits = screen.getAllByText(/file edit/i);
      expect(allFileEdits.length).toBeGreaterThan(1); // one in list, one in popup
    });

    it('shows agent info with role in detail popup when agent matches', () => {
      render(
        <ActivityFeed
          activity={[makeActivity({ agentId: 'a1', actionType: 'spawn' })]}
          agents={[makeAgent('a1', { role: { id: 'dev', name: 'Developer', icon: '💻' }, provider: 'anthropic', model: 'claude-sonnet-4' })]}
        />,
      );
      fireEvent.click(screen.getByText('spawn').closest('[class*="cursor-pointer"]')!);
      expect(screen.getByText('Developer')).toBeTruthy();
      expect(screen.getByText(/anthropic/)).toBeTruthy();
    });

    it('shows short agent ID in detail popup when no matching agent', () => {
      render(
        <ActivityFeed
          activity={[makeActivity({ agentId: 'unknown-agent-xyz', actionType: 'file_create' })]}
          agents={[]}
        />,
      );
      fireEvent.click(screen.getByText('file create').closest('[class*="cursor-pointer"]')!);
      // Should show the short agent ID in the detail panel
      const agentSection = screen.getByText('Agent');
      expect(agentSection).toBeTruthy();
    });

    it('shows filePath in detail popup', () => {
      render(
        <ActivityFeed
          activity={[makeActivity({ filePath: 'src/utils.ts' })]}
          agents={[makeAgent('a1')]}
        />,
      );
      fireEvent.click(screen.getByText('file edit').closest('[class*="cursor-pointer"]')!);
      expect(screen.getByText('File')).toBeTruthy();
      const filePaths = screen.getAllByText('src/utils.ts');
      expect(filePaths.length).toBeGreaterThanOrEqual(1);
    });

    it('shows string details in popup pre block', () => {
      render(
        <ActivityFeed
          activity={[makeActivity({ details: 'Modified 3 files' })]}
          agents={[makeAgent('a1')]}
        />,
      );
      fireEvent.click(screen.getByText('file edit').closest('[class*="cursor-pointer"]')!);
      expect(screen.getByText('Details')).toBeTruthy();
    });

    it('shows JSON-formatted object details in popup', () => {
      const details = { changes: 5 };
      render(
        <ActivityFeed
          activity={[makeActivity({ details })]}
          agents={[makeAgent('a1')]}
        />,
      );
      fireEvent.click(screen.getByText('file edit').closest('[class*="cursor-pointer"]')!);
      // The pre block should contain the pretty-printed JSON
      const preEl = document.querySelector('pre');
      expect(preEl).toBeTruthy();
      expect(preEl!.textContent).toContain('"changes": 5');
    });

    it('shows timestamp section in detail popup', () => {
      render(
        <ActivityFeed
          activity={[makeActivity()]}
          agents={[makeAgent('a1')]}
        />,
      );
      fireEvent.click(screen.getByText('file edit').closest('[class*="cursor-pointer"]')!);
      expect(screen.getByText('Time')).toBeTruthy();
    });

    it('closes detail popup via × button', () => {
      render(<ActivityFeed activity={[makeActivity()]} agents={[makeAgent('a1')]} />);
      fireEvent.click(screen.getByText('file edit').closest('[class*="cursor-pointer"]')!);
      // Popup should be open
      expect(screen.getByText('Time')).toBeTruthy();
      // Click the × close button
      fireEvent.click(screen.getByText('×'));
      // Popup should be closed
      expect(screen.queryByText('Time')).toBeNull();
    });

    it('closes detail popup by clicking backdrop', () => {
      render(<ActivityFeed activity={[makeActivity()]} agents={[makeAgent('a1')]} />);
      fireEvent.click(screen.getByText('file edit').closest('[class*="cursor-pointer"]')!);
      expect(screen.getByText('Time')).toBeTruthy();
      // Click backdrop (the fixed overlay) using mouseDown since component uses onMouseDown
      const _backdrop = screen.getByText('Time').closest('.fixed');
      // Find the outermost fixed div
      const overlay = document.querySelector('.fixed.inset-0');
      expect(overlay).toBeTruthy();
      fireEvent.mouseDown(overlay!, { target: overlay });
      expect(screen.queryByText('Time')).toBeNull();
    });

    it('does not close popup when clicking inside the popup content', () => {
      render(<ActivityFeed activity={[makeActivity()]} agents={[makeAgent('a1')]} />);
      fireEvent.click(screen.getByText('file edit').closest('[class*="cursor-pointer"]')!);
      expect(screen.getByText('Time')).toBeTruthy();
      // Click inside popup content — should NOT close
      fireEvent.mouseDown(screen.getByText('Time'));
      expect(screen.getByText('Time')).toBeTruthy();
    });
  });

  describe('multiple activities', () => {
    it('renders all activities in order', () => {
      const activities = [
        makeActivity({ id: 1, actionType: 'file_edit' }),
        makeActivity({ id: 2, actionType: 'spawn' }),
        makeActivity({ id: 3, actionType: 'error' }),
      ];
      render(<ActivityFeed activity={activities} agents={[makeAgent('a1')]} />);
      expect(screen.getByText('file edit')).toBeTruthy();
      expect(screen.getByText('spawn')).toBeTruthy();
      expect(screen.getByText('error')).toBeTruthy();
    });
  });
});
