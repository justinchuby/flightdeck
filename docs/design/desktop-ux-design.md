# Desktop UX Design — Flightdeck Desktop

## Overview

Flightdeck Desktop provides native macOS/Windows/Linux integration that the
web-based CLI version cannot: system menu bar, dock integration, native
notifications, system tray, deep linking, window state persistence, and
keyboard shortcuts.

---

## Native Menu Bar

### macOS Menu Structure

macOS apps are expected to have a full menu bar. The menu integrates with
Electron's `Menu.buildFromTemplate()`:

```typescript
// packages/desktop/src/menu.ts
import { app, Menu, shell, BrowserWindow, dialog } from 'electron';

export function buildMenu(mainWindow: BrowserWindow): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // ── App Menu (macOS only) ─────────────────────────────
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        {
          label: 'Preferences…',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow.webContents.send('navigate', '/settings'),
        },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),

    // ── File Menu ──────────────────────────────────────────
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Project…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory'],
              title: 'Open Project Repository',
            });
            if (!result.canceled && result.filePaths[0]) {
              mainWindow.webContents.send('open-project', result.filePaths[0]);
            }
          },
        },
        { type: 'separator' as const },
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('navigate', '/'),
        },
        { type: 'separator' as const },
        ...(isMac ? [] : [
          { type: 'separator' as const },
          {
            label: 'Settings',
            accelerator: 'CmdOrCtrl+,',
            click: () => mainWindow.webContents.send('navigate', '/settings'),
          },
          { type: 'separator' as const },
          { role: 'quit' as const },
        ]),
      ],
    },

    // ── Edit Menu ──────────────────────────────────────────
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
        { type: 'separator' as const },
        {
          label: 'Find…',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow.webContents.send('focus-search'),
        },
      ],
    },

    // ── View Menu ──────────────────────────────────────────
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
        { type: 'separator' as const },
        {
          label: 'Overview',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow.webContents.send('navigate', 'overview'),
        },
        {
          label: 'Crew',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow.webContents.send('navigate', 'crew'),
        },
        {
          label: 'Tasks',
          accelerator: 'CmdOrCtrl+3',
          click: () => mainWindow.webContents.send('navigate', 'tasks'),
        },
        {
          label: 'Analysis',
          accelerator: 'CmdOrCtrl+4',
          click: () => mainWindow.webContents.send('navigate', 'analysis'),
        },
      ],
    },

    // ── Session Menu ───────────────────────────────────────
    {
      label: 'Session',
      submenu: [
        {
          label: 'Spawn Agent',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => mainWindow.webContents.send('action', 'spawn-agent'),
        },
        {
          label: 'Stop All Agents',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow.webContents.send('action', 'stop-all-agents'),
        },
        { type: 'separator' as const },
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+K',
          click: () => mainWindow.webContents.send('action', 'command-palette'),
        },
      ],
    },

    // ── Window Menu ────────────────────────────────────────
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
        ] : [
          { role: 'close' as const },
        ]),
      ],
    },

    // ── Help Menu ──────────────────────────────────────────
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://github.com/flightdeck-ai/flightdeck/docs'),
        },
        {
          label: 'Report Issue',
          click: () => shell.openExternal('https://github.com/flightdeck-ai/flightdeck/issues/new'),
        },
        { type: 'separator' as const },
        {
          label: 'View Logs',
          click: () => shell.openPath(app.getPath('logs')),
        },
        {
          label: 'Open Data Directory',
          click: () => shell.openPath(app.getPath('userData')),
        },
        ...(isMac ? [] : [
          { type: 'separator' as const },
          { role: 'about' as const },
        ]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
```

### Windows/Linux Adaptations

- App menu is omitted (macOS only)
- Settings moves to File → Settings
- Quit moves to File → Quit
- About moves to Help → About

---

## Dock Icon (macOS)

### Badge Count

Show the number of running agents as a dock badge:

```typescript
// packages/desktop/src/dock.ts
import { app } from 'electron';

export function updateDockBadge(activeAgentCount: number): void {
  if (process.platform !== 'darwin') return;

  if (activeAgentCount > 0) {
    app.dock.setBadge(String(activeAgentCount));
  } else {
    app.dock.setBadge('');
  }
}

export function setDockProgress(fraction: number): void {
  // Shows a progress bar in the dock icon (0-1, or -1 to clear)
  if (process.platform === 'darwin') {
    // macOS doesn't have dock progress, but we can bounce
  }
  // Windows taskbar progress
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.setProgressBar(fraction);  // Works on Windows and Linux (Unity)
  }
}
```

### Dock Menu (macOS)

Right-click the dock icon for quick actions:

```typescript
import { app, Menu } from 'electron';

export function setupDockMenu(): void {
  if (process.platform !== 'darwin') return;

  const dockMenu = Menu.buildFromTemplate([
    {
      label: 'New Session',
      click: () => { /* navigate to new session */ },
    },
    {
      label: 'Open Project…',
      click: () => { /* show directory picker */ },
    },
    { type: 'separator' },
    {
      label: 'Stop All Agents',
      click: () => { /* send stop-all command */ },
    },
  ]);

  app.dock.setMenu(dockMenu);
}
```

---

## System Tray / Menu Bar

Optional: Run Flightdeck as a menu bar app (minimized to tray).

```typescript
// packages/desktop/src/tray.ts
import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron';
import path from 'node:path';

let tray: Tray | null = null;

export function setupTray(mainWindow: BrowserWindow, serverPort: number): void {
  // Create tray icon (16x16 for macOS menu bar, 32x32 for Windows)
  const iconPath = process.platform === 'darwin'
    ? path.join(__dirname, '../build/tray-icon-Template.png')  // macOS template icon
    : path.join(__dirname, '../build/tray-icon.png');

  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);

  tray.setToolTip('Flightdeck');

  const updateMenu = (agentCount: number) => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `Flightdeck — ${agentCount} agent${agentCount !== 1 ? 's' : ''} running`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Show Window',
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        },
      },
      {
        label: 'Open in Browser',
        click: () => {
          require('electron').shell.openExternal(`http://localhost:${serverPort}`);
        },
      },
      { type: 'separator' },
      {
        label: 'Stop All Agents',
        click: () => {
          mainWindow.webContents.send('action', 'stop-all-agents');
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Flightdeck',
        click: () => app.quit(),
      },
    ]);

    tray?.setContextMenu(contextMenu);
  };

  // Initial menu
  updateMenu(0);

  // Double-click tray icon to show window (Windows/Linux)
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Expose update function for the server to call
  (globalThis as any).__updateTrayMenu = updateMenu;
}
```

### macOS Template Icons

macOS menu bar icons should be "template" images — monochrome with alpha:

```
build/
├── tray-icon-Template.png      # 16x16, monochrome (macOS auto-inverts for dark mode)
├── tray-icon-Template@2x.png   # 32x32, Retina
└── tray-icon.png               # 32x32, color (Windows/Linux)
```

---

## Native Notifications

Replace browser-based toast notifications with native OS notifications for
important events:

```typescript
// packages/desktop/src/notifications.ts
import { Notification, app } from 'electron';

interface FlightdeckNotification {
  title: string;
  body: string;
  urgency?: 'low' | 'normal' | 'critical';
  onClick?: () => void;
}

export function showNotification(opts: FlightdeckNotification): void {
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title: opts.title,
    body: opts.body,
    icon: process.platform === 'linux'
      ? undefined  // Linux uses the app icon
      : undefined, // macOS/Windows use the app icon automatically
    urgency: opts.urgency ?? 'normal',
    silent: opts.urgency === 'low',
  });

  if (opts.onClick) {
    notification.on('click', opts.onClick);
  }

  notification.show();
}

