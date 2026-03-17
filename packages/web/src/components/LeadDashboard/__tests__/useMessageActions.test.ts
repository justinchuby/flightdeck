// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockProjects: Record<string, any> = {};
vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: {
    getState: () => ({
      projects: mockProjects,
    }),
  },
}));

const mockMsAddMessage = vi.fn();
const mockMsSetMessages = vi.fn();
const mockMsEnsureChannel = vi.fn();
let mockMsChannels: Record<string, any> = {};

vi.mock('../../../stores/messageStore', () => ({
  useMessageStore: {
    getState: () => ({
      addMessage: mockMsAddMessage,
      setMessages: mockMsSetMessages,
      ensureChannel: mockMsEnsureChannel,
      channels: mockMsChannels,
    }),
  },
}));

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

import { useMessageActions } from '../useMessageActions';

describe('useMessageActions', () => {
  let setInput: ReturnType<typeof vi.fn>;
  let clearAttachments: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    setInput = vi.fn();
    clearAttachments = vi.fn();
    mockApiFetch.mockResolvedValue({});
    // Reset projects
    Object.keys(mockProjects).forEach((k) => delete mockProjects[k]);
    mockProjects['lead-1'] = {};
    // Reset message channels
    mockMsChannels = {};
    mockMsChannels['lead-1'] = {
      messages: [
        { type: 'text', text: 'hello', sender: 'agent', queued: false },
        { type: 'text', text: 'queued msg', sender: 'user', queued: true },
      ],
    };
  });

  it('returns sendMessage, removeQueuedMessage, reorderQueuedMessage', () => {
    const { result } = renderHook(() =>
      useMessageActions('lead-1', 'test msg', setInput, [], clearAttachments),
    );
    expect(result.current.sendMessage).toBeTypeOf('function');
    expect(result.current.removeQueuedMessage).toBeTypeOf('function');
    expect(result.current.reorderQueuedMessage).toBeTypeOf('function');
  });

  it('sendMessage clears input and posts to API', async () => {
    const { result } = renderHook(() =>
      useMessageActions('lead-1', 'Hello world', setInput, [], clearAttachments),
    );
    await act(async () => {
      await result.current.sendMessage();
    });
    expect(setInput).toHaveBeenCalledWith('');
    expect(mockMsAddMessage).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      text: 'Hello world',
      sender: 'user',
    }));
    expect(mockApiFetch).toHaveBeenCalledWith('/lead/lead-1/message', expect.objectContaining({
      method: 'POST',
    }));
    expect(clearAttachments).toHaveBeenCalled();
  });

  it('sendMessage with interrupt inserts separator when last msg from agent', async () => {
    // Make last message from agent
    mockMsChannels['lead-1'] = {
      messages: [
        { type: 'text', text: 'agent response', sender: 'agent', queued: false },
      ],
    };
    const { result } = renderHook(() =>
      useMessageActions('lead-1', 'interrupt!', setInput, [], clearAttachments),
    );
    await act(async () => {
      await result.current.sendMessage('interrupt');
    });
    // Should insert separator before user message since last msg is from agent
    expect(mockMsAddMessage).toHaveBeenCalledWith('lead-1', expect.objectContaining({
      text: '---',
      sender: 'system',
    }));
  });

  it('sendMessage no-ops on empty input', async () => {
    const { result } = renderHook(() =>
      useMessageActions('lead-1', '  ', setInput, [], clearAttachments),
    );
    await act(async () => {
      await result.current.sendMessage();
    });
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('sendMessage no-ops when no lead selected', async () => {
    const { result } = renderHook(() =>
      useMessageActions(null, 'hello', setInput, [], clearAttachments),
    );
    await act(async () => {
      await result.current.sendMessage();
    });
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('sendMessage includes attachments in payload', async () => {
    const attachments = [
      { name: 'img.png', mimeType: 'image/png', data: 'base64data', kind: 'image' as const, thumbnailDataUrl: 'thumb' },
    ];
    const { result } = renderHook(() =>
      useMessageActions('lead-1', 'with file', setInput, attachments as any, clearAttachments),
    );
    await act(async () => {
      await result.current.sendMessage();
    });
    const body = JSON.parse(mockApiFetch.mock.calls[0][1].body);
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].name).toBe('img.png');
  });

  it('sendMessage with broadcast flag', async () => {
    const { result } = renderHook(() =>
      useMessageActions('lead-1', 'broadcast msg', setInput, [], clearAttachments),
    );
    await act(async () => {
      await result.current.sendMessage('queue', { broadcast: true });
    });
    const body = JSON.parse(mockApiFetch.mock.calls[0][1].body);
    expect(body.broadcast).toBe(true);
  });

  it('removeQueuedMessage calls API and updates store', async () => {
    const { result } = renderHook(() =>
      useMessageActions('lead-1', '', setInput, [], clearAttachments),
    );
    await act(async () => {
      await result.current.removeQueuedMessage(0);
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/agents/lead-1/queue/0', { method: 'DELETE' });
    expect(mockMsSetMessages).toHaveBeenCalled();
  });

  it('reorderQueuedMessage calls API and reorders store', async () => {
    mockMsChannels['lead-1'].messages = [
      { type: 'text', text: 'non-queued', sender: 'agent', queued: false },
      { type: 'text', text: 'q1', sender: 'user', queued: true },
      { type: 'text', text: 'q2', sender: 'user', queued: true },
    ];
    const { result } = renderHook(() =>
      useMessageActions('lead-1', '', setInput, [], clearAttachments),
    );
    await act(async () => {
      await result.current.reorderQueuedMessage(0, 1);
    });
    expect(mockApiFetch).toHaveBeenCalledWith('/agents/lead-1/queue/reorder', expect.objectContaining({
      method: 'POST',
    }));
    expect(mockMsSetMessages).toHaveBeenCalled();
  });
});
