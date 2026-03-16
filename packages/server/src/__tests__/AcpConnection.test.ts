import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Writable, Readable } from 'stream';

// ── Mock child_process ────────────────────────────────────────────
const mockSpawn = vi.fn();
const mockExecFileSync = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
  ChildProcess: EventEmitter,
}));

// ── Mock @agentclientprotocol/sdk ─────────────────────────────────
vi.mock('@agentclientprotocol/sdk', () => ({
  PROTOCOL_VERSION: '1.0',
  ndJsonStream: vi.fn(),
  ClientSideConnection: class {
    initialize = vi.fn().mockResolvedValue({ protocolVersion: '1.0', serverCapabilities: {} });
    newSession = vi.fn().mockResolvedValue({ sessionId: 'mock-session-1' });
    prompt = vi.fn().mockResolvedValue({ content: '' });
    cancel = vi.fn().mockResolvedValue(undefined);
  },
}));

// ── Mock logger ───────────────────────────────────────────────────
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import AFTER mocking
import { AcpAdapter as AcpConnection } from '../adapters/AcpAdapter.js';
import { logger } from '../utils/logger.js';

// ── Helpers ───────────────────────────────────────────────────────

/** Create a fake child process EventEmitter with piped stdin/stdout */
function createFakeProcess() {
  const proc = new EventEmitter() as any;
  proc.stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  proc.stdout = new Readable({ read() {} });
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

describe('AcpConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateCliCommand (pre-flight check)', () => {
    it('throws descriptive error when CLI binary is not found in PATH', async () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const conn = new AcpConnection();
      await expect(conn.start({
        cliCommand: 'nonexistent-binary',
        cwd: '/tmp',
      })).rejects.toThrow(/CLI binary "nonexistent-binary" not found in PATH/);
    });

    it('includes helpful hint in error message when binary not found', async () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const conn = new AcpConnection();
      await expect(conn.start({
        cliCommand: 'copilot',
        cwd: '/tmp',
      })).rejects.toThrow(/Install the provider CLI/);
    });

    it('proceeds to spawn when CLI binary exists', async () => {
      mockExecFileSync.mockReturnValue('');
      const fakeProc = createFakeProcess();
      mockSpawn.mockReturnValue(fakeProc);

      const conn = new AcpConnection();
      const startPromise = conn.start({ cliCommand: 'copilot', cwd: '/tmp' });
      await new Promise((r) => setTimeout(r, 50));

      const isWindows = process.platform === 'win32';
      expect(mockSpawn).toHaveBeenCalledWith(
        'copilot',
        expect.arrayContaining(['--acp', '--stdio']),
        expect.objectContaining({ cwd: '/tmp', detached: !isWindows }),
      );

      fakeProc.emit('exit', 1);
      await startPromise.catch(() => {});
    });

    it('spawns child in its own process group (detached) to prevent double-SIGINT', async () => {
      mockExecFileSync.mockReturnValue('');
      const fakeProc = createFakeProcess();
      fakeProc.unref = vi.fn();
      mockSpawn.mockReturnValue(fakeProc);

      const conn = new AcpConnection();
      const startPromise = conn.start({ cliCommand: 'copilot', cwd: '/tmp' });
      await new Promise((r) => setTimeout(r, 50));

      const isWindows = process.platform === 'win32';
      const spawnOpts = mockSpawn.mock.calls[0][2];
      expect(spawnOpts.detached).toBe(!isWindows);
      if (isWindows) {
        expect(fakeProc.unref).not.toHaveBeenCalled();
      } else {
        expect(fakeProc.unref).toHaveBeenCalled();
      }

      fakeProc.emit('exit', 1);
      await startPromise.catch(() => {});
    });

    it('uses execFileSync with "which" on Unix (no shell injection)', async () => {
      mockExecFileSync.mockReturnValue('/usr/local/bin/copilot');
      const fakeProc = createFakeProcess();
      mockSpawn.mockReturnValue(fakeProc);

      const conn = new AcpConnection();
      const startPromise = conn.start({ cliCommand: 'copilot', cwd: '/tmp' });
      await new Promise((r) => setTimeout(r, 50));

      if (process.platform !== 'win32') {
        expect(mockExecFileSync).toHaveBeenCalledWith(
          'which',
          ['copilot'],
          expect.objectContaining({ timeout: 3000 }),
        );
      }

      fakeProc.emit('exit', 1);
      await startPromise.catch(() => {});
    });
  });

  describe('process error handler', () => {
    it('emits exit(1) and logs error when spawn emits error event', async () => {
      mockExecFileSync.mockReturnValue('');
      const fakeProc = createFakeProcess();
      mockSpawn.mockReturnValue(fakeProc);

      const conn = new AcpConnection();
      const exitEvents: number[] = [];
      conn.on('exit', (code: number) => exitEvents.push(code));

      const startPromise = conn.start({ cliCommand: 'copilot', cwd: '/tmp' });
      await new Promise((r) => setTimeout(r, 50));

      const spawnError = Object.assign(new Error('spawn copilot ENOENT'), { code: 'ENOENT' });
      fakeProc.emit('error', spawnError);

      await startPromise.catch(() => {});

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'acp',
          msg: 'Spawn error',
          cliCommand: 'copilot',
          code: 'ENOENT',
        }),
      );
      expect(exitEvents).toContain(1);
    });

    it('does not crash the process on spawn error', async () => {
      mockExecFileSync.mockReturnValue('');
      const fakeProc = createFakeProcess();
      mockSpawn.mockReturnValue(fakeProc);

      const conn = new AcpConnection();
      const startPromise = conn.start({ cliCommand: 'copilot', cwd: '/tmp' });
      await new Promise((r) => setTimeout(r, 50));

      const spawnError = Object.assign(new Error('spawn EACCES'), { code: 'EACCES' });
      expect(() => fakeProc.emit('error', spawnError)).not.toThrow();

      await startPromise.catch(() => {});
    });

    it('sets isConnected to false on spawn error', async () => {
      mockExecFileSync.mockReturnValue('');
      const fakeProc = createFakeProcess();
      mockSpawn.mockReturnValue(fakeProc);

      const conn = new AcpConnection();
      const startPromise = conn.start({ cliCommand: 'copilot', cwd: '/tmp' });
      await new Promise((r) => setTimeout(r, 50));

      fakeProc.emit('error', new Error('spawn failed'));

      await startPromise.catch(() => {});
      expect(conn.isConnected).toBe(false);
    });

    it('emits exit only once when both error and exit events fire', async () => {
      mockExecFileSync.mockReturnValue('');
      const fakeProc = createFakeProcess();
      mockSpawn.mockReturnValue(fakeProc);

      const conn = new AcpConnection();
      const exitEvents: (number | null)[] = [];
      conn.on('exit', (code: number | null) => exitEvents.push(code));

      const startPromise = conn.start({ cliCommand: 'copilot', cwd: '/tmp' });
      await new Promise((r) => setTimeout(r, 50));

      const spawnError = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
      fakeProc.emit('error', spawnError);
      fakeProc.emit('exit', null);

      await startPromise.catch(() => {});

      expect(exitEvents).toHaveLength(1);
      expect(exitEvents[0]).toBe(1);
    });

    it('normalizes null exit code to 1 when process killed by signal', async () => {
      mockExecFileSync.mockReturnValue('');
      const fakeProc = createFakeProcess();
      mockSpawn.mockReturnValue(fakeProc);

      const conn = new AcpConnection();
      const exitEvents: number[] = [];
      conn.on('exit', (code: number) => exitEvents.push(code));

      const startPromise = conn.start({ cliCommand: 'copilot', cwd: '/tmp' });
      await new Promise((r) => setTimeout(r, 50));

      // Simulate signal kill: code=null, signal='SIGTERM'
      fakeProc.emit('exit', null, 'SIGTERM');

      await startPromise.catch(() => {});

      expect(exitEvents).toEqual([1]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'acp',
          msg: 'Process exited via signal',
          signal: 'SIGTERM',
        }),
      );
    });

    it('preserves numeric exit code when process exits normally', async () => {
      mockExecFileSync.mockReturnValue('');
      const fakeProc = createFakeProcess();
      mockSpawn.mockReturnValue(fakeProc);

      const conn = new AcpConnection();
      const exitEvents: number[] = [];
      conn.on('exit', (code: number) => exitEvents.push(code));

      const startPromise = conn.start({ cliCommand: 'copilot', cwd: '/tmp' });
      await new Promise((r) => setTimeout(r, 50));

      fakeProc.emit('exit', 0, null);

      await startPromise.catch(() => {});

      expect(exitEvents).toEqual([0]);
    });
  });
});
