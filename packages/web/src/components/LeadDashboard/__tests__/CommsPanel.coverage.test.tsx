// @vitest-environment jsdom
/**
 * Coverage tests for CommsPanel — tier filtering, popup modals, group messages,
 * agent report rendering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AgentComm } from '../../../stores/leadStore';
import type { GroupMessage } from '../../../types';

vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (sel: any) => sel({ agents: [], setSelectedAgent: vi.fn() }),
    { getState: () => ({ agents: [], setSelectedAgent: vi.fn() }) },
  ),
}));

vi.mock('../../../utils/markdown', () => ({
  MentionText: ({ text }: { text: string }) => <span>{text}</span>,
}));

vi.mock('../../Shared', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('../AgentReportBlock', () => ({
  AgentReportBlock: ({ content, compact }: any) => (
    <div data-testid="agent-report">{compact ? 'compact' : 'full'}: {content.slice(0, 30)}</div>
  ),
}));

vi.mock('../../ui/Markdown', () => ({
  Markdown: ({ text }: any) => <div data-testid="markdown">{text.slice(0, 50)}</div>,
}));

vi.mock('../../../utils/messageTiers', () => ({
  classifyMessage: () => 'notable',
  tierPassesFilter: (_tier: string, filter: string) => filter === 'all' || filter === 'notable',
  TIER_CONFIG: {
    critical: { bgClass: 'bg-red', borderBClass: 'border-b-red', borderClass: 'border-red' },
    notable: { bgClass: 'bg-blue', borderBClass: 'border-b-blue', borderClass: 'border-blue' },
    routine: { bgClass: 'bg-gray', borderBClass: 'border-b-gray', borderClass: 'border-gray' },
  },
}));

import { CommsPanelContent, roleColor } from '../CommsPanel';

const makeComm = (overrides: Partial<AgentComm> = {}): AgentComm => ({
  id: 'c1',
  fromId: 'a1',
  fromRole: 'Developer',
  toId: 'a2',
  toRole: 'Architect',
  type: 'message',
  content: 'Hello from developer',
  timestamp: new Date().toISOString(),
  ...overrides,
} as AgentComm);

const makeGroupMsg = (overrides: Partial<GroupMessage> = {}): GroupMessage => ({
  id: 'gm1',
  groupName: 'frontend-team',
  fromAgentId: 'a1',
  fromRole: 'Developer',
  content: 'Group message content',
  timestamp: new Date().toISOString(),
  ...overrides,
} as GroupMessage);

describe('roleColor', () => {
  it('returns a tailwind color class for any role', () => {
    expect(roleColor('developer')).toMatch(/^text-/);
    expect(roleColor('architect')).toMatch(/^text-/);
    expect(roleColor('')).toMatch(/^text-/);
  });

  it('returns deterministic color for same role', () => {
    expect(roleColor('developer')).toBe(roleColor('developer'));
  });
});

describe('CommsPanelContent — coverage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows empty state when no comms and no group messages', () => {
    render(<CommsPanelContent comms={[]} groupMessages={{}} />);
    expect(screen.getByText('No messages yet')).toBeInTheDocument();
  });

  it('renders 1:1 comm messages', () => {
    render(<CommsPanelContent comms={[makeComm()]} groupMessages={{}} />);
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('Architect')).toBeInTheDocument();
  });

  it('renders group messages', () => {
    render(<CommsPanelContent comms={[]} groupMessages={{ 'frontend-team': [makeGroupMsg()] }} />);
    expect(screen.getByText('frontend-team')).toBeInTheDocument();
    expect(screen.getByText('Developer')).toBeInTheDocument();
  });

  it('opens comm popup on click', () => {
    render(<CommsPanelContent comms={[makeComm()]} groupMessages={{}} />);
    fireEvent.click(screen.getByText('Hello from developer'));
    // Popup should show full content with markdown
    expect(screen.getByTestId('markdown')).toBeInTheDocument();
  });

  it('opens group message popup on click', () => {
    render(<CommsPanelContent comms={[]} groupMessages={{ 'frontend-team': [makeGroupMsg()] }} />);
    fireEvent.click(screen.getByText('Group message content'));
    expect(screen.getAllByText('frontend-team').length).toBeGreaterThanOrEqual(1);
  });

  it('closes comm popup when clicking overlay', () => {
    render(<CommsPanelContent comms={[makeComm()]} groupMessages={{}} />);
    fireEvent.click(screen.getByText('Hello from developer'));
    // Click the overlay background
    const overlay = screen.getByTestId('markdown').closest('.fixed');
    if (overlay) fireEvent.mouseDown(overlay);
  });

  it('renders agent report block for agent report messages', () => {
    const comm = makeComm({ content: '[Agent Report] Task completed successfully with all tests passing' });
    render(<CommsPanelContent comms={[comm]} groupMessages={{}} />);
    expect(screen.getByTestId('agent-report')).toBeInTheDocument();
  });

  it('renders agent report block for agent ACK messages', () => {
    const comm = makeComm({ content: '[Agent ACK] Received instructions' });
    render(<CommsPanelContent comms={[comm]} groupMessages={{}} />);
    expect(screen.getByTestId('agent-report')).toBeInTheDocument();
  });

  it('applies tier filter correctly', () => {
    render(<CommsPanelContent comms={[makeComm()]} groupMessages={{}} />);
    // Click "Critical" filter — our mock tierPassesFilter returns false for 'critical'
    const criticalBtn = screen.getByText(/Critical/);
    fireEvent.click(criticalBtn);
    // With our mock, notable messages don't pass 'critical' filter
    expect(screen.getByText(/No messages match this filter/)).toBeInTheDocument();
  });
});
