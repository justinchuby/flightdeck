import { test, expect } from '@playwright/test';

/**
 * E2E tests for the Oversight System (prompt-only model).
 *
 * Tests:
 * 1. Global oversight level UI (Settings page, emoji labels, persistence)
 * 2. Per-project oversight override via API
 * 3. Default oversight level
 * 4. User input (ask_user) API
 * 5. User input dialog UI
 * 6. Config YAML oversight API
 * 7. Agent spawn
 * 8. Settings navigation
 */

// ── Helpers ────────────────────────────────────────────────

/** Dismiss onboarding/setup wizards by pre-setting localStorage flags. */
async function dismissWizards(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('onboarding-complete', 'true');
    localStorage.setItem('flightdeck-setup-completed', 'true');
  });
}

/** Clean up all agents after each test. */
async function cleanup(page: import('@playwright/test').Page) {
  const agents = await (await page.request.get('/api/agents')).json();
  for (const agent of agents) {
    await page.request.delete(`/api/agents/${agent.id}`);
  }
}

// ── Global Oversight Level UI ───────────────────────────────

test.describe('Global Oversight Level', () => {
  test.beforeEach(async ({ page }) => { await dismissWizards(page); });
  test.afterEach(async ({ page }) => { await cleanup(page); });

  test('settings page shows oversight section with emoji labels', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('[data-testid="oversight-section"]')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('🔍 Supervised')).toBeVisible();
    await expect(page.getByText('⚖️ Balanced')).toBeVisible();
    await expect(page.getByText('🚀 Autonomous')).toBeVisible();
  });

  test('clicking oversight level button changes selection', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('[data-testid="oversight-section"]')).toBeVisible({ timeout: 5000 });

    await page.locator('[data-testid="oversight-supervised"]').click();
    await expect(page.locator('[data-testid="oversight-supervised"] input[type="radio"]')).toBeChecked();

    await page.locator('[data-testid="oversight-balanced"]').click();
    await expect(page.locator('[data-testid="oversight-balanced"] input[type="radio"]')).toBeChecked();

    await page.locator('[data-testid="oversight-autonomous"]').click();
    await expect(page.locator('[data-testid="oversight-autonomous"] input[type="radio"]')).toBeChecked();
  });

  test('oversight level persists across page reload', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('[data-testid="oversight-section"]')).toBeVisible({ timeout: 5000 });

    await page.locator('[data-testid="oversight-supervised"]').click();
    await expect(page.locator('[data-testid="oversight-supervised"] input[type="radio"]')).toBeChecked();
    await page.waitForTimeout(500);

    await page.reload();
    await expect(page.locator('[data-testid="oversight-section"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="oversight-supervised"] input[type="radio"]')).toBeChecked();

    await page.locator('[data-testid="oversight-autonomous"]').click();
  });
});

// ── Per-Project Oversight (API) ─────────────────────────────

test.describe('Per-Project Oversight (API)', () => {
  let projectId: string;

  test.beforeEach(async ({ page }) => {
    await dismissWizards(page);
    const res = await page.request.post('/api/projects', {
      data: { name: 'Oversight Test Project', description: 'test' },
    });
    const project = await res.json();
    projectId = project.id;
  });

  test.afterEach(async ({ page }) => {
    if (projectId) {
      await page.request.delete(`/api/projects/${projectId}`).catch(() => {});
    }
    await cleanup(page);
  });

  test('PATCH /projects/:id sets oversight level', async ({ page }) => {
    const res = await page.request.patch(`/api/projects/${projectId}`, {
      data: { oversightLevel: 'supervised' },
    });
    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    expect(updated.oversightLevel).toBe('supervised');

    const getRes = await page.request.get(`/api/projects/${projectId}`);
    const project = await getRes.json();
    expect(project.oversightLevel).toBe('supervised');
  });

  test('PATCH /projects/:id rejects invalid oversight level', async ({ page }) => {
    const res = await page.request.patch(`/api/projects/${projectId}`, {
      data: { oversightLevel: 'invalid-level' },
    });
    expect(res.status()).toBe(400);
  });

  test('PATCH /projects/:id can clear oversight override with null', async ({ page }) => {
    await page.request.patch(`/api/projects/${projectId}`, {
      data: { oversightLevel: 'supervised' },
    });
    const res = await page.request.patch(`/api/projects/${projectId}`, {
      data: { oversightLevel: null },
    });
    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    expect(updated.oversightLevel).toBeNull();
  });
});

