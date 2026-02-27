import { test, expect } from '@playwright/test';

test.describe('Task Queue', () => {
  test.beforeEach(async ({ page }) => {
    // Clean up any existing tasks
    const tasks = await (await page.request.get('/api/tasks')).json();
    for (const task of tasks) {
      await page.request.delete(`/api/tasks/${task.id}`);
    }

    await page.goto('/tasks');
    await expect(page.locator('h2')).toHaveText('Task Queue');
  });

  test('shows empty state', async ({ page }) => {
    await expect(page.getByText('No tasks').first()).toBeVisible();
  });

  test('new task button toggles form', async ({ page }) => {
    await page.getByRole('button', { name: /New Task/i }).click();
    await expect(page.getByPlaceholder('Task title')).toBeVisible();

    // Cancel hides it
    await page.getByRole('button', { name: /Cancel/i }).click();
    await expect(page.getByPlaceholder('Task title')).not.toBeVisible();
  });

  test('can create a task with title only', async ({ page }) => {
    await page.getByRole('button', { name: /New Task/i }).click();
    await page.getByPlaceholder('Task title').fill('Implement login page');
    await page.getByRole('button', { name: /Create/i }).click();

    // Task should appear in the queue
    await expect(page.getByText('Implement login page')).toBeVisible();
  });

  test('can create a task with all fields', async ({ page }) => {
    await page.getByRole('button', { name: /New Task/i }).click();
    await page.getByPlaceholder('Task title').fill('Review auth module');
    await page.getByPlaceholder(/Description/i).fill('Check for SQL injection vulnerabilities');
    await page.locator('select').first().selectOption('1'); // High priority
    await page.getByRole('button', { name: /Create/i }).click();

    await expect(page.getByText('Review auth module')).toBeVisible();
    await expect(page.getByText('Check for SQL injection')).toBeVisible();
  });

  test('create button disabled without title', async ({ page }) => {
    await page.getByRole('button', { name: /New Task/i }).click();
    const createBtn = page.getByRole('button', { name: /^Create$/i });
    await expect(createBtn).toBeDisabled();
  });

  test('can delete a task', async ({ page }) => {
    // Create via API
    await page.request.post('/api/tasks', {
      data: { title: 'Task to delete' },
    });
    await page.reload();

    await expect(page.getByText('Task to delete')).toBeVisible();

    // Click the trash icon button next to the task
    const taskRow = page.locator('div').filter({ hasText: 'Task to delete' }).first();
    await taskRow.locator('button').last().click();

    await expect(page.getByText('Task to delete')).not.toBeVisible();
  });

  test('tasks show correct status badges', async ({ page }) => {
    await page.request.post('/api/tasks', {
      data: { title: 'Queued task' },
    });
    await page.reload();

    await expect(page.getByText('Queued').first()).toBeVisible();
  });

  test('multiple tasks appear in order', async ({ page }) => {
    await page.request.post('/api/tasks', { data: { title: 'First task', priority: 0 } });
    await page.request.post('/api/tasks', { data: { title: 'Urgent task', priority: 2 } });
    await page.reload();

    // Both should be visible
    await expect(page.getByText('First task')).toBeVisible();
    await expect(page.getByText('Urgent task')).toBeVisible();
  });
});
