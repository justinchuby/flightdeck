import { describe, it, expect, beforeEach } from 'vitest';
import {
  redact,
  redactObject,
  containsSecrets,
  redactWsMessage,
  configureRedaction,
} from '../redaction.js';

beforeEach(() => {
  configureRedaction(); // reset to defaults
});

// ── redact() pattern coverage ─────────────────────────────────────────

describe('redact()', () => {
  it('redacts AWS access keys (AKIA...)', () => {
    const result = redact('key=AKIA1234567890ABCDEF');
    expect(result.text).toBe('key=AKIA***REDACTED***');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts GitHub tokens (ghp_)', () => {
    const token = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm';
    const result = redact(`token: ${token}`);
    expect(result.text).toContain('***GITHUB_TOKEN_REDACTED***');
    expect(result.text).not.toContain('ghp_');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts GitHub fine-grained PATs (github_pat_)', () => {
    const pat = 'github_pat_11AABBC2D3EFGHIJKLMNO4_abcdefghijklmnop';
    const result = redact(`Found: ${pat}`);
    expect(result.text).toContain('***GITHUB_PAT_REDACTED***');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts Anthropic API keys (sk-ant-...)', () => {
    const key = 'sk-ant-api03-abcdef1234567890abcdef';
    const result = redact(`Found key: ${key}`);
    expect(result.text).toContain('***ANTHROPIC_KEY_REDACTED***');
    expect(result.redactionCount).toBeGreaterThanOrEqual(1);
  });

  it('redacts OpenAI API keys (sk-...)', () => {
    const key = 'sk-proj-abcdef1234567890abcdef';
    const result = redact(`key: ${key}`);
    expect(result.text).toContain('***OPENAI_KEY_REDACTED***');
    expect(result.redactionCount).toBe(1);
  });

  it('does not match Anthropic keys as OpenAI keys', () => {
    const key = 'sk-ant-api03-abcdef1234567890abcdef';
    const result = redact(key);
    expect(result.text).toContain('ANTHROPIC');
    expect(result.text).not.toContain('OPENAI');
  });

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.Gfx6VO9tcxwk6xqx9yYzSfebfeakZp5JYIgP_edcw_A';
    const result = redact(`Bearer ${jwt}`);
    expect(result.text).toContain('***JWT_REDACTED***');
    expect(result.redactionCount).toBeGreaterThanOrEqual(1);
  });

  it('redacts Bearer tokens in Authorization headers', () => {
    const result = redact('Authorization: Bearer eyABCDEFGHIJKLMNOPQRSTUVWXYZ.1234567890');
    expect(result.text).toContain('***BEARER_REDACTED***');
  });

  it('redacts connection strings', () => {
    const result = redact('db: postgresql://user:pass@host:5432/db');
    expect(result.text).toContain('***CONNECTION_STRING_REDACTED***');
    expect(result.text).not.toContain('user:pass');
  });

  it('redacts PEM private keys', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----';
    const result = redact(`Found key: ${pem}`);
    expect(result.text).toContain('***PRIVATE_KEY_REDACTED***');
    expect(result.text).not.toContain('MIIEvgIBADANBg');
  });

  it('redacts RSA private keys', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END RSA PRIVATE KEY-----';
    const result = redact(pem);
    expect(result.text).toContain('***PRIVATE_KEY_REDACTED***');
  });

  it('redacts .env-style sensitive values', () => {
    const result = redact('API_KEY=my-super-secret-key-12345');
    expect(result.text).toContain('***REDACTED***');
    expect(result.text).not.toContain('my-super-secret');
  });

  it('redacts hex tokens after key context', () => {
    const hex = 'a'.repeat(32);
    const result = redact(`token: "${hex}"`);
    expect(result.text).toContain('***TOKEN_REDACTED***');
  });

  it('returns unchanged input when no secrets found', () => {
    const safe = 'This is a normal log message about building the project.';
    const result = redact(safe);
    expect(result.text).toBe(safe);
    expect(result.redactionCount).toBe(0);
  });

  it('handles empty string', () => {
    expect(redact('').text).toBe('');
    expect(redact('').redactionCount).toBe(0);
  });

  it('handles short strings (< 8 chars) without scanning', () => {
    expect(redact('abc').text).toBe('abc');
    expect(redact('abc').redactionCount).toBe(0);
  });

  it('handles multiple secrets in one string', () => {
    const input = 'KEY1=AKIA1234567890ABCDEF and KEY2=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm';
    const result = redact(input);
    expect(result.text).toContain('AKIA***REDACTED***');
    expect(result.text).toContain('***GITHUB_TOKEN_REDACTED***');
    expect(result.redactionCount).toBeGreaterThanOrEqual(2);
  });
});

