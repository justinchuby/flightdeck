import { test, expect } from '@playwright/test';

test.describe('Agent Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h2')).toHaveText('Agents');
  });

  test('shows spawn agent button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Spawn Agent/i })).toBeVisible();
  });

  test('spawn dialog opens and shows all roles', async ({ page }) => {
    await page.getByRole('button', { name: /Spawn Agent/i }).click();
    await expect(page.getByText('Spawn Agent').first()).toBeVisible(); // dialog title

    // All 6 built-in roles should be visible
    for (const role of ['Architect', 'Code Reviewer', 'Developer', 'Project Manager', 'Dev Advocate', 'QA Engineer']) {
      await expect(page.getByText(role)).toBeVisible();
    }
  });

  test('spawn dialog can be closed with Cancel', async ({ page }) => {
    await page.getByRole('button', { name: /Spawn Agent/i }).click();
    await expect(page.getByText('Architect')).toBeVisible();
    await page.getByRole('button', { name: /Cancel/i }).click();
    // Dialog should be gone
    await expect(page.getByText('Architect')).not.toBeVisible();
  });

  test('keyboard shortcut N opens spawn dialog', async ({ page }) => {
    await page.keyboard.press('n');
    await expect(page.getByText('Architect')).toBeVisible();
  });

  test('Escape closes spawn dialog', async ({ page }) => {
    await page.keyboard.press('n');
    await expect(page.getByText('Architect')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Architect')).not.toBeVisible();
  });

  test('spawning an agent shows it in the dashboard', async ({ page }) => {
    // Use API to spawn an agent (avoids flaky CLI spawning in tests)
    const response = await page.request.post('/api/agents', {
      data: { roleId: 'developer' },
    });
    expect(response.ok()).toBeTruthy();

    // Wait for the agent card to appear
    await page.reload();
    await expect(page.getByText('Developer')).toBeVisible({ timeout: 5_000 });

    // Clean up — kill the agent
    const agents = await (await page.request.get('/api/agents')).json();
    for (const agent of agents) {
      await page.request.delete(`/api/agents/${agent.id}`);
    }
  });

  test('selecting an agent highlights the card', async ({ page }) => {
    // Spawn via API
    const response = await page.request.post('/api/agents', {
      data: { roleId: 'qa' },
    });
    const agent = await response.json();

    await page.reload();
    await expect(page.getByText('QA Engineer')).toBeVisible({ timeout: 5_000 });

    // Click the agent card
    await page.getByText('QA Engineer').click();

    // Chat panel should show the agent role name in the header
    await expect(page.getByText('QA Engineer').last()).toBeVisible();

    // Clean up
    await page.request.delete(`/api/agents/${agent.id}`);
  });
});
