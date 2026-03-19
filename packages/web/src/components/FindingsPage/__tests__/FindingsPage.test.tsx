import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FindingsPage } from '../FindingsPage';
import { getAllProviders, ACP_CAPABILITIES, PROVIDER_IDS, type ProviderId } from '@flightdeck/shared';

function renderPage() {
  return render(
    <MemoryRouter>
      <FindingsPage />
    </MemoryRouter>,
  );
}

describe('FindingsPage', () => {
  it('renders without crashing', () => {
    renderPage();
    expect(screen.getByTestId('findings-page')).toBeInTheDocument();
  });

  it('shows the page title', () => {
    renderPage();
    expect(screen.getByText('ACP Capability Research')).toBeInTheDocument();
  });

  it('renders all section cards', () => {
    renderPage();
    expect(screen.getByText('Protocol Overview')).toBeInTheDocument();
    expect(screen.getByText(/Unused Capabilities/)).toBeInTheDocument();
    expect(screen.getByText('Capability Comparison')).toBeInTheDocument();
    expect(screen.getByText('Provider Details')).toBeInTheDocument();
    expect(screen.getByText('Per-Provider Features')).toBeInTheDocument();
    expect(screen.getByText('ACP SDK Type Definitions')).toBeInTheDocument();
    expect(screen.getByText('Recommendations')).toBeInTheDocument();
    expect(screen.getByText('Key Findings')).toBeInTheDocument();
  });

  it('renders the capability matrix table', () => {
    renderPage();
    expect(screen.getByTestId('capability-matrix')).toBeInTheDocument();
  });

  it('renders all 6 providers in the matrix', () => {
    renderPage();
    const providers = getAllProviders();
    for (const p of providers) {
      expect(screen.getAllByText(p.name).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('marks Cursor and OpenCode as Preview', () => {
    renderPage();
    const previews = screen.getAllByText('Preview');
    expect(previews.length).toBeGreaterThanOrEqual(2);
  });

  it('mentions Codex resume limitation in key findings', () => {
    renderPage();
    // Text spans multiple elements, search in the full page text
    const page = screen.getByTestId('findings-page');
    expect(page.textContent).toContain('Codex');
    expect(page.textContent).toContain('does NOT support session resume');
  });
});

describe('ACP_CAPABILITIES (shared source of truth)', () => {
  it('has entries for all 6 providers', () => {
    for (const id of PROVIDER_IDS) {
      expect(ACP_CAPABILITIES[id]).toBeDefined();
    }
  });

  it('all probed providers have a version', () => {
    for (const id of PROVIDER_IDS) {
      const cap = ACP_CAPABILITIES[id];
      if (cap.probed) {
        expect(cap.probeVersion).toBeTruthy();
      }
    }
  });

  it('copilot has correct probe data', () => {
    const cap = ACP_CAPABILITIES.copilot;
    expect(cap.probed).toBe(true);
    expect(cap.images).toBe(true);
    expect(cap.audio).toBe(false);
    expect(cap.embeddedContext).toBe(true);
    expect(cap.loadSession).toBe(true);
    expect(cap.mcpHttp).toBe(false);
  });

  it('claude has MCP support (http+sse)', () => {
    const cap = ACP_CAPABILITIES.claude;
    expect(cap.mcpHttp).toBe(true);
    expect(cap.mcpSse).toBe(true);
    expect(cap.sessionResume).toBe(true);
    expect(cap.sessionFork).toBe(true);
  });

  it('gemini has audio support', () => {
    const cap = ACP_CAPABILITIES.gemini;
    expect(cap.audio).toBe(true);
    expect(cap.mcpHttp).toBe(true);
    expect(cap.mcpSse).toBe(true);
  });

  it('codex has no session resume', () => {
    const cap = ACP_CAPABILITIES.codex;
    expect(cap.sessionResume).toBe(false);
    expect(cap.mcpHttp).toBe(true);
    expect(cap.mcpSse).toBe(false);
  });

  it('unprobed providers have probed=false', () => {
    expect(ACP_CAPABILITIES.cursor.probed).toBe(false);
    expect(ACP_CAPABILITIES.opencode.probed).toBe(false);
  });

  it('every entry has required fields', () => {
    for (const id of PROVIDER_IDS) {
      const cap = ACP_CAPABILITIES[id];
      expect(typeof cap.images).toBe('boolean');
      expect(typeof cap.audio).toBe('boolean');
      expect(typeof cap.mcpHttp).toBe('boolean');
      expect(typeof cap.mcpSse).toBe('boolean');
      expect(typeof cap.embeddedContext).toBe('boolean');
      expect(typeof cap.loadSession).toBe('boolean');
      expect(typeof cap.systemPromptMethod).toBe('string');
      expect(typeof cap.authMethod).toBe('string');
      expect(typeof cap.probed).toBe('boolean');
    }
  });
});