// ── containsSecrets() ─────────────────────────────────────────────────

describe('containsSecrets()', () => {
  it('returns true for strings with secrets', () => {
    expect(containsSecrets('key=AKIA1234567890ABCDEF')).toBe(true);
  });

  it('returns false for safe strings', () => {
    expect(containsSecrets('This is a normal message')).toBe(false);
  });

  it('returns false for short strings', () => {
    expect(containsSecrets('short')).toBe(false);
  });

  it('returns false for empty strings', () => {
    expect(containsSecrets('')).toBe(false);
  });
});

// ── redactObject() ────────────────────────────────────────────────────

describe('redactObject()', () => {
  it('redacts string values containing secrets', () => {
    const obj = { msg: 'Found key AKIA1234567890ABCDEF in output' };
    const result = redactObject(obj);
    expect(result.data.msg).toContain('AKIA***REDACTED***');
    expect(result.redactionCount).toBe(1);
  });

  it('redacts values whose keys match sensitive patterns', () => {
    const obj = { api_key: 'some-value-here', name: 'safe' };
    const result = redactObject(obj);
    expect(result.data.api_key).toBe('***REDACTED***');
    expect(result.data.name).toBe('safe');
  });

  it('redacts nested object values', () => {
    const obj = { config: { password: 'supersecret123' } };
    const result = redactObject(obj);
    expect((result.data.config as Record<string, unknown>).password).toBe('***REDACTED***');
  });

  it('handles arrays within objects', () => {
    const obj = { keys: ['AKIA1234567890ABCDEF', 'safe-value'] };
    const result = redactObject(obj);
    const keys = result.data.keys as string[];
    expect(keys[0]).toContain('AKIA***REDACTED***');
    expect(keys[1]).toBe('safe-value');
  });

  it('handles null and undefined values', () => {
    const obj = { a: null, b: undefined, c: 'safe' };
    const result = redactObject(obj);
    expect(result.data.a).toBeNull();
    expect(result.data.b).toBeUndefined();
    expect(result.data.c).toBe('safe');
  });

  it('does not mutate the original object', () => {
    const obj = { api_key: 'my-secret' };
    redactObject(obj);
    expect(obj.api_key).toBe('my-secret');
  });

  it('handles number and boolean values unchanged', () => {
    const obj = { count: 42, active: true };
    const result = redactObject(obj);
    expect(result.data.count).toBe(42);
    expect(result.data.active).toBe(true);
  });
});

// ── redactWsMessage() ─────────────────────────────────────────────────

