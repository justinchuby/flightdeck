// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { parseAgentReport, AgentReportBlock } from '../AgentReportBlock';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('parseAgentReport', () => {
  it('returns isReport false for plain text', () => {
    const result = parseAgentReport('Hello world');
    expect(result.isReport).toBe(false);
  });

  it('parses [Agent Report] with header', () => {
    const result = parseAgentReport('[Agent Report] Developer completed work');
    expect(result.isReport).toBe(true);
    expect(result.isAck).toBe(false);
    expect(result.header).toBe('Developer completed work');
  });

  it('parses task and session fields', () => {
    const content = `[Agent Report] Done
Task: Fix login bug
Session ID: sess-123
Output summary: All tests pass`;
    const result = parseAgentReport(content);
    expect(result.task).toBe('Fix login bug');
    expect(result.sessionId).toBe('sess-123');
    expect(result.output).toBe('All tests pass');
  });

  it('parses [Agent ACK] messages', () => {
    const result = parseAgentReport('[Agent ACK] Dev acknowledged task: build the feature');
    expect(result.isReport).toBe(true);
    expect(result.isAck).toBe(true);
    expect(result.task).toBe('build the feature');
  });

  it('strips command blocks from output', () => {
    const content = `[Agent Report] Done
Output summary: Fixed it ⟦⟦ COMPLETE_TASK {"summary":"done"} ⟧⟧ and moved on`;
    const result = parseAgentReport(content);
    expect(result.output).not.toContain('COMPLETE_TASK');
  });
});

describe('AgentReportBlock', () => {
  it('renders plain text when not a report', () => {
    render(<AgentReportBlock content="Just some text" />);
    expect(screen.getByText('Just some text')).toBeDefined();
  });

  it('renders ACK messages inline', () => {
    render(<AgentReportBlock content="[Agent ACK] Dev acknowledged task: build it" />);
    expect(screen.getByText('Dev')).toBeDefined();
  });

  it('renders compact mode', () => {
    render(<AgentReportBlock content="[Agent Report] Developer done" compact />);
    expect(screen.getByText('Developer done')).toBeDefined();
  });

  it('renders full report with header and task', () => {
    const content = `[Agent Report] All done
Task: Fix the bug
Output summary: Tests pass`;
    render(<AgentReportBlock content={content} />);
    expect(screen.getByText('All done')).toBeDefined();
    expect(screen.getByText('Fix the bug')).toBeDefined();
    expect(screen.getByText('Tests pass')).toBeDefined();
  });

  it('renders session ID with copy button', () => {
    const content = `[Agent Report] Done
Session ID: sess-abc-123`;
    render(<AgentReportBlock content={content} />);
    expect(screen.getByText('sess-abc-123')).toBeDefined();
    expect(screen.getByText('copy')).toBeDefined();
  });
});
