import * as vscode from 'vscode';
import type { TaskInfo } from '../types';
import type { FlightdeckConnection } from '../connection';

export class TaskTreeItem extends vscode.TreeItem {
  constructor(
    public readonly task: TaskInfo,
    public readonly hasChildren: boolean,
  ) {
    super(
      task.title || task.id.slice(0, 12),
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );

    this.description = task.assignedTo ? `→ ${task.assignedTo.slice(0, 8)}` : undefined;
    this.tooltip = this.buildTooltip();
    this.iconPath = this.getStatusIcon();
    this.contextValue = `task-${task.status}`;
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${this.task.title}** \`${this.task.id.slice(0, 12)}\`\n\n`);
    md.appendMarkdown(`- **Status:** ${this.task.status}\n`);
    if (this.task.assignedTo) {
      md.appendMarkdown(`- **Assigned to:** \`${this.task.assignedTo.slice(0, 8)}\`\n`);
    }
    if (this.task.dependencies.length > 0) {
      md.appendMarkdown(`- **Dependencies:** ${this.task.dependencies.length}\n`);
    }
    return md;
  }

  private getStatusIcon(): vscode.ThemeIcon {
    switch (this.task.status) {
      case 'pending': return new vscode.ThemeIcon('circle-outline');
      case 'in_progress': return new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.blue'));
      case 'done': return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
      case 'failed': return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
      case 'blocked': return new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('charts.orange'));
      default: return new vscode.ThemeIcon('circle-outline');
    }
  }
}

export class TasksTreeProvider implements vscode.TreeDataProvider<TaskTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TaskTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private tasks: TaskInfo[] = [];

  constructor(private readonly connection: FlightdeckConnection) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  async getChildren(element?: TaskTreeItem): Promise<TaskTreeItem[]> {
    if (!this.connection.connected) return [];

    if (!element) {
      // Root: fetch all tasks, return top-level (not a dependency of another visible task)
      const data = await this.connection.fetchJson<TaskInfo[]>('/tasks');
      this.tasks = data ?? [];

      // Show all tasks at root level — dependencies shown as children
      const allDepIds = new Set(this.tasks.flatMap((t) => t.dependencies));
      const roots = this.tasks.filter((t) => !allDepIds.has(t.id));
      // If all tasks are dependencies of each other (cycle), just show all
      const items = roots.length > 0 ? roots : this.tasks;
      return items.map((t) => {
        const hasChildren = t.dependencies.length > 0;
        return new TaskTreeItem(t, hasChildren);
      });
    }

    // Children: show dependency tasks
    const deps = element.task.dependencies
      .map((depId) => this.tasks.find((t) => t.id === depId))
      .filter((t): t is TaskInfo => t !== undefined);
    return deps.map((t) => new TaskTreeItem(t, t.dependencies.length > 0));
  }

  getTreeItem(element: TaskTreeItem): vscode.TreeItem {
    return element;
  }
}