describe('redactWsMessage()', () => {
  it('redacts agent:text messages', () => {
    const msg = { type: 'agent:text', agentId: 'a1', text: 'Found AKIA1234567890ABCDEF' };
    const result = redactWsMessage(msg);
    expect(result.text).toContain('AKIA***REDACTED***');
  });

  it('redacts agent:thinking messages', () => {
    const msg = { type: 'agent:thinking', agentId: 'a1', text: 'Saw key sk-proj-abcdef1234567890abcdef' };
    const result = redactWsMessage(msg);
    expect(result.text).toContain('***OPENAI_KEY_REDACTED***');
  });

  it('passes through agent:spawned unchanged', () => {
    const msg = { type: 'agent:spawned', agentId: 'a1', role: 'developer' };
    const result = redactWsMessage(msg);
    expect(result).toEqual(msg);
  });

  it('passes through dag:updated unchanged', () => {
    const msg = { type: 'dag:updated', leadId: 'lead-1' };
    const result = redactWsMessage(msg);
    expect(result).toEqual(msg);
  });

  it('redacts activity messages', () => {
    const msg = {
      type: 'activity',
      entry: { summary: 'Found AKIA1234567890ABCDEF', details: { key: 'safe' } },
    };
    const result = redactWsMessage(msg);
    const entry = result.entry as Record<string, unknown>;
    expect(entry.summary).toContain('AKIA***REDACTED***');
  });

  it('redacts agent:content messages using content field', () => {
    const msg = { type: 'agent:content', agentId: 'a1', content: 'Key is AKIA1234567890ABCDEF' };
    const result = redactWsMessage(msg);
    expect(result.content).toContain('AKIA***REDACTED***');
    expect(result).not.toHaveProperty('text');
  });

  it('redacts agent:message_sent messages', () => {
    const msg = {
      type: 'agent:message_sent',
      from: 'agent-1',
      fromRole: 'developer',
      to: 'agent-2',
      toRole: 'lead',
      content: 'Token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcd',
    };
    const result = redactWsMessage(msg);
    expect(result.content).toContain('***GITHUB_TOKEN_REDACTED***');
    expect(result.from).toBe('agent-1');
    expect(result.to).toBe('agent-2');
  });

  it('handles messages without type field', () => {
    const msg = { data: 'something' };
    const result = redactWsMessage(msg);
    expect(result).toEqual(msg);
  });
});

// ── configureRedaction() ──────────────────────────────────────────────

describe('configureRedaction()', () => {
  it('can disable redaction entirely', () => {
    configureRedaction({ enabled: false });
    const result = redact('AKIA1234567890ABCDEF');
    expect(result.text).toContain('AKIA1234567890ABCDEF');
    expect(result.redactionCount).toBe(0);
  });

  it('supports extra custom patterns', () => {
    configureRedaction({
      extraPatterns: [
        { name: 'custom', pattern: /CUSTOM-[A-Z0-9]{8}/g, replacement: '***CUSTOM***' },
      ],
    });
    const result = redact('token: CUSTOM-ABCD1234');
    expect(result.text).toContain('***CUSTOM***');
  });

  it('supports disabling specific built-in patterns', () => {
    configureRedaction({ disabledPatterns: ['aws-access-key'] });
    const result = redact('AKIA1234567890ABCDEF');
    // AWS pattern disabled, so no redaction for this specific pattern
    expect(result.text).toContain('AKIA1234567890ABCDEF');
  });

  it('resets to defaults when called with no args', () => {
    configureRedaction({ enabled: false });
    expect(redact('AKIA1234567890ABCDEF').redactionCount).toBe(0);
    configureRedaction(); // reset
    expect(redact('AKIA1234567890ABCDEF').redactionCount).toBeGreaterThan(0);
  });
});

// ── Adversarial Tests ─────────────────────────────────────────────────

describe('adversarial inputs', () => {
  it('catches secrets in JSON strings', () => {
    const json = '{"key": "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm"}';
    expect(redact(json).text).toContain('***GITHUB_TOKEN_REDACTED***');
  });

  it('catches secrets in markdown code blocks', () => {
    const md = '```\nAPI_KEY=my-super-secret-value\n```';
    const result = redact(md);
    expect(result.text).toContain('***REDACTED***');
  });

  it('catches multiple connection strings', () => {
    const input = 'primary: postgresql://admin:pass@db1:5432/app secondary: mysql://root:secret@db2:3306/app';
    const result = redact(input);
    expect(result.text).not.toContain('admin:pass');
    expect(result.text).not.toContain('root:secret');
    expect(result.redactionCount).toBeGreaterThanOrEqual(2);
  });

  it('does not false-positive on normal code', () => {
    const code = `
      const skeleton = "loading...";
      const skipNavLink = document.getElementById("skip-nav");
      function handleClick() { return true; }
    `;
    const result = redact(code);
    expect(result.redactionCount).toBe(0);
    expect(result.text).toBe(code);
  });

  it('does not false-positive on short hex IDs', () => {
    const result = redact('agentId: a1b2c3d4');
    expect(result.redactionCount).toBe(0);
  });

  it('handles very long strings without crashing', () => {
    const long = 'a'.repeat(100000);
    const result = redact(long);
    expect(result.text).toBe(long);
    expect(result.redactionCount).toBe(0);
  });
});
