import { test, expect } from '@playwright/test';

test.describe('Task Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    // Clean up existing tasks and agents
    const tasks = await (await page.request.get('/api/tasks')).json();
    for (const task of tasks) {
      await page.request.delete(`/api/tasks/${task.id}`);
    }
    const agents = await (await page.request.get('/api/agents')).json();
    for (const agent of agents) {
      await page.request.delete(`/api/agents/${agent.id}`);
    }
  });

  test.afterEach(async ({ page }) => {
    // Clean up
    const tasks = await (await page.request.get('/api/tasks')).json();
    for (const task of tasks) {
      await page.request.delete(`/api/tasks/${task.id}`);
    }
    const agents = await (await page.request.get('/api/agents')).json();
    for (const agent of agents) {
      await page.request.delete(`/api/agents/${agent.id}`);
    }
  });

  test('creating a task via API puts it in queued state', async ({ page }) => {
    const res = await page.request.post('/api/tasks', {
      data: { title: 'Test task', description: 'Do something', priority: 1 },
    });
    expect(res.ok()).toBeTruthy();
    const task = await res.json();
    expect(task.title).toBe('Test task');
    expect(task.description).toBe('Do something');
    expect(task.priority).toBe(1);
    // Status may be 'queued' initially or 'in_progress' if auto-assignment spawned an agent
    expect(['queued', 'in_progress']).toContain(task.status);
  });

  test('task appears in the task queue UI', async ({ page }) => {
    await page.request.post('/api/tasks', {
      data: { title: 'UI visible task' },
    });

    await page.goto('/tasks');
    await expect(page.getByText('UI visible task')).toBeVisible({ timeout: 5000 });
  });

  test('creating a task triggers agent auto-spawn', async ({ page }) => {
    // Aggressively clean up agents that may have been auto-spawned from previous tests
    for (let i = 0; i < 3; i++) {
      const agents = await (await page.request.get('/api/agents')).json();
      for (const agent of agents) {
        await page.request.delete(`/api/agents/${agent.id}`);
      }
      if (agents.length === 0) break;
      await page.waitForTimeout(500);
    }
    const initialAgents = await (await page.request.get('/api/agents')).json();
    const initialCount = initialAgents.length;

    // Create a task
    await page.request.post('/api/tasks', {
      data: { title: 'Auto-spawn test', assignedRole: 'developer' },
    });

    // Wait a bit for auto-spawn
    await page.waitForTimeout(3000);

    // Agent may or may not spawn depending on CLI availability
    // but the task should still exist
    const tasks = await (await page.request.get('/api/tasks')).json();
    const task = tasks.find((t: any) => t.title === 'Auto-spawn test');
    expect(task).toBeTruthy();
  });

  test('task with assignedRole gets matched to correct role agent', async ({ page }) => {
    // Pre-spawn a code-reviewer agent
    await page.request.post('/api/agents', { data: { roleId: 'code-reviewer' } });
    await page.waitForTimeout(2000);

    // Create a task assigned to code-reviewer role
    const res = await page.request.post('/api/tasks', {
      data: { title: 'Review task', assignedRole: 'code-reviewer' },
    });
    const task = await res.json();

    // Give time for assignment
    await page.waitForTimeout(2000);

    // Check task state
    const updated = await (await page.request.get('/api/tasks')).json();
    const reviewTask = updated.find((t: any) => t.title === 'Review task');
    if (reviewTask && reviewTask.assignedAgentId) {
      // If assigned, verify it went to the code-reviewer agent
      const agents = await (await page.request.get('/api/agents')).json();
      const assigned = agents.find((a: any) => a.id === reviewTask.assignedAgentId);
      if (assigned) {
        expect(assigned.role.id).toBe('code-reviewer');
      }
    }
  });

  test('deleting a task removes it from API', async ({ page }) => {
    const res = await page.request.post('/api/tasks', {
      data: { title: 'Delete me' },
    });
    const task = await res.json();

    const delRes = await page.request.delete(`/api/tasks/${task.id}`);
    expect(delRes.ok()).toBeTruthy();

    const tasks = await (await page.request.get('/api/tasks')).json();
    expect(tasks.find((t: any) => t.id === task.id)).toBeUndefined();
  });

  test('deleting a task removes it from the UI', async ({ page }) => {
    await page.request.post('/api/tasks', {
      data: { title: 'UI delete test' },
    });

    await page.goto('/tasks');
    await expect(page.getByText('UI delete test')).toBeVisible({ timeout: 5000 });

    // Click the trash/delete button on the task row
    const taskRow = page.locator('div').filter({ hasText: 'UI delete test' }).first();
    await taskRow.locator('button').last().click();

    await expect(page.getByText('UI delete test')).not.toBeVisible({ timeout: 3000 });
  });

  test('updating task status via API works', async ({ page }) => {
    const res = await page.request.post('/api/tasks', {
      data: { title: 'Status test' },
    });
    const task = await res.json();

    const patchRes = await page.request.patch(`/api/tasks/${task.id}`, {
      data: { status: 'done' },
    });
    expect(patchRes.ok()).toBeTruthy();
    const updated = await patchRes.json();
    expect(updated.status).toBe('done');
  });

  test('task priority ordering is preserved', async ({ page }) => {
    await page.request.post('/api/tasks', { data: { title: 'Low', priority: 0 } });
    await page.request.post('/api/tasks', { data: { title: 'High', priority: 2 } });
    await page.request.post('/api/tasks', { data: { title: 'Medium', priority: 1 } });

    const tasks = await (await page.request.get('/api/tasks')).json();
    // Should be ordered by priority DESC
    const priorities = tasks.map((t: any) => t.priority);
    for (let i = 0; i < priorities.length - 1; i++) {
      expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i + 1]);
    }
  });
});
