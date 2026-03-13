import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InputComposer } from '../InputComposer';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));

function renderComposer(overrides: Partial<Parameters<typeof InputComposer>[0]> = {}) {
  const props = {
    input: '',
    onInputChange: vi.fn(),
    isActive: true,
    selectedLeadId: 'lead-1',
    messages: [],
    attachments: [],
    onRemoveAttachment: vi.fn(),
    onSendMessage: vi.fn(),
    onRemoveQueuedMessage: vi.fn(),
    onReorderQueuedMessage: vi.fn(),
    ...overrides,
  };
  return { ...render(<InputComposer {...props} />), props };
}

describe('InputComposer button layout', () => {
  it('renders broadcast, interrupt, and send buttons with tooltips', () => {
    renderComposer();

    const broadcastBtn = screen.getByTitle('Broadcast to all agents');
    const interruptBtn = screen.getByTitle('Interrupt agent (Ctrl+Enter)');
    const sendBtn = screen.getByTitle('Queue message (Enter)');

    expect(broadcastBtn).toBeInTheDocument();
    expect(interruptBtn).toBeInTheDocument();
    expect(sendBtn).toBeInTheDocument();
  });

  it('toggles broadcast mode on megaphone click', () => {
    renderComposer();

    const broadcastBtn = screen.getByTitle('Broadcast to all agents');
    expect(broadcastBtn.className).toContain('text-th-text-muted');

    fireEvent.click(broadcastBtn);
    expect(broadcastBtn.className).toContain('text-accent');
    expect(screen.getByText('Broadcasting to all agents')).toBeInTheDocument();

    fireEvent.click(broadcastBtn);
    expect(broadcastBtn.className).toContain('text-th-text-muted');
    expect(screen.queryByText('Broadcasting to all agents')).not.toBeInTheDocument();
  });

  it('passes broadcast flag when sending', () => {
    const onSendMessage = vi.fn();
    renderComposer({ input: 'hello', onSendMessage });

    // Enable broadcast
    fireEvent.click(screen.getByTitle('Broadcast to all agents'));

    // Click send
    fireEvent.click(screen.getByTitle('Queue message (Enter)'));
    expect(onSendMessage).toHaveBeenCalledWith('queue', { broadcast: true });
  });

  it('sends without broadcast flag by default', () => {
    const onSendMessage = vi.fn();
    renderComposer({ input: 'hello', onSendMessage });

    fireEvent.click(screen.getByTitle('Queue message (Enter)'));
    expect(onSendMessage).toHaveBeenCalledWith('queue', { broadcast: false });
  });

  it('disables send and interrupt when not active', () => {
    renderComposer({ isActive: false });

    expect(screen.getByTitle('Queue message (Enter)')).toBeDisabled();
    expect(screen.getByTitle('Interrupt agent (Ctrl+Enter)')).toBeDisabled();
  });
});
