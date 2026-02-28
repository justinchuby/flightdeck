import { describe, it, expect, vi } from 'vitest';
import { getExportCommands } from '../agents/commands/ExportCommands.js';
import type { CommandHandlerContext } from '../agents/commands/types.js';

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-lead-123',
    parentId: undefined as string | undefined,
    role: { id: 'lead', name: 'Project Lead' },
    sendMessage: vi.fn(),
    ...overrides,
  } as any;
}

function makeCtx(overrides: Record<string, any> = {}): CommandHandlerContext {
  return {
    sessionExporter: {
      export: vi.fn().mockReturnValue({
        outputDir: '/tmp/exports/session-agent-l-2026',
        files: ['summary.md', 'timeline.json', 'decisions.json', 'agents/agent-l-lead.md'],
        agentCount: 3,
        eventCount: 42,
      }),
    },
    delegations: new Map(),
    reportedCompletions: new Set(),
    pendingSystemActions: new Map(),
    ...overrides,
  } as any;
}

describe('ExportCommands', () => {
  it('registers EXPORT_SESSION command', () => {
    const cmds = getExportCommands(makeCtx());
    expect(cmds).toHaveLength(1);
    expect(cmds[0].name).toBe('EXPORT_SESSION');
  });

  it('still registers when sessionExporter is missing', () => {
    const cmds = getExportCommands(makeCtx({ sessionExporter: undefined }));
    expect(cmds).toHaveLength(1);
  });

  it('exports session for lead agent', () => {
    const ctx = makeCtx();
    const agent = makeAgent();
    const cmds = getExportCommands(ctx);
    cmds[0].handler(agent, '[[[ EXPORT_SESSION ]]]');

    expect(ctx.sessionExporter!.export).toHaveBeenCalledWith(
      'agent-lead-123',
      expect.stringContaining('.ai-crew'),
    );
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Session exported successfully'),
    );
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('4'),
    );
  });

  it('allows secretary to export using parentId as leadId', () => {
    const ctx = makeCtx();
    const agent = makeAgent({
      id: 'agent-secretary-456',
      parentId: 'agent-lead-123',
      role: { id: 'secretary', name: 'Secretary' },
    });
    const cmds = getExportCommands(ctx);
    cmds[0].handler(agent, '[[[ EXPORT_SESSION ]]]');

    expect(ctx.sessionExporter!.export).toHaveBeenCalledWith(
      'agent-lead-123',
      expect.any(String),
    );
  });

  it('rejects non-lead/secretary agents', () => {
    const ctx = makeCtx();
    const agent = makeAgent({
      role: { id: 'developer', name: 'Developer' },
    });
    const cmds = getExportCommands(ctx);
    cmds[0].handler(agent, '[[[ EXPORT_SESSION ]]]');

    expect(ctx.sessionExporter!.export).not.toHaveBeenCalled();
    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('only available to lead and secretary'),
    );
  });

  it('handles missing sessionExporter gracefully', () => {
    const ctx = makeCtx({ sessionExporter: undefined });
    const agent = makeAgent();
    const cmds = getExportCommands(ctx);
    cmds[0].handler(agent, '[[[ EXPORT_SESSION ]]]');

    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('not available'),
    );
  });

  it('handles export errors gracefully', () => {
    const ctx = makeCtx({
      sessionExporter: {
        export: vi.fn().mockImplementation(() => { throw new Error('disk full'); }),
      },
    });
    const agent = makeAgent();
    const cmds = getExportCommands(ctx);
    cmds[0].handler(agent, '[[[ EXPORT_SESSION ]]]');

    expect(agent.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Export failed: disk full'),
    );
  });

  it('matches EXPORT_SESSION regex with optional JSON body', () => {
    const cmds = getExportCommands(makeCtx());
    const regex = cmds[0].regex;
    expect(regex.test('[[[ EXPORT_SESSION ]]]')).toBe(true);
    expect(regex.test('[[[EXPORT_SESSION]]]')).toBe(true);
    expect(regex.test('[[[ EXPORT_SESSION {"format":"zip"} ]]]')).toBe(true);
  });
});
