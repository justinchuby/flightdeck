// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs } from '../Tabs';

const BASIC_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'messages', label: 'Messages' },
];

describe('Tabs', () => {
  it('renders all tab labels', () => {
    render(<Tabs tabs={BASIC_TABS} activeTab="overview" onTabChange={() => {}} />);
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Messages')).toBeInTheDocument();
  });

  it('marks active tab with aria-selected', () => {
    render(<Tabs tabs={BASIC_TABS} activeTab="tasks" onTabChange={() => {}} />);
    expect(screen.getByTestId('tab-tasks')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('tab-overview')).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onTabChange with correct id on click', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={BASIC_TABS} activeTab="overview" onTabChange={onChange} />);
    fireEvent.click(screen.getByTestId('tab-messages'));
    expect(onChange).toHaveBeenCalledWith('messages');
  });

  it('renders icons when provided', () => {
    const tabs = [
      { id: 'a', label: 'Alpha', icon: <span data-testid="icon-a">🅰️</span> },
      { id: 'b', label: 'Beta', icon: <span data-testid="icon-b">🅱️</span> },
    ];
    render(<Tabs tabs={tabs} activeTab="a" onTabChange={() => {}} />);
    expect(screen.getByTestId('icon-a')).toBeInTheDocument();
    expect(screen.getByTestId('icon-b')).toBeInTheDocument();
  });

  it('renders count badges when provided', () => {
    const tabs = [
      { id: 'memory', label: 'Memory', count: 42 },
      { id: 'activity', label: 'Activity', count: 0 },
      { id: 'empty', label: 'Empty' },
    ];
    render(<Tabs tabs={tabs} activeTab="memory" onTabChange={() => {}} />);
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('uses role="tablist" on container', () => {
    render(<Tabs tabs={BASIC_TABS} activeTab="overview" onTabChange={() => {}} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('uses role="tab" on each button', () => {
    render(<Tabs tabs={BASIC_TABS} activeTab="overview" onTabChange={() => {}} />);
    const tabButtons = screen.getAllByRole('tab');
    expect(tabButtons).toHaveLength(3);
  });

  it('applies sm size class', () => {
    render(<Tabs tabs={BASIC_TABS} activeTab="overview" onTabChange={() => {}} size="sm" />);
    const tab = screen.getByTestId('tab-overview');
    expect(tab.className).toContain('text-[11px]');
  });

  it('applies custom className to container', () => {
    render(<Tabs tabs={BASIC_TABS} activeTab="overview" onTabChange={() => {}} className="px-4" />);
    const container = screen.getByRole('tablist');
    expect(container.className).toContain('px-4');
  });

  it('applies accent border to active tab', () => {
    render(<Tabs tabs={BASIC_TABS} activeTab="overview" onTabChange={() => {}} />);
    const active = screen.getByTestId('tab-overview');
    expect(active.className).toContain('border-accent');
    expect(active.className).toContain('text-accent');
  });

  it('applies transparent border to inactive tabs', () => {
    render(<Tabs tabs={BASIC_TABS} activeTab="overview" onTabChange={() => {}} />);
    const inactive = screen.getByTestId('tab-tasks');
    expect(inactive.className).toContain('border-transparent');
    expect(inactive.className).toContain('text-th-text-muted');
  });
});