// Notification types for Flightdeck events
export const notifications = {
  agentError: (agentId: string, error: string) => showNotification({
    title: `Agent ${agentId.slice(0, 8)} Error`,
    body: error.slice(0, 200),
    urgency: 'critical',
  }),

  taskCompleted: (taskTitle: string, agentRole: string) => showNotification({
    title: 'Task Completed',
    body: `${agentRole} finished: ${taskTitle}`,
    urgency: 'normal',
  }),

  allAgentsIdle: () => showNotification({
    title: 'Session Idle',
    body: 'All agents have completed their work.',
    urgency: 'low',
  }),

  updateAvailable: (version: string) => showNotification({
    title: 'Update Available',
    body: `Flightdeck ${version} is ready to install.`,
    urgency: 'low',
  }),

  attentionRequired: (message: string) => showNotification({
    title: 'Attention Required',
    body: message,
    urgency: 'critical',
  }),
};
```

### Notification Preferences

Users can control notification behavior in Settings:

| Setting | Default | Options |
|---------|---------|---------|
| Enable notifications | true | true/false |
| Agent errors | critical | critical/normal/off |
| Task completions | normal | critical/normal/off |
| Session idle | low | normal/low/off |
| Update available | low | normal/low/off |
| Sound | system default | on/off |

---

## Window State Persistence

Save and restore window position, size, and maximized state:

```typescript
// packages/desktop/src/platform/paths.ts
import fs from 'node:fs';
import path from 'node:path';

export interface WindowState {
  width: number;
  height: number;
  x: number | undefined;
  y: number | undefined;
  isMaximized: boolean;
}

const WINDOW_STATE_FILE = 'window-state.json';

export function loadWindowState(): WindowState | null {
  const paths = getPlatformPaths();
  const filePath = path.join(paths.stateDir, WINDOW_STATE_FILE);

  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function saveWindowState(state: WindowState): void {
  const paths = getPlatformPaths();
  const filePath = path.join(paths.stateDir, WINDOW_STATE_FILE);

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  } catch {
    // Non-critical, silently ignore
  }
}
```

---

## Deep Links & Protocol Handler

Register `flightdeck://` as a custom protocol:

```typescript
// packages/desktop/src/protocol.ts
import { app, BrowserWindow } from 'electron';

export function registerProtocolHandler(): void {
  // Register as default handler for flightdeck:// URLs
  if (!app.isDefaultProtocolClient('flightdeck')) {
    app.setAsDefaultProtocolClient('flightdeck');
  }

  // Handle URL when app is already running
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  // Handle URL when app is launched from a deep link (Windows/Linux)
  const url = process.argv.find((arg) => arg.startsWith('flightdeck://'));
  if (url) {
    handleDeepLink(url);
  }
}

function handleDeepLink(url: string): void {
  const parsed = new URL(url);
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) return;

  mainWindow.show();
  mainWindow.focus();

  switch (parsed.hostname) {
    case 'open':
      // flightdeck://open?project=<path>
      const projectPath = parsed.searchParams.get('project');
      if (projectPath) {
        mainWindow.webContents.send('open-project', projectPath);
      }
      break;

    case 'session':
      // flightdeck://session/<sessionId>
      const sessionId = parsed.pathname.slice(1);
      mainWindow.webContents.send('navigate', `/sessions/${sessionId}`);
      break;

    case 'settings':
      // flightdeck://settings
      mainWindow.webContents.send('navigate', '/settings');
      break;

    default:
      // Unknown deep link — navigate to home
      mainWindow.webContents.send('navigate', '/');
  }
}
```

### Deep Link Examples

| URL | Action |
|-----|--------|
| `flightdeck://open?project=/Users/me/myrepo` | Open project at path |
| `flightdeck://session/abc123` | Navigate to session |
| `flightdeck://settings` | Open settings |

### Platform Registration

macOS (in `Info.plist`, handled by electron-builder):
```yaml
# electron-builder.yml
mac:
  protocols:
    - name: Flightdeck
      schemes: [flightdeck]
```

Windows (in NSIS installer):
```yaml
nsis:
  # NSIS auto-registers protocol handlers
```

Linux (in `.desktop` file):
```ini
MimeType=x-scheme-handler/flightdeck;
```

---

## Keyboard Shortcuts

### Global Shortcuts

