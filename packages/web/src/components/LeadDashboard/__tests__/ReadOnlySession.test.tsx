import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReadOnlySession } from '../ReadOnlySession';

// Mock LeadDashboard to verify readOnly prop is passed
const mockLeadDashboard = vi.fn();
vi.mock('../LeadDashboard', () => ({
  LeadDashboard: (props: any) => {
    mockLeadDashboard(props);
    return <div data-testid="lead-dashboard" data-readonly={props.readOnly} />;
  },
}));

// Mock leadStore
const mockSelectLead = vi.fn();
const mockAddProject = vi.fn();
const mockSetMessages = vi.fn();
const mockSetDecisions = vi.fn();
const mockSetGroups = vi.fn();
const mockSetDagStatus = vi.fn();
const mockSetProgress = vi.fn();

vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: Object.assign(
    vi.fn(() => ({})),
    {
      getState: () => ({
        projects: {},
        selectedLeadId: 'prev-lead-id',
        selectLead: mockSelectLead,
        addProject: mockAddProject,
        setMessages: mockSetMessages,
        setDecisions: mockSetDecisions,
        setGroups: mockSetGroups,
        setDagStatus: mockSetDagStatus,
        setProgress: mockSetProgress,
      }),
    }
  ),
}));

// Mock apiFetch
const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

describe('ReadOnlySession', () => {
  const mockApi = {};
  const mockWs = { subscribe: vi.fn(), unsubscribe: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({ messages: [] });
  });

  function renderWithRoute(leadId: string) {
    return render(
      <MemoryRouter initialEntries={[`/projects/proj-1/sessions/${leadId}`]}>
        <Routes>
          <Route
            path="/projects/:id/sessions/:leadId"
            element={<ReadOnlySession api={mockApi} ws={mockWs} />}
          />
        </Routes>
      </MemoryRouter>
    );
  }

  it('renders LeadDashboard with readOnly=true', () => {
    renderWithRoute('lead-abc-123');
    expect(screen.getByTestId('lead-dashboard')).toBeInTheDocument();
    expect(mockLeadDashboard).toHaveBeenCalledWith(
      expect.objectContaining({ readOnly: true })
    );
  });

  it('selects the historical lead in store', () => {
    renderWithRoute('lead-abc-123');
    expect(mockAddProject).toHaveBeenCalledWith('lead-abc-123');
    expect(mockSelectLead).toHaveBeenCalledWith('lead-abc-123');
  });

  it('fetches historical data via apiFetch with abort signal', async () => {
    renderWithRoute('lead-abc-123');

    await waitFor(() => {
      const calls = mockApiFetch.mock.calls;
      const urls = calls.map((c: any[]) => c[0]);
      expect(urls).toContain('/agents/lead-abc-123/messages?limit=1000&includeSystem=true');
      expect(urls).toContain('/lead/lead-abc-123/decisions');
      expect(urls).toContain('/lead/lead-abc-123/groups');
      expect(urls).toContain('/lead/lead-abc-123/dag');
      expect(urls).toContain('/lead/lead-abc-123/progress');
      // Each call should receive an options object with a signal
      calls.forEach((c: any[]) => {
        expect(c[1]).toHaveProperty('signal');
        expect(c[1].signal).toBeInstanceOf(AbortSignal);
      });
    });
  });

  it('restores previous lead selection on unmount', () => {
    const { unmount } = renderWithRoute('lead-abc-123');
    unmount();
    // Should restore the previous lead
    const lastCall = mockSelectLead.mock.calls[mockSelectLead.mock.calls.length - 1];
    expect(lastCall[0]).toBe('prev-lead-id');
  });
});
