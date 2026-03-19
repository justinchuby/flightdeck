import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, Server } from 'http';
import { WebSocketServer as WsServer } from 'ws';
import { AddressInfo } from 'net';

/**
 * Mirrors the listenWithRetry function from index.ts to test auto-port-finding.
 * Tries successive ports starting from basePort, skipping EADDRINUSE errors.
 * NOTE: Keep in sync with listenWithRetry in packages/server/src/index.ts
 */
async function listenWithRetry(
  server: Server,
  basePort: number,
  host: string,
  maxAttempts = 10,
): Promise<number> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = basePort + attempt;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      return port;
    } catch (err: any) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }
  throw new Error(`No available port found in range ${basePort}–${basePort + maxAttempts - 1}`);
}

describe('Server EADDRINUSE error handling', () => {
  const servers: Server[] = [];
  const wssInstances: WsServer[] = [];

  afterEach(() => {
    for (const wss of wssInstances) { try { wss.close(); } catch {} }
    wssInstances.length = 0;
    for (const s of servers) { try { s.close(); } catch {} }
    servers.length = 0;
  });

  it('listenWithRetry skips occupied ports and binds to the next available one', async () => {
    // Occupy a port first
    const blocker = createServer();
    servers.push(blocker);
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const blockedPort = (blocker.address() as AddressInfo).port;

    // Now try to bind starting at the blocked port
    const server = createServer();
    servers.push(server);
    const actualPort = await listenWithRetry(server, blockedPort, '127.0.0.1', 10);

    expect(actualPort).toBeGreaterThan(blockedPort);
    expect(actualPort).toBeLessThanOrEqual(blockedPort + 9);
  });

  it('listenWithRetry throws when all ports are exhausted', async () => {
    // Create a server that always rejects with EADDRINUSE
    const server = createServer();
    servers.push(server);

    const originalListen = server.listen.bind(server);
    let attempts = 0;
    server.listen = function fakeListen(...args: any[]) {
      attempts++;
      // Emit EADDRINUSE on next tick to mimic real behavior
      process.nextTick(() => server.emit('error',
        Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }),
      ));
      return server;
    } as any;

    await expect(
      listenWithRetry(server, 50000, '127.0.0.1', 3),
    ).rejects.toThrow(/No available port found/);

    expect(attempts).toBe(3);

    // Restore so cleanup doesn't fail
    server.listen = originalListen;
  });

  it('WebSocketServer shares the HTTP server port automatically', async () => {
    const server = createServer();
    servers.push(server);
    const wss = new WsServer({ server, path: '/ws' });
    wssInstances.push(wss);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const httpPort = (server.address() as AddressInfo).port;

    // WSS is attached to the same server — no separate port needed.
    // Verify the WSS is wired to the server by checking the address matches.
    expect(httpPort).toBeGreaterThan(0);
    expect(wss.address()).toEqual(server.address());
  });

  it('WSS error handler prevents unhandled crash', () => {
    const server = createServer();
    servers.push(server);
    server.on('error', () => {}); // prevent unhandled on HTTP server

    const wss = new WsServer({ server, path: '/ws' });
    wssInstances.push(wss);

    const errors: string[] = [];
    wss.on('error', (err: Error) => {
      errors.push(err.message);
    });

    const err = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
    // Should not throw — error handler catches it
    expect(() => wss.emit('error', err)).not.toThrow();
    expect(errors).toContain('listen EADDRINUSE');
  });

  it('permanent httpServer error handler catches runtime errors', () => {
    const server = createServer();
    servers.push(server);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Mirrors the permanent handler from index.ts (added after successful bind)
    server.on('error', (err: NodeJS.ErrnoException) => {
      console.error(`\n❌ HTTP server error: ${err.message}`);
      process.exit(1);
    });

    const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    server.emit('error', err);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('EACCES: permission denied'),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
