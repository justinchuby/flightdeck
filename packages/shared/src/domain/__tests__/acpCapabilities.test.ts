import { describe, it, expect } from 'vitest';
import { ACP_CAPABILITIES, PROVIDER_IDS } from '../../domain/index.js';

describe('ACP_CAPABILITIES (shared source of truth)', () => {
  it('has entries for all 8 providers', () => {
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
