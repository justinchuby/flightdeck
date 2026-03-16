// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { InputComposer } from '../InputComposer';

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../../AttachmentBar', () => ({
  AttachmentBar: ({ attachments, _onRemove }: any) => (
    <div data-testid="attachment-bar">{attachments?.length ?? 0} attachments</div>
  ),
}));

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

function renderComposer(overrides: Partial<Parameters<typeof InputComposer>[0]> = {}) {
  const props = {
    input: '',
    onInputChange: vi.fn(),
    isActive: true,
    selectedLeadId: 'lead-1',
    messages: [] as any[],
    attachments: [] as any[],
    onRemoveAttachment: vi.fn(),
    onSendMessage: vi.fn(),
    onRemoveQueuedMessage: vi.fn(),
    onReorderQueuedMessage: vi.fn(),
    ...overrides,
  };
  return { ...render(<InputComposer {...props} />), props };
}

describe('InputComposer', () => {
  describe('textarea', () => {
    it('renders textarea with active placeholder', () => {
      renderComposer({ isActive: true });
      const textarea = screen.getByPlaceholderText(/Message the Lead/);
      expect(textarea).toBeTruthy();
    });

    it('renders textarea with inactive placeholder', () => {
      renderComposer({ isActive: false });
      const textarea = screen.getByPlaceholderText('Project Lead is not active');
      expect(textarea).toBeTruthy();
    });

    it('textarea is disabled when not active', () => {
      renderComposer({ isActive: false });
      const textarea = screen.getByPlaceholderText('Project Lead is not active') as HTMLTextAreaElement;
      expect(textarea.disabled).toBe(true);
    });

    it('textarea is enabled when active', () => {
      renderComposer({ isActive: true });
      const textarea = screen.getByPlaceholderText(/Message the Lead/) as HTMLTextAreaElement;
      expect(textarea.disabled).toBe(false);
    });

    it('calls onInputChange when typing', () => {
      const { props } = renderComposer();
      const textarea = screen.getByPlaceholderText(/Message the Lead/);
      fireEvent.change(textarea, { target: { value: 'hello' } });
      expect(props.onInputChange).toHaveBeenCalledWith('hello');
    });
  });

  describe('button layout', () => {
    it('renders broadcast, interrupt, and send buttons with tooltips', () => {
      renderComposer();
      expect(screen.getByTitle('Broadcast to all agents')).toBeTruthy();
      expect(screen.getByTitle('Interrupt agent (Ctrl+Enter)')).toBeTruthy();
      expect(screen.getByTitle('Queue message (Enter)')).toBeTruthy();
    });

    it('disables send and interrupt when not active', () => {
      renderComposer({ isActive: false });
      expect((screen.getByTitle('Queue message (Enter)') as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByTitle('Interrupt agent (Ctrl+Enter)') as HTMLButtonElement).disabled).toBe(true);
    });

    it('disables send button when input is empty', () => {
      renderComposer({ input: '', isActive: true });
      expect((screen.getByTitle('Queue message (Enter)') as HTMLButtonElement).disabled).toBe(true);
    });

    it('enables send button when input has text', () => {
      renderComposer({ input: 'hello', isActive: true });
      expect((screen.getByTitle('Queue message (Enter)') as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe('send action', () => {
    it('clicking send calls onSendMessage with queue and broadcast false', () => {
      const onSendMessage = vi.fn();
      renderComposer({ input: 'hello', onSendMessage });
      fireEvent.click(screen.getByTitle('Queue message (Enter)'));
      expect(onSendMessage).toHaveBeenCalledWith('queue', { broadcast: false });
    });

    it('clicking send with broadcast enabled calls onSendMessage with broadcast true', () => {
      const onSendMessage = vi.fn();
      renderComposer({ input: 'hello', onSendMessage });
      fireEvent.click(screen.getByTitle('Broadcast to all agents'));
      fireEvent.click(screen.getByTitle('Queue message (Enter)'));
      expect(onSendMessage).toHaveBeenCalledWith('queue', { broadcast: true });
    });
  });

  describe('broadcast toggle', () => {
    it('toggles broadcast mode on megaphone click', () => {
      renderComposer();
      const btn = screen.getByTitle('Broadcast to all agents');
      expect(btn.className).toContain('text-th-text-muted');

      fireEvent.click(btn);
      expect(btn.className).toContain('text-accent');
      expect(screen.getByText('Broadcasting to all agents')).toBeTruthy();

      fireEvent.click(btn);
      expect(btn.className).toContain('text-th-text-muted');
      expect(screen.queryByText('Broadcasting to all agents')).toBeNull();
    });

    it('applies accent border to textarea when broadcast is on', () => {
      renderComposer();
      fireEvent.click(screen.getByTitle('Broadcast to all agents'));
      const textarea = screen.getByPlaceholderText(/Message the Lead/);
      expect(textarea.className).toContain('border-accent');
    });
  });

  describe('interrupt action', () => {
    it('clicking interrupt with input calls onSendMessage with interrupt', () => {
      const onSendMessage = vi.fn();
      renderComposer({ input: 'stop now', onSendMessage });
      fireEvent.click(screen.getByTitle('Interrupt agent (Ctrl+Enter)'));
      expect(onSendMessage).toHaveBeenCalledWith('interrupt', { broadcast: false });
    });

    it('clicking interrupt with empty input calls apiFetch to interrupt', async () => {
      const { apiFetch } = await import('../../../hooks/useApi');
      renderComposer({ input: '', selectedLeadId: 'lead-42' });
      fireEvent.click(screen.getByTitle('Interrupt agent (Ctrl+Enter)'));
      expect(apiFetch).toHaveBeenCalledWith('/agents/lead-42/interrupt', { method: 'POST' });
    });

    it('clicking interrupt with empty input and no selectedLeadId does nothing', async () => {
      const { apiFetch } = await import('../../../hooks/useApi');
      const onSendMessage = vi.fn();
      renderComposer({ input: '', selectedLeadId: null, onSendMessage });
      fireEvent.click(screen.getByTitle('Interrupt agent (Ctrl+Enter)'));
      expect(onSendMessage).not.toHaveBeenCalled();
      expect(apiFetch).not.toHaveBeenCalled();
    });
  });

  describe('keyboard shortcuts', () => {
    it('Enter key sends message (queue)', () => {
      const onSendMessage = vi.fn();
      renderComposer({ input: 'test', onSendMessage });
      const textarea = screen.getByPlaceholderText(/Message the Lead/);
      fireEvent.keyDown(textarea, { key: 'Enter' });
      expect(onSendMessage).toHaveBeenCalledWith('queue', { broadcast: false });
    });

    it('Shift+Enter does not send', () => {
      const onSendMessage = vi.fn();
      renderComposer({ input: 'test', onSendMessage });
      const textarea = screen.getByPlaceholderText(/Message the Lead/);
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
      expect(onSendMessage).not.toHaveBeenCalled();
    });

    it('Ctrl+Enter with input sends interrupt', () => {
      const onSendMessage = vi.fn();
      renderComposer({ input: 'stop', onSendMessage });
      const textarea = screen.getByPlaceholderText(/Message the Lead/);
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(onSendMessage).toHaveBeenCalledWith('interrupt', { broadcast: false });
    });

    it('Ctrl+Enter without input calls apiFetch interrupt', async () => {
      const { apiFetch } = await import('../../../hooks/useApi');
      renderComposer({ input: '', selectedLeadId: 'lead-1' });
      const textarea = screen.getByPlaceholderText(/Message the Lead/);
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
      expect(apiFetch).toHaveBeenCalledWith('/agents/lead-1/interrupt', { method: 'POST' });
    });

    it('Meta+Enter with input sends interrupt', () => {
      const onSendMessage = vi.fn();
      renderComposer({ input: 'halt', onSendMessage });
      const textarea = screen.getByPlaceholderText(/Message the Lead/);
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
      expect(onSendMessage).toHaveBeenCalledWith('interrupt', { broadcast: false });
    });
  });

  describe('queued messages', () => {
    const queuedMessages = [
      { type: 'text' as const, text: 'First message', sender: 'user' as const, queued: true, timestamp: Date.now() },
      { type: 'text' as const, text: 'Second message', sender: 'user' as const, queued: true, timestamp: Date.now() },
      { type: 'text' as const, text: 'Third message', sender: 'user' as const, queued: true, timestamp: Date.now() },
    ];

    it('shows queued messages section when queued messages exist', () => {
      renderComposer({ messages: queuedMessages });
      expect(screen.getByText('First message')).toBeTruthy();
      expect(screen.getByText('Second message')).toBeTruthy();
    });

    it('shows queued count', () => {
      renderComposer({ messages: queuedMessages });
      expect(screen.getByText(/Queued \(3\)/)).toBeTruthy();
    });

    it('does not show queued section when no queued messages', () => {
      const nonQueued = [{ type: 'text' as const, text: 'Normal message', sender: 'user' as const, queued: false }];
      renderComposer({ messages: nonQueued });
      expect(screen.queryByText(/Queued/)).toBeNull();
    });

    it('remove button calls onRemoveQueuedMessage with correct index', () => {
      const onRemoveQueuedMessage = vi.fn();
      renderComposer({ messages: queuedMessages, onRemoveQueuedMessage });
      const removeBtns = screen.getAllByLabelText('Remove queued message');
      expect(removeBtns.length).toBe(3);
      fireEvent.click(removeBtns[1]);
      expect(onRemoveQueuedMessage).toHaveBeenCalledWith(1);
    });

    it('move up button calls onReorderQueuedMessage', () => {
      const onReorderQueuedMessage = vi.fn();
      renderComposer({ messages: queuedMessages, onReorderQueuedMessage });
      const upBtns = screen.getAllByLabelText('Move message up');
      // First message doesn't have move up, so there should be 2
      expect(upBtns.length).toBe(2);
      fireEvent.click(upBtns[0]); // Move second message up
      expect(onReorderQueuedMessage).toHaveBeenCalledWith(1, 0);
    });

    it('move down button calls onReorderQueuedMessage', () => {
      const onReorderQueuedMessage = vi.fn();
      renderComposer({ messages: queuedMessages, onReorderQueuedMessage });
      const downBtns = screen.getAllByLabelText('Move message down');
      // Last message doesn't have move down, so there should be 2
      expect(downBtns.length).toBe(2);
      fireEvent.click(downBtns[0]); // Move first message down
      expect(onReorderQueuedMessage).toHaveBeenCalledWith(0, 1);
    });
  });

  describe('AttachmentBar', () => {
    it('renders AttachmentBar', () => {
      renderComposer({ attachments: [] });
      expect(screen.getByTestId('attachment-bar')).toBeTruthy();
      expect(screen.getByText('0 attachments')).toBeTruthy();
    });

    it('passes attachments count to AttachmentBar', () => {
      const attachments = [{ id: '1', name: 'file.txt', type: 'text/plain', size: 100 }] as any[];
      renderComposer({ attachments });
      expect(screen.getByText('1 attachments')).toBeTruthy();
    });
  });
});