| Shortcut | Action | Platform |
|----------|--------|---------|
| `Cmd+,` / `Ctrl+,` | Settings | All |
| `Cmd+O` / `Ctrl+O` | Open Project | All |
| `Cmd+N` / `Ctrl+N` | New Session | All |
| `Cmd+K` / `Ctrl+K` | Command Palette | All |
| `Cmd+1-4` / `Ctrl+1-4` | Switch tabs (Overview/Crew/Tasks/Analysis) | All |
| `Cmd+Shift+A` | Spawn Agent | All |
| `Cmd+Shift+S` | Stop All Agents | All |
| `Cmd+F` / `Ctrl+F` | Search / Find | All |
| `Cmd+Q` / `Alt+F4` | Quit | macOS / Win+Linux |
| `Cmd+W` / `Ctrl+W` | Close Window | All |
| `Cmd+R` / `Ctrl+R` | Reload | All |

### Global System Shortcut (Optional)

Register a global keyboard shortcut to show/hide Flightdeck from anywhere:

```typescript
import { globalShortcut, BrowserWindow } from 'electron';

export function registerGlobalShortcut(): void {
  // Cmd+Shift+F (macOS) or Ctrl+Shift+F (Win/Linux) to toggle
  const accelerator = process.platform === 'darwin'
    ? 'CommandOrControl+Shift+F'
    : 'CommandOrControl+Shift+F';

  globalShortcut.register(accelerator, () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    if (win.isVisible() && win.isFocused()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });
}
```

---

## Crash Reporting

### Built-in Electron Crash Reporter

```typescript
import { crashReporter } from 'electron';

export function setupCrashReporter(): void {
  crashReporter.start({
    submitURL: '',  // Empty = local-only crash dumps
    uploadToServer: false,
    compress: true,
  });
}
```

Crash dumps are stored in `app.getPath('crashDumps')` and accessible via
Help → View Logs for user-submitted bug reports.

### Optional: Sentry Integration

```typescript
import * as Sentry from '@sentry/electron';

Sentry.init({
  dsn: 'https://...@sentry.io/...',
  release: app.getVersion(),
  // Only send crash reports, not performance data
  tracesSampleRate: 0,
  // Respect user preference
  enabled: settings.get('telemetry.enabled', false),
});
```

---

## Touch Bar (macOS)

For MacBooks with Touch Bar (older models):

```typescript
import { TouchBar, BrowserWindow } from 'electron';

export function setupTouchBar(mainWindow: BrowserWindow): void {
  const touchBar = new TouchBar({
    items: [
      new TouchBar.TouchBarButton({
        label: '▶ Spawn Agent',
        backgroundColor: '#4A90D9',
        click: () => mainWindow.webContents.send('action', 'spawn-agent'),
      }),
      new TouchBar.TouchBarSpacer({ size: 'flexible' }),
      new TouchBar.TouchBarLabel({
        label: '0 agents',
        textColor: '#999',
      }),
      new TouchBar.TouchBarSpacer({ size: 'flexible' }),
      new TouchBar.TouchBarButton({
        label: '⏹ Stop All',
        backgroundColor: '#D94A4A',
        click: () => mainWindow.webContents.send('action', 'stop-all-agents'),
      }),
    ],
  });

  mainWindow.setTouchBar(touchBar);
}
```

---

## Frontend Hooks for Desktop Features

The React frontend detects desktop mode and uses native features when available:

```typescript
// packages/web/src/hooks/useDesktop.ts
import { useCallback } from 'react';

export function useDesktop() {
  const isDesktop = !!window.flightdeck?.isDesktop;
  const api = window.flightdeck;

  const selectDirectory = useCallback(async (title?: string) => {
    if (api) {
      return api.selectDirectory(title);
    }
    // Fallback: prompt for path string in web mode
    return window.prompt(title ?? 'Enter directory path:');
  }, [api]);

  const showNotification = useCallback((title: string, body: string) => {
    if (api) {
      api.showNotification(title, body);
    } else if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  }, [api]);

  return {
    isDesktop,
    isMAS: api?.isMAS ?? false,
    platform: api?.platform ?? 'web',
    selectDirectory,
    showNotification,
    checkForUpdates: api?.checkForUpdates,
  };
}
```
