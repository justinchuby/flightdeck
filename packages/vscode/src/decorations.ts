import * as vscode from 'vscode';
import type { FileLockInfo } from './types';
import type { FlightdeckConnection } from './connection';

/**
 * Shows lock badges (🔒) on files in the explorer that are currently locked.
 */
export class FileLockDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private locks = new Map<string, FileLockInfo>();

  constructor(private readonly connection: FlightdeckConnection) {}

  async refresh(): Promise<void> {
    const data = await this.connection.fetchJson<FileLockInfo[]>('/coordination/locks');
    this.locks.clear();
    if (data) {
      for (const lock of data) {
        this.locks.set(this.normalizePath(lock.path), lock);
      }
    }
    this._onDidChangeFileDecorations.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const lock = this.locks.get(this.normalizePath(uri.fsPath));
    if (!lock) return undefined;

    const ttlRemaining = Math.max(0, Math.round(lock.ttl / 1000));
    return {
      badge: '🔒',
      tooltip: `Locked by ${lock.holder.slice(0, 8)} (${ttlRemaining}s remaining)`,
      color: new vscode.ThemeColor('charts.orange'),
    };
  }

  /** Handle lock events from WebSocket. */
  onLockAcquired(lock: FileLockInfo): void {
    this.locks.set(this.normalizePath(lock.path), lock);
    this._onDidChangeFileDecorations.fire(vscode.Uri.file(lock.path));
  }

  onLockReleased(filePath: string): void {
    this.locks.delete(this.normalizePath(filePath));
    this._onDidChangeFileDecorations.fire(vscode.Uri.file(filePath));
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
  }

  dispose(): void {
    this._onDidChangeFileDecorations.dispose();
  }
}

/**
 * Adds background highlights to open editors for locked files.
 */
export class LockedFileHighlighter {
  private readonly decorationType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    overviewRulerColor: 'rgba(255, 165, 0, 0.4)',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    gutterIconPath: undefined,
    backgroundColor: 'rgba(255, 165, 0, 0.05)',
    borderColor: 'rgba(255, 165, 0, 0.2)',
    borderWidth: '0 0 0 3px',
    borderStyle: 'solid',
  });

  private locks = new Map<string, FileLockInfo>();

  updateLocks(locks: FileLockInfo[]): void {
    this.locks.clear();
    for (const lock of locks) {
      this.locks.set(lock.path.replace(/\\/g, '/'), lock);
    }
    this.refreshAllEditors();
  }

  refreshAllEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.decorateEditor(editor);
    }
  }

  decorateEditor(editor: vscode.TextEditor): void {
    const normalized = editor.document.uri.fsPath.replace(/\\/g, '/');
    const lock = this.locks.get(normalized);

    if (lock) {
      // Highlight first line with lock info
      const range = new vscode.Range(0, 0, 0, 0);
      editor.setDecorations(this.decorationType, [{
        range,
        hoverMessage: new vscode.MarkdownString(
          `🔒 **Locked** by \`${lock.holder.slice(0, 8)}\` — ${Math.round(lock.ttl / 1000)}s remaining`,
        ),
      }]);
    } else {
      editor.setDecorations(this.decorationType, []);
    }
  }

  dispose(): void {
    this.decorationType.dispose();
  }
}
