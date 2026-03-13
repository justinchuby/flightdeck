import { describe, it, expect, vi } from 'vitest';
import { notifySecretary } from '../agents/commands/secretaryNotifier.js';
import type { CommandHandlerContext } from '../agents/commands/types.js';

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-001',
    parentId: undefined,
    role: { id: 'developer', name: 'Developer' },
    status: 'running',
    sendMessage: vi.fn(),
    ...overrides,
  } as any;
}

function makeSecretary(leadId: string, overrides: Record<string, any> = {}) {
  return makeAgent({
    id: 'secretary-001',
    parentId: leadId,
    role: { id: 'secretary', name: 'Secretary' },
    status: 'running',
    ...overrides,
  });
}

function makeCtx(agents: any[]): CommandHandlerContext {
  return {
    getAllAgents: () => agents,
  } as any;
}

describe('notifySecretary', () => {
  it('sends message to the secretary for the given lead', () => {
    const secretary = makeSecretary('lead-001');
    const ctx = makeCtx([
      makeAgent({ id: 'lead-001', role: { id: 'lead', name: 'Lead' } }),
      makeAgent({ id: 'dev-001', parentId: 'lead-001' }),
      secretary,
    ]);

    notifySecretary(ctx, 'lead-001', '[System] Task "fix-bug" completed by Developer (dev-001): Fixed the bug');

    expect(secretary.sendMessage).toHaveBeenCalledOnce();
    expect(secretary.sendMessage).toHaveBeenCalledWith(
      '[System] Task "fix-bug" completed by Developer (dev-001): Fixed the bug',
    );
  });

  it('does nothing when no secretary exists for the lead', () => {
    const otherAgent = makeAgent({ id: 'dev-001', parentId: 'lead-001' });
    const ctx = makeCtx([
      makeAgent({ id: 'lead-001', role: { id: 'lead', name: 'Lead' } }),
      otherAgent,
    ]);

    notifySecretary(ctx, 'lead-001', '[System] Some message');

    expect(otherAgent.sendMessage).not.toHaveBeenCalled();
  });

  it('skips terminated secretary agents', () => {
    const terminatedSecretary = makeSecretary('lead-001', { status: 'terminated' });
    const ctx = makeCtx([terminatedSecretary]);

    notifySecretary(ctx, 'lead-001', '[System] Some message');

    expect(terminatedSecretary.sendMessage).not.toHaveBeenCalled();
  });

  it('skips failed secretary agents', () => {
    const failedSecretary = makeSecretary('lead-001', { status: 'failed' });
    const ctx = makeCtx([failedSecretary]);

    notifySecretary(ctx, 'lead-001', '[System] Some message');

    expect(failedSecretary.sendMessage).not.toHaveBeenCalled();
  });

  it('skips secretary belonging to a different lead', () => {
    const otherLeadSecretary = makeSecretary('lead-002');
    const ctx = makeCtx([otherLeadSecretary]);

    notifySecretary(ctx, 'lead-001', '[System] Some message');

    expect(otherLeadSecretary.sendMessage).not.toHaveBeenCalled();
  });

  it('only notifies the first matching secretary', () => {
    const secretary1 = makeSecretary('lead-001', { id: 'sec-1' });
    const secretary2 = makeSecretary('lead-001', { id: 'sec-2' });
    const ctx = makeCtx([secretary1, secretary2]);

    notifySecretary(ctx, 'lead-001', '[System] Test');

    // find() returns the first match
    expect(secretary1.sendMessage).toHaveBeenCalledOnce();
    expect(secretary2.sendMessage).not.toHaveBeenCalled();
  });
});
