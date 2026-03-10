import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MentionText } from '../markdown';
import type { MentionAgent } from '../../components/AgentMentionTooltip';

const agents: MentionAgent[] = [
  { id: 'abc12345deadbeef', role: { id: 'developer', name: 'Developer' }, status: 'running' },
  { id: 'def67890cafebabe', role: { id: 'lead', name: 'Project Lead' }, status: 'running' },
];

describe('MentionText', () => {
  it('renders @user with yellow highlight and no tooltip', () => {
    const { container } = render(
      <MentionText text="Hey @user check this" agents={agents} />,
    );

    const userMention = container.querySelector('.bg-yellow-500\\/25');
    expect(userMention).not.toBeNull();
    expect(userMention!.textContent).toBe('@user');
    // No tooltip wrapper — the span should NOT be inside an AgentMentionTooltip
    expect(userMention!.closest('[data-tooltip]')).toBeNull();
    // Not clickable — no cursor-pointer class
    expect(userMention!.className).not.toContain('cursor-pointer');
  });

  it('renders agent @mentions with blue styling and tooltip', () => {
    const { container } = render(
      <MentionText text="Ask @developer about this" agents={agents} />,
    );

    const agentMention = container.querySelector('.bg-blue-500\\/20');
    expect(agentMention).not.toBeNull();
    expect(agentMention!.textContent).toContain('@developer');
    // Should be clickable
    expect(agentMention!.className).toContain('cursor-pointer');
  });

  it('renders @user differently from agent mentions in the same text', () => {
    const { container } = render(
      <MentionText text="@user please review @developer code" agents={agents} />,
    );

    const yellowMentions = container.querySelectorAll('.bg-yellow-500\\/25');
    const blueMentions = container.querySelectorAll('.bg-blue-500\\/20');
    expect(yellowMentions).toHaveLength(1);
    expect(blueMentions).toHaveLength(1);
    expect(yellowMentions[0].textContent).toBe('@user');
    expect(blueMentions[0].textContent).toContain('@developer');
  });

  it('renders plain text when no mentions match', () => {
    const { container } = render(
      <MentionText text="No mentions here" agents={agents} />,
    );

    expect(container.textContent).toBe('No mentions here');
    expect(container.querySelector('.bg-yellow-500\\/20')).toBeNull();
    expect(container.querySelector('.bg-blue-500\\/20')).toBeNull();
  });

  it('resolves hex ID mentions to agents', () => {
    const { container } = render(
      <MentionText text="Check @abc12345" agents={agents} />,
    );

    const agentMention = container.querySelector('.bg-blue-500\\/20');
    expect(agentMention).not.toBeNull();
    expect(agentMention!.textContent).toContain('@developer');
  });

  it('returns null for null/undefined text without crashing', () => {
    const { container: c1 } = render(
      <MentionText text={null as unknown as string} agents={agents} />,
    );
    expect(c1.innerHTML).toBe('');

    const { container: c2 } = render(
      <MentionText text={undefined as unknown as string} agents={agents} />,
    );
    expect(c2.innerHTML).toBe('');

    const { container: c3 } = render(
      <MentionText text="" agents={agents} />,
    );
    expect(c3.innerHTML).toBe('');
  });
});
