import * as vscode from 'vscode';
import { FlightdeckConnection } from './connection';
import { AgentsTreeProvider } from './providers/AgentsTreeProvider';
import { TasksTreeProvider } from './providers/TasksTreeProvider';
import { FileLocksTreeProvider } from './providers/FileLocksTreeProvider';
import { FileLockDecorationProvider, LockedFileHighlighter } from './decorations';
import { AgentTerminalManager } from './terminals';
import { StatusBarManager } from './statusbar';
import { NotificationManager } from './notifications';
import { registerCommands } from './commands';

let outputChannel: vscode.OutputChannel;
let connection: FlightdeckConnection;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('Flightdeck');
  outputChannel.appendLine('Flightdeck extension activated');

  // Create connection manager
  connection = new FlightdeckConnection(context, outputChannel);
  context.subscriptions.push({ dispose: () => connection.dispose() });

  // Create tree view providers
  const agentsProvider = new AgentsTreeProvider(connection);
  const tasksProvider = new TasksTreeProvider(connection);
  const locksProvider = new FileLocksTreeProvider(connection);

  // Register tree views
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('flightdeck-agents', agentsProvider),
    vscode.window.registerTreeDataProvider('flightdeck-tasks', tasksProvider),
    vscode.window.registerTreeDataProvider('flightdeck-locks', locksProvider),
    agentsProvider,
    tasksProvider,
    locksProvider,
  );

  // File lock decorations
  const lockDecorationProvider = new FileLockDecorationProvider(connection);
  const lockedFileHighlighter = new LockedFileHighlighter();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(lockDecorationProvider),
    lockDecorationProvider,
    lockedFileHighlighter,
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) lockedFileHighlighter.decorateEditor(editor);
    }),
  );

  // Agent terminals
  const terminalManager = new AgentTerminalManager(connection);
  context.subscriptions.push(terminalManager);

  // Status bar
  const statusBar = new StatusBarManager();
  context.subscriptions.push(statusBar);

  // Notifications
  const notifications = new NotificationManager(outputChannel);

  // Subscribe to WebSocket messages for terminals and notifications
  connection.onMessage((msg) => {
    notifications.handleMessage(msg);
    if (msg.type === 'agent:text' && msg.agentId) {
      terminalManager.onAgentMessage(msg.agentId, msg.text ?? '');
    }
  });

  // Refresh all views when connection state changes
  connection.onDidChangeConnection(async (connected) => {
    outputChannel.appendLine(`Connection state: ${connected ? 'connected' : 'disconnected'}`);
    statusBar.updateConnection(connected);
    agentsProvider.refresh();
    tasksProvider.refresh();
    locksProvider.refresh();
    await lockDecorationProvider.refresh();
  });

  // Register commands
  const commands = registerCommands({
    connection,
    agentsProvider,
    tasksProvider,
    extensionUri: context.extensionUri,
    outputChannel,
  });
  context.subscriptions.push(...commands);

  // Auto-connect if configured
  const config = vscode.workspace.getConfiguration('flightdeck');
  if (config.get<boolean>('autoConnect', true)) {
    vscode.commands.executeCommand('flightdeck.connect');
  }

  outputChannel.appendLine('Flightdeck extension ready');
}

export function deactivate(): void {
  outputChannel?.appendLine('Flightdeck extension deactivated');
  connection?.dispose();
}
