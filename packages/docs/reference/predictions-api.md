# Predictions & Workflows API (Updated)

::: warning Predictions Removed
The Predictions API endpoints have been removed. See the [removal notice](/guide/predictions) for details.
:::

## Workflow Automation API

The Workflow Automation feature remains fully functional. Workflows use an event-trigger model:

- **12 event triggers**: agent_spawned, task_completed, agent_crashed, context_critical, etc.
- **12 action types**: pause_agent, send_notification, create_task, etc.

### `GET /api/workflows`
Returns all configured workflow rules.

### `POST /api/workflows`
Create a new workflow rule.

### `PUT /api/workflows/:id`
Update an existing workflow rule.

### `DELETE /api/workflows/:id`
Delete a workflow rule.

### `POST /api/workflows/:id/test`
Dry-run a workflow rule against sample data.

See the [Workflow Automation Guide](/guide/workflows) for usage details.
