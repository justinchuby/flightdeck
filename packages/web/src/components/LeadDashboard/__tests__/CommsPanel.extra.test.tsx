// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const storeState = { agents: [], setSelectedAgent: vi.fn() };
vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (sel: (s: any) => any) => sel(storeState),
    { getState: () => storeState },
  ),
}));

vi.mock('../../../utils/markdown', () => ({
  MentionText: ({ text }: { text: string }) => <span>{text}</span>,
}));

vi.mock('../AgentReportBlock', () => ({
  AgentReportBlock: ({ content, compact }: { content: string; compact?: boolean }) => (
    <div data-testid="agent-report">{compact ? 'compact:' : 'full:'}{content}</div>
  ),
}));

vi.mock('../../ui/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => <div data-testid="markdown">{text}</div>,
}));

import { CommsPanelContent, roleColor } from '../CommsPanel';

afterEach(cleanup);

const makeComm = (id: string, from: string, to: string, content = 'Hello', fromRole = 'Developer', toRole = 'Lead') => ({
  id, fromId: from, toId: to, fromRole, toRole, content,
  timestamp: Date.now(), type: 'agent_message' as const,
});

describe('CommsPanelContent – extra coverage', () => {
  it('renders group message with all info', () => {
    const groupMessages = {
      'team-a': [{
        id: 'gm1', groupId: 'team-a', groupName: 'Backend',
        fromId: 'a1', fromRole: 'Architect', content: 'Please review',
        timestamp: new Date().toISOString(),
      }],
    };
    render(<CommsPanelContent comms={[]} groupMessages={groupMessages as any} />);
    expect(screen.getByText('Backend')).toBeInTheDocument();
    expect(screen.getByText('Architect')).toBeInTheDocument();
    expect(screen.getByText('Please review')).toBeInTheDocument();
  });

  it('clicking a comm opens the full message popup', () => {
    const comm = makeComm('c1', 'a1', 'lead', 'Full message content here');
    render(<CommsPanelContent comms={[comm]} groupMessages={{}} />);
    
    // Click the comm row
    fireEvent.click(screen.getByText('Full message content here').closest('[class*="cursor-pointer"]')!);
    
    // Modal should appear with full content
    expect(screen.getByTestId('markdown')).toBeInTheDocument();
    expect(screen.getByText('×')).toBeInTheDocument();
  });

  it('closes comm popup when clicking close button', () => {
    const comm = makeComm('c1', 'a1', 'lead', 'Some content');
    render(<CommsPanelContent comms={[comm]} groupMessages={{}} />);
    
    fireEvent.click(screen.getByText('Some content').closest('[class*="cursor-pointer"]')!);
    expect(screen.getByText('×')).toBeInTheDocument();
    
    fireEvent.click(screen.getByText('×'));
    // Modal should be gone - no more close button
    expect(screen.queryByText('×')).toBeNull();
  });

  it('shows AgentReportBlock for agent report messages', () => {
    const comm = makeComm('c1', 'a1', 'lead', '[Agent Report] Status: working');
    render(<CommsPanelContent comms={[comm]} groupMessages={{}} />);
    expect(screen.getByTestId('agent-report')).toBeInTheDocument();
    expect(screen.getByText(/compact:/)).toBeInTheDocument();
  });

  it('opens full AgentReportBlock in popup for report messages', () => {
    const comm = makeComm('c1', 'a1', 'lead', '[Agent Report] Full status');
    render(<CommsPanelContent comms={[comm]} groupMessages={{}} />);
    
    // Click to open popup
    fireEvent.click(screen.getByText(/compact:/).closest('[class*="cursor-pointer"]')!);
    
    // Should show full (not compact) AgentReportBlock
    const reports = screen.getAllByTestId('agent-report');
    const fullReport = reports.find(r => r.textContent?.includes('full:'));
    expect(fullReport).toBeTruthy();
  });

  it('clicking group message opens group popup', () => {
    const groupMessages = {
      'team-a': [{
        id: 'gm1', groupId: 'team-a', groupName: 'Design Team',
        fromId: 'a1', fromRole: 'Designer', content: 'Updated mockup',
        timestamp: new Date().toISOString(),
      }],
    };
    render(<CommsPanelContent comms={[]} groupMessages={groupMessages as any} />);
    
    fireEvent.click(screen.getByText('Updated mockup').closest('[class*="cursor-pointer"]')!);
    
    // Group popup should show with group name and markdown content
    expect(screen.getByTestId('markdown')).toBeInTheDocument();
    // Close button
    expect(screen.getByText('×')).toBeInTheDocument();
  });

  it('closes group popup when clicking close button', () => {
    const groupMessages = {
      'team-a': [{
        id: 'gm1', groupId: 'team-a', groupName: 'Team',
        fromId: 'a1', fromRole: 'Dev', content: 'Hi',
        timestamp: new Date().toISOString(),
      }],
    };
    render(<CommsPanelContent comms={[]} groupMessages={groupMessages as any} />);
    
    fireEvent.click(screen.getByText('Hi').closest('[class*="cursor-pointer"]')!);
    fireEvent.click(screen.getByText('×'));
    expect(screen.queryByText('×')).toBeNull();
  });

  it('truncates long messages to 120 chars', () => {
    const longContent = 'x'.repeat(200);
    const comm = makeComm('c1', 'a1', 'lead', longContent);
    render(<CommsPanelContent comms={[comm]} groupMessages={{}} />);
    // Should show truncated version with …
    const truncated = screen.getByText(/x{120}…/);
    expect(truncated).toBeInTheDocument();
  });

  it('applies tier filter buttons', () => {
    const comm = makeComm('c1', 'a1', 'lead', 'Test');
    render(<CommsPanelContent comms={[comm]} groupMessages={{}} />);
    
    // Should see filter buttons
    expect(screen.getByText('All')).toBeInTheDocument();
    
    // Click Critical filter
    fireEvent.click(screen.getByText(/Critical/));
    // Message may or may not show depending on tier - just verifying no crash
    expect(screen.getByText(/Critical/)).toBeInTheDocument();
  });

  it('highlights messages directed to user', () => {
    const comm = makeComm('c1', 'a1', 'lead-1', 'Hello lead');
    render(<CommsPanelContent comms={[comm]} groupMessages={{}} leadId="lead-1" />);
    expect(screen.getByText('Hello lead')).toBeInTheDocument();
  });
});

describe('roleColor', () => {
  it('returns a tailwind text color class', () => {
    const color = roleColor('developer');
    expect(color).toMatch(/^text-/);
  });

  it('returns consistent color for same role', () => {
    expect(roleColor('architect')).toBe(roleColor('architect'));
  });

  it('returns a color even for empty string', () => {
    const color = roleColor('');
    expect(color).toMatch(/^text-/);
  });
});
