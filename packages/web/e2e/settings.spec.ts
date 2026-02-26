import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('h2')).toHaveText('Settings');
  });

  test('shows concurrency section with slider', async ({ page }) => {
    await expect(page.getByText('Max concurrent agents')).toBeVisible();
    await expect(page.locator('input[type="range"]')).toBeVisible();
    // Slider should have correct min/max
    await expect(page.locator('input[type="range"]')).toHaveAttribute('min', '1');
    await expect(page.locator('input[type="range"]')).toHaveAttribute('max', '20');
  });

  test('shows CLI configuration', async ({ page }) => {
    await expect(page.getByText('CLI Configuration')).toBeVisible();
    await expect(page.locator('code')).toBeVisible();
  });

  test('lists all 6 built-in roles', async ({ page }) => {
    for (const role of [
      'Architect',
      'Code Reviewer',
      'Developer',
      'Project Manager',
      'Dev Advocate',
      'QA Engineer',
    ]) {
      await expect(page.getByText(role)).toBeVisible();
    }
  });

  test('built-in roles show built-in label and no delete button', async ({ page }) => {
    const builtInLabels = page.getByText('built-in', { exact: true });
    await expect(builtInLabels.first()).toBeVisible();
    await expect(builtInLabels).toHaveCount(6);
  });

  test('custom role button toggles form', async ({ page }) => {
    await page.getByText('Custom Role').click();
    await expect(page.getByPlaceholder('Role ID (e.g. designer)')).toBeVisible();
    await expect(page.getByPlaceholder('Role name')).toBeVisible();

    await page.getByRole('button', { name: /Cancel/i }).click();
    await expect(page.getByPlaceholder('Role ID (e.g. designer)')).not.toBeVisible();
  });

  test('create button disabled without required fields', async ({ page }) => {
    await page.getByText('Custom Role').click();
    const createBtn = page.getByRole('button', { name: /^Create$/i });
    await expect(createBtn).toBeDisabled();

    // Fill only role ID — still disabled
    await page.getByPlaceholder('Role ID (e.g. designer)').fill('foo');
    await expect(createBtn).toBeDisabled();

    // Fill name too — enabled
    await page.getByPlaceholder('Role name').fill('Foo Role');
    await expect(createBtn).toBeEnabled();
  });

  test('can create a custom role', async ({ page }) => {
    await page.getByText('Custom Role').click();
    await page.getByPlaceholder('Role ID (e.g. designer)').fill('designer');
    await page.getByPlaceholder('Role name').fill('UI Designer');
    await page.getByPlaceholder('Description').fill('Designs user interfaces');
    await page.getByPlaceholder('System prompt').fill('You are a UI designer.');
    await page.getByRole('button', { name: /^Create$/i }).click();

    // New role should appear and form should close
    await expect(page.getByText('UI Designer')).toBeVisible();
    await expect(page.getByPlaceholder('Role ID (e.g. designer)')).not.toBeVisible();

    // Clean up
    await page.request.delete('/api/roles/designer');
  });

  test('can delete a custom role', async ({ page }) => {
    // Create via API
    await page.request.post('/api/roles', {
      data: {
        id: 'tester',
        name: 'Tester Role',
        description: 'Test only',
        systemPrompt: 'test',
        color: '#ff0000',
        icon: '🧪',
      },
    });
    await page.goto('/settings');

    await expect(page.getByText('Tester Role')).toBeVisible();

    // The custom role row has a delete button (Trash2 icon) instead of "built-in" label
    const roleRow = page.locator('div').filter({ hasText: /^🧪Tester RoleTest only$/ });
    await roleRow.locator('button').click();

    await expect(page.getByText('Tester Role')).not.toBeVisible();
  });
});
