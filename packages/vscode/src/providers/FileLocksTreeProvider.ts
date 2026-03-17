import * as vscode from 'vscode';
import type { FileLockInfo } from '../types';
import type { FlightdeckConnection } from '../connection';

export class LockTreeItem extends vscode.TreeItem {
  constructor(public readonly lock: FileLockInfo) {
    super(lock.path, vscode.TreeItemCollapsibleState.None);

    this.description = `held by ${lock.holder.slice(0, 8)}`;
    this.tooltip = this.buildTooltip();
    this.iconPath = new vscode.ThemeIcon('lock', new vscode.ThemeColor('charts.orange'));
    this.contextValue = 'file-lock';

    // Click to open the locked file
    this.command = {
      command: 'vscode.open',
      title: 'Open Locked File',
      arguments: [vscode.Uri.file(lock.path)],
    };
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${this.lock.path}**\n\n`);
    md.appendMarkdown(`- **Holder:** \`${this.lock.holder}\`\n`);
    md.appendMarkdown(`- **Acquired:** ${this.lock.acquiredAt}\n`);
    md.appendMarkdown(`- **TTL:** ${Math.round(this.lock.ttl / 1000)}s\n`);
    return md;
  }
}

export class FileLocksTreeProvider implements vscode.TreeDataProvider<LockTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<LockTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly connection: FlightdeckConnection) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  async getChildren(): Promise<LockTreeItem[]> {
    if (!this.connection.connected) return [];

    const data = await this.connection.fetchJson<FileLockInfo[]>('/coordination/locks');
    if (!data) return [];
    return data.map((lock) => new LockTreeItem(lock));
  }

  getTreeItem(element: LockTreeItem): vscode.TreeItem {
    return element;
  }
}
