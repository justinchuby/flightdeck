import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { Database } from '../db/database.js';
import { ProjectRegistry } from '../projects/ProjectRegistry.js';
import { projectsRoutes } from '../routes/projects.js';
import { DEFAULT_MODEL_CONFIG } from '../projects/ModelConfigDefaults.js';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('Model Config API Routes', () => {
  let server: Server;
  let baseUrl: string;
  let db: Database;
  let projectRegistry: ProjectRegistry;
  let projectId: string;

  beforeAll(async () => {
    db = new Database(':memory:');
    projectRegistry = new ProjectRegistry(db);

    const ctx = {
      agentManager: {} as any,
      roleRegistry: {} as any,
      config: {} as any,
      db,
      lockRegistry: {} as any,
      activityLedger: {} as any,
      decisionLog: {} as any,
      projectRegistry,
    };

    const app = express();
    app.use(express.json());
    app.use(projectsRoutes(ctx));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const port = (server.address() as AddressInfo).port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server?.close();
  });

  beforeEach(() => {
    const project = projectRegistry.create('Test Project');
    projectId = project.id;
  });

  async function get(path: string) {
    return fetch(`${baseUrl}${path}`);
  }

  async function put(path: string, body: unknown) {
    return fetch(`${baseUrl}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  describe('GET /projects/:id/model-config', () => {
    it('returns defaults for new project', async () => {
      const res = await get(`/projects/${projectId}/model-config`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.defaults).toEqual(DEFAULT_MODEL_CONFIG);
      expect(data.config).toEqual(DEFAULT_MODEL_CONFIG);
    });

    it('returns 404 for unknown project', async () => {
      const res = await get('/projects/nonexistent/model-config');
      expect(res.status).toBe(404);
    });

    it('reflects custom config after PUT', async () => {
      await put(`/projects/${projectId}/model-config`, {
        config: { developer: ['claude-sonnet-4.6'] },
      });

      const res = await get(`/projects/${projectId}/model-config`);
      const data = await res.json();
      expect(data.config.developer).toEqual(['claude-sonnet-4.6']);
      expect(data.config.architect).toEqual(DEFAULT_MODEL_CONFIG.architect);
    });
  });

  describe('PUT /projects/:id/model-config', () => {
    it('updates config and returns merged result', async () => {
      const res = await put(`/projects/${projectId}/model-config`, {
        config: { secretary: ['claude-haiku-4.5'] },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.config.secretary).toEqual(['claude-haiku-4.5']);
      expect(data.config.developer).toEqual(DEFAULT_MODEL_CONFIG.developer);
    });

    it('rejects unknown model IDs', async () => {
      const res = await put(`/projects/${projectId}/model-config`, {
        config: { developer: ['totally-fake-model'] },
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('totally-fake-model');
    });

    it('rejects invalid shape — non-object config', async () => {
      const res = await put(`/projects/${projectId}/model-config`, {
        config: 'not-an-object',
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid shape — non-array values', async () => {
      const res = await put(`/projects/${projectId}/model-config`, {
        config: { developer: 'claude-opus-4.6' },
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid shape — non-string elements', async () => {
      const res = await put(`/projects/${projectId}/model-config`, {
        config: { developer: [123] },
      });
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown project', async () => {
      const res = await put('/projects/nonexistent/model-config', {
        config: { developer: ['claude-opus-4.6'] },
      });
      expect(res.status).toBe(404);
    });

    it('accepts empty config to restore defaults', async () => {
      await put(`/projects/${projectId}/model-config`, {
        config: { developer: ['claude-haiku-4.5'] },
      });
      const res = await put(`/projects/${projectId}/model-config`, {
        config: {},
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.config).toEqual(DEFAULT_MODEL_CONFIG);
    });
  });
});