// ── Default Oversight Level ─────────────────────────────────

test.describe('Default Oversight Level', () => {
  test('config API returns valid oversight level', async ({ page }) => {
    const res = await page.request.get('/api/config/yaml');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    if (data.oversight?.level) {
      expect(['supervised', 'balanced', 'autonomous']).toContain(data.oversight.level);
    }
  });
});

// ── User Input API ──────────────────────────────────────────

test.describe('User Input API', () => {
  test.afterEach(async ({ page }) => { await cleanup(page); });

  test('POST /agents/:id/user-input returns 404 for non-existent agent', async ({ page }) => {
    const res = await page.request.post('/api/agents/non-existent/user-input', {
      data: { response: 'test response' },
    });
    expect(res.status()).toBe(404);
  });

  test('POST /agents/:id/user-input rejects missing response', async ({ page }) => {
    const spawnRes = await page.request.post('/api/agents', {
      data: { roleId: 'developer', task: 'test task' },
    });
    const agent = await spawnRes.json();
    const res = await page.request.post(`/api/agents/${agent.id}/user-input`, {
      data: {},
    });
    expect(res.status()).toBe(400);
  });
});

// ── User Input Dialog UI ────────────────────────────────────

test.describe('User Input Dialog UI', () => {
  test('UserInputDialog is not visible when no pending user input', async ({ page }) => {
    await dismissWizards(page);
    await page.goto('/agents');
    await page.waitForTimeout(500);
    await expect(page.getByText('Agent Question')).not.toBeVisible();
  });
});

// ── Config YAML Oversight API ───────────────────────────────

test.describe('Config YAML Oversight API', () => {
  test('GET /config/yaml returns oversight section', async ({ page }) => {
    const res = await page.request.get('/api/config/yaml');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('oversight');
  });

  test('PATCH /config with oversightLevel propagates to YAML config', async ({ page }) => {
    test.fixme(true, 'ConfigStore file watcher latency in test environment');
    const patchRes = await page.request.patch('/api/config', {
      data: { oversightLevel: 'supervised' },
    });
    expect(patchRes.ok()).toBeTruthy();

    await expect(async () => {
      const yamlRes = await page.request.get('/api/config/yaml');
      const yamlData = await yamlRes.json();
      expect(yamlData.oversight?.level).toBe('supervised');
    }).toPass({ timeout: 10000 });

    await page.request.patch('/api/config', { data: { oversightLevel: 'autonomous' } });
  });
});

// ── Agent Spawn ─────────────────────────────────────────────

test.describe('Agent Spawn', () => {
  test.beforeEach(async ({ page }) => { await dismissWizards(page); });
  test.afterEach(async ({ page }) => { await cleanup(page); });

  test('spawned agent is created successfully', async ({ page }) => {
    const res = await page.request.post('/api/agents', {
      data: { roleId: 'developer', task: 'test spawn' },
    });
    expect(res.ok()).toBeTruthy();
    const agent = await res.json();
    expect(agent.id).toBeDefined();
    expect(agent.status).toBeDefined();
  });
});

// ── Settings Navigation ─────────────────────────────────────

test.describe('Settings Navigation', () => {
  test('can navigate to settings and see oversight section', async ({ page }) => {
    await dismissWizards(page);
    await page.goto('/');
    await page.locator('nav a[href="/settings"]').click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('[data-testid="oversight-section"]')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('heading', { name: 'Oversight Level' })).toBeVisible();
  });
});
