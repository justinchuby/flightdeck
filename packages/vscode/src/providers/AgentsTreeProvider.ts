import * as vscode from 'vscode';
import type { AgentInfo } from '../types';
import type { FlightdeckConnection } from '../connection';

export class AgentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly agent: AgentInfo,
    public readonly hasChildren: boolean,
  ) {
    super(
      agent.name || `${agent.role} (${agent.id.slice(0, 8)})`,
      hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );

    this.description = agent.status;
    this.tooltip = this.buildTooltip();
    this.iconPath = this.getStatusIcon();
    this.contextValue = `agent-${agent.status}`;
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${this.agent.role}** \`${this.agent.id.slice(0, 8)}\`\n\n`);
    md.appendMarkdown(`- **Status:** ${this.agent.status}\n`);
    md.appendMarkdown(`- **Model:** ${this.agent.model}\n`);
    if (this.agent.task) {
      md.appendMarkdown(`- **Task:** ${this.agent.task.slice(0, 100)}\n`);
    }
    md.appendMarkdown(`- **Tokens:** ${this.agent.tokens.input.toLocaleString()} in / ${this.agent.tokens.output.toLocaleString()} out\n`);
    if (this.agent.contextUsage > 0) {
      md.appendMarkdown(`- **Context:** ${Math.round(this.agent.contextUsage * 100)}%\n`);
    }
    return md;
  }

  private getStatusIcon(): vscode.ThemeIcon {
    switch (this.agent.status) {
      case 'running': return new vscode.ThemeIcon('pulse', new vscode.ThemeColor('charts.green'));
      case 'idle': return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue'));
      case 'creating': return new vscode.ThemeIcon('loading~spin');
      case 'completed': return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
      case 'failed': return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
      case 'terminated': return new vscode.ThemeIcon('close', new vscode.ThemeColor('charts.orange'));
      default: return new vscode.ThemeIcon('circle-outline');
    }
  }
}

export class AgentsTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private agents: AgentInfo[] = [];

  constructor(private readonly connection: FlightdeckConnection) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  async getChildren(element?: AgentTreeItem): Promise<AgentTreeItem[]> {
    if (!this.connection.connected) return [];

    if (!element) {
      // Root: fetch all agents, return leads (no parentId)
      const data = await this.connection.fetchJson<AgentInfo[]>('/agents');
      this.agents = data ?? [];
      const leads = this.agents.filter((a) => !a.parentId);
      return leads.map((a) => {
        const hasChildren = this.agents.some((child) => child.parentId === a.id);
        return new AgentTreeItem(a, hasChildren);
      });
    }

    // Children of a given agent
    const children = this.agents.filter((a) => a.parentId === element.agent.id);
    return children.map((a) => {
      const hasGrandchildren = this.agents.some((gc) => gc.parentId === a.id);
      return new AgentTreeItem(a, hasGrandchildren);
    });
  }

  getTreeItem(element: AgentTreeItem): vscode.TreeItem {
    return element;
  }
}
