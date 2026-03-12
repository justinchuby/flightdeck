# Electron Architecture — Flightdeck Desktop

## Overview

Flightdeck Desktop wraps the existing monorepo (server + web + shared) inside an
Electron shell. The key design principle is **maximum code reuse**: the React
frontend renders unchanged in the Chromium renderer, and the Express/SQLite/WebSocket
server runs directly inside Electron's Node.js main process — no separate server
process, no sidecar.

```
┌────────────────────────────────────────────────────────────────────┐
│                     Electron Application                           │
│                                                                    │
│  ┌──────────────────────────────┐  ┌───────────────────────────┐  │
│  │       Main Process           │  │    Renderer Process        │  │
│  │       (Node.js 20+)          │  │    (Chromium)              │  │
│  │                              │  │                            │  │
│  │  ┌────────────────────────┐  │  │  ┌──────────────────────┐ │  │
│  │  │  Express HTTP Server   │──│──│──│  React 19 Frontend   │ │  │
│  │  │  (localhost:PORT)      │  │  │  │  (Vite-built bundle) │ │  │
│  │  └────────────────────────┘  │  │  └──────────────────────┘ │  │
│  │                              │  │                            │  │
│  │  ┌────────────────────────┐  │  │  Connects via:            │  │
│  │  │  WebSocket Server (ws) │◄─│──│──  ws://localhost:PORT/ws │  │
│  │  │  path: /ws             │  │  │                            │  │
│  │  └────────────────────────┘  │  │  REST:                     │  │
│  │                              │  │    http://localhost:PORT/   │  │
│  │  ┌────────────────────────┐  │  │    api/*                   │  │
│  │  │  SQLite (better-sqlite3│  │  │                            │  │
│  │  │  + drizzle-orm)        │  │  └───────────────────────────┘  │
│  │  └────────────────────────┘  │                                  │
│  │                              │                                  │
│  │  ┌────────────────────────┐  │                                  │
│  │  │  Agent Process Manager │  │                                  │
│  │  │  child_process.spawn() │  │                                  │
│  │  │                        │  │                                  │
│  │  │  ┌──────┐ ┌──────┐    │  │                                  │
│  │  │  │copilot│ │gemini│... │  │                                  │
│  │  │  │ --acp │ │ --acp│    │  │                                  │
│  │  │  └──────┘ └──────┘    │  │                                  │
│  │  └────────────────────────┘  │                                  │
│  │                              │                                  │
│  │  ┌────────────────────────┐  │                                  │
│  │  │  IPC Bridge            │  │                                  │
│  │  │  (Electron ipcMain)    │  │                                  │
│  │  │  - server control      │  │                                  │
│  │  │  - native dialogs      │  │                                  │
│  │  │  - app metrics         │  │                                  │
│  │  └────────────────────────┘  │                                  │
│  └──────────────────────────────┘                                  │
└────────────────────────────────────────────────────────────────────┘
```

---

## Package Structure

A new `packages/desktop/` workspace is added to the monorepo:

```
packages/desktop/
├── src/
│   ├── main.ts                  # Electron main process entry
│   ├── preload.ts               # Context-isolated preload script
│   ├── server-runner.ts         # Starts Flightdeck server in-process
│   ├── window-manager.ts        # Window creation, state persistence
│   ├── menu.ts                  # Native application menu (macOS/Win/Linux)
│   ├── tray.ts                  # System tray / menu bar integration
│   ├── updater.ts               # Auto-update orchestration
│   ├── protocol.ts              # flightdeck:// deep link handler
│   ├── ipc/
│   │   ├── handlers.ts          # IPC channel registry
│   │   ├── server-control.ts    # Start/stop/restart server
│   │   ├── native-dialogs.ts    # File picker, directory picker
│   │   └── app-info.ts          # Version, platform, metrics
│   └── platform/
│       ├── paths.ts             # Platform-aware path resolution
│       ├── sandbox.ts           # MAS sandbox detection + behavior
│       └── bridge-client.ts     # Companion CLI bridge (MAS only)
├── build/
│   ├── entitlements.mac.plist
│   ├── entitlements.mac.inherit.plist
│   ├── entitlements.mas.plist
│   ├── entitlements.mas.inherit.plist
│   ├── icon.icns                # macOS icon (1024x1024 source)
│   ├── icon.ico                 # Windows icon
│   ├── icon.png                 # Linux icon (512x512)
│   └── dmg-background.png       # macOS DMG background image
├── electron-builder.yml         # Build configuration
├── package.json
└── tsconfig.json
```

### package.json

```json
{
  "name": "@flightdeck/desktop",
  "version": "0.4.0",
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "tsc --build && electron-builder",
    "build:mac": "tsc --build && electron-builder --mac",
    "build:win": "tsc --build && electron-builder --win",
    "build:linux": "tsc --build && electron-builder --linux",
    "rebuild": "electron-rebuild -f -w better-sqlite3",
    "postinstall": "electron-builder install-app-deps"
  },
  "dependencies": {
    "@flightdeck/server": "*",
    "@flightdeck/shared": "*"
  },
  "devDependencies": {
    "electron": "^35.0.0",
    "electron-builder": "^26.0.0",
    "@electron/rebuild": "^4.0.0",
    "electron-updater": "^6.0.0",
    "typescript": "^5.9.3"
  }
}
```

### Root package.json changes

```jsonc
{
  "workspaces": [
    "packages/shared",
    "packages/server",
    "packages/web",
    "packages/desktop",  // ← add
    "packages/docs"
  ]
}
```

---

## Main Process Entry Point

```typescript
// packages/desktop/src/main.ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { startFlightdeckServer } from './server-runner';
import { createMainWindow, restoreWindowState } from './window-manager';
import { buildMenu } from './menu';
import { setupTray } from './tray';
import { setupAutoUpdater } from './updater';
import { registerIpcHandlers } from './ipc/handlers';
import { registerProtocolHandler } from './protocol';

let mainWindow: BrowserWindow | null = null;
let serverHandle: { port: number; stop: () => Promise<void> } | null = null;

// Single instance lock — prevent multiple Flightdeck windows
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, _argv, _workingDir) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  // 1. Register IPC handlers before creating any windows
  registerIpcHandlers();

  // 2. Register flightdeck:// protocol handler
  registerProtocolHandler();

  // 3. Start the Flightdeck server in-process
  serverHandle = await startFlightdeckServer({
    isDesktop: true,
  });

  // 4. Create the main window
  mainWindow = createMainWindow(serverHandle.port);
  restoreWindowState(mainWindow);

  // 5. Build native menu
  buildMenu(mainWindow);

  // 6. System tray (optional, user preference)
  setupTray(mainWindow, serverHandle.port);

  // 7. Auto-updater (direct distribution only, not MAS)
  if (!process.mas) {
    setupAutoUpdater(mainWindow);
  }
});

// macOS: re-create window when dock icon clicked with no windows
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverHandle) {
    mainWindow = createMainWindow(serverHandle.port);
  }
});

// Graceful shutdown
app.on('before-quit', async (e) => {
  if (serverHandle) {
    e.preventDefault();
    await serverHandle.stop();
    serverHandle = null;
    app.quit();
  }
});

// Quit when all windows are closed (Windows/Linux)
// macOS: app stays in dock until explicitly quit
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

---

## Server Runner

The key architectural piece: the Express server runs **inside** Electron's main
process rather than as a separate spawned process.

```typescript
// packages/desktop/src/server-runner.ts
import path from 'node:path';
import { app } from 'electron';
import { startFlightdeckServer, type FlightdeckServer } from '@flightdeck/server/start';
import { getPlatformPaths } from './platform/paths';

interface ServerHandle {
  port: number;
  stop: () => Promise<void>;
}

export async function startFlightdeckServer(options: {
  isDesktop: boolean;
  repoRoot?: string;
}): Promise<ServerHandle> {
  const paths = getPlatformPaths();

  const server: FlightdeckServer = await startFlightdeckServer({
    port: 0,                   // Let OS assign a free port
    host: '127.0.0.1',        // Localhost only — no external access
    repoRoot: options.repoRoot ?? app.getPath('home'),
    dbPath: paths.dbPath,
    stateDir: paths.stateDir,
    isDesktop: true,
    openBrowser: false,        // Electron IS the browser
  });

  return {
    port: server.port,
    stop: server.stop,
  };
}
```

### Required server refactoring

The current `packages/server/src/index.ts` runs as a standalone script
(top-level `await`). We need to extract a callable function:

```typescript
// packages/server/src/start.ts (NEW — extracted from index.ts)
export interface FlightdeckServer {
  port: number;
  host: string;
  httpServer: import('http').Server;
  container: ServiceContainer;
  stop: () => Promise<void>;
}

export interface StartOptions {
  port?: number;
  host?: string;
  repoRoot?: string;
  dbPath?: string;
  stateDir?: string;
  configPath?: string;
  isDesktop?: boolean;
  openBrowser?: boolean;
}

export async function startFlightdeckServer(
  options?: StartOptions,
): Promise<FlightdeckServer> {
  // ... existing logic from index.ts, parameterized ...
}
```

The existing `packages/server/src/index.ts` becomes a thin wrapper:

```typescript
// packages/server/src/index.ts (modified)
import { startFlightdeckServer } from './start.js';

const server = await startFlightdeckServer();

// Signal handlers remain here for CLI mode
process.on('SIGINT', () => server.stop());
process.on('SIGTERM', () => server.stop());
```

---

## Window Manager

```typescript
// packages/desktop/src/window-manager.ts
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { loadWindowState, saveWindowState, type WindowState } from './platform/paths';

const DEFAULT_STATE: WindowState = {
  width: 1400,
  height: 900,
  x: undefined,
  y: undefined,
  isMaximized: false,
};

export function createMainWindow(serverPort: number): BrowserWindow {
  const state = loadWindowState() ?? DEFAULT_STATE;

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 800,
    minHeight: 600,
    title: 'Flightdeck',

    // macOS: native-looking title bar with traffic lights
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,     // Security: no Node.js in renderer
      contextIsolation: true,     // Security: isolated preload context
      sandbox: false,             // Needed for preload script
    },

    // Platform-specific
    ...(process.platform === 'darwin' ? {
      vibrancy: 'sidebar',       // macOS translucent sidebar effect
    } : {}),
  });

  if (state.isMaximized) {
    win.maximize();
  }

  // Load the frontend from the local Express server
  win.loadURL(`http://localhost:${serverPort}`);

  // Persist window state on changes
  const saveState = () => {
    if (win.isDestroyed()) return;
    const bounds = win.getBounds();
    saveWindowState({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: win.isMaximized(),
    });
  };

  win.on('resize', saveState);
  win.on('move', saveState);
  win.on('maximize', saveState);
  win.on('unmaximize', saveState);

  return win;
}

export function restoreWindowState(win: BrowserWindow): void {
  // Ensure window is on a visible display
  const state = loadWindowState();
  if (!state?.x || !state?.y) return;

  const displays = screen.getAllDisplays();
  const onScreen = displays.some((d) => {
    const { x, y, width, height } = d.bounds;
    return (
      state.x! >= x &&
      state.y! >= y &&
      state.x! < x + width &&
      state.y! < y + height
    );
  });

  if (!onScreen) {
    win.center();
  }
}
```

---

## Preload Script & IPC Bridge

The preload script exposes a minimal, typed API to the renderer process via
`contextBridge`. No raw Node.js access is given to the renderer.

```typescript
// packages/desktop/src/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

export interface FlightdeckDesktopAPI {
  platform: NodeJS.Platform;
  isDesktop: true;
  isMAS: boolean;

  // Server control
  getServerPort: () => Promise<number>;
  restartServer: () => Promise<void>;

  // Native dialogs
  selectDirectory: (title?: string) => Promise<string | null>;
  selectFile: (title?: string, filters?: { name: string; extensions: string[] }[]) => Promise<string | null>;

  // App info
  getVersion: () => Promise<string>;
  getAppMetrics: () => Promise<Electron.ProcessMetric[]>;

  // Window controls (macOS hiddenInset title bar)
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  isMaximized: () => Promise<boolean>;

  // Auto-updates
  checkForUpdates: () => void;
  onUpdateAvailable: (callback: (info: { version: string }) => void) => void;
  onUpdateDownloaded: (callback: (info: { version: string }) => void) => void;
  installUpdate: () => void;

  // Notifications
  showNotification: (title: string, body: string) => void;
}

const api: FlightdeckDesktopAPI = {
  platform: process.platform,
  isDesktop: true,
  isMAS: !!process.mas,

  getServerPort: () => ipcRenderer.invoke('server:get-port'),
  restartServer: () => ipcRenderer.invoke('server:restart'),

  selectDirectory: (title) => ipcRenderer.invoke('dialog:select-directory', title),
  selectFile: (title, filters) => ipcRenderer.invoke('dialog:select-file', title, filters),

  getVersion: () => ipcRenderer.invoke('app:version'),
  getAppMetrics: () => ipcRenderer.invoke('app:metrics'),

  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),

  checkForUpdates: () => ipcRenderer.send('updater:check'),
  onUpdateAvailable: (cb) => {
    ipcRenderer.on('updater:available', (_e, info) => cb(info));
  },
  onUpdateDownloaded: (cb) => {
    ipcRenderer.on('updater:downloaded', (_e, info) => cb(info));
  },
  installUpdate: () => ipcRenderer.send('updater:install'),

  showNotification: (title, body) => ipcRenderer.send('notification:show', title, body),
};

contextBridge.exposeInMainWorld('flightdeck', api);
```

### IPC Handlers (main process side)

```typescript
// packages/desktop/src/ipc/handlers.ts
import { ipcMain, dialog, BrowserWindow, Notification } from 'electron';
import { app } from 'electron';

export function registerIpcHandlers(): void {
  // Server control
  ipcMain.handle('server:get-port', () => {
    return globalThis.__flightdeckPort;
  });

  // Native directory picker
  ipcMain.handle('dialog:select-directory', async (_event, title?: string) => {
    const result = await dialog.showOpenDialog({
      title: title ?? 'Select Project Directory',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Native file picker
  ipcMain.handle('dialog:select-file', async (_event, title?: string, filters?: any) => {
    const result = await dialog.showOpenDialog({
      title: title ?? 'Select File',
      properties: ['openFile'],
      filters,
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // App info
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:metrics', () => app.getAppMetrics());

  // Window controls
  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.handle('window:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  // Notifications
  ipcMain.on('notification:show', (_event, title: string, body: string) => {
    new Notification({ title, body }).show();
  });
}
```

### Frontend Detection

The React frontend detects desktop mode via the preload-exposed API:

```typescript
// packages/web/src/utils/platform.ts (NEW)
export interface FlightdeckDesktopAPI {
  platform: NodeJS.Platform;
  isDesktop: true;
  isMAS: boolean;
  selectDirectory: (title?: string) => Promise<string | null>;
  // ... etc
}

declare global {
  interface Window {
    flightdeck?: FlightdeckDesktopAPI;
  }
}

export function isDesktop(): boolean {
  return !!window.flightdeck?.isDesktop;
}

export function isMAS(): boolean {
  return !!window.flightdeck?.isMAS;
}

export function getDesktopAPI(): FlightdeckDesktopAPI | undefined {
  return window.flightdeck;
}
```

---

## App Lifecycle

```
App Start
  │
  ├─ 1. requestSingleInstanceLock()
  │     └─ Already running? → Focus existing window, quit new instance
  │
  ├─ 2. registerIpcHandlers()
  │
  ├─ 3. registerProtocolHandler('flightdeck://')
  │
  ├─ 4. startFlightdeckServer()
  │     ├─ Load config from platform-aware path
  │     ├─ Initialize SQLite (better-sqlite3 rebuilt for Electron)
  │     ├─ Run drizzle migrations
  │     ├─ Start Express on localhost:0 (OS-assigned port)
  │     ├─ Start WebSocket server on /ws
  │     └─ Return { port, stop }
  │
  ├─ 5. createMainWindow(port)
  │     ├─ Restore saved position/size
  │     ├─ Set titleBarStyle: 'hiddenInset' (macOS)
  │     └─ loadURL(`http://localhost:${port}`)
  │
  ├─ 6. buildMenu() — native menu bar
  │
  ├─ 7. setupTray() — system tray icon
  │
  └─ 8. setupAutoUpdater() — check for updates (non-MAS only)

Window Close (macOS)
  │
  └─ Window hides. App stays in dock. Server keeps running.
     Re-activate → createMainWindow with same port.

App Quit
  │
  ├─ 'before-quit' event fires
  ├─ server.stop()
  │   ├─ Terminate all agent child processes (SIGTERM, 15s timeout)
  │   ├─ Close WebSocket connections
  │   ├─ Close HTTP server
  │   ├─ Checkpoint + close SQLite
  │   └─ Force-kill any remaining processes
  └─ app.quit()
```

---

## Native Module Handling

`better-sqlite3` is a C++ native addon that must be compiled against Electron's
Node.js ABI, not the system Node.js.

### Build-time rebuild

```json
// packages/desktop/package.json
{
  "scripts": {
    "postinstall": "electron-builder install-app-deps"
  }
}
```

This runs automatically after `npm install` and rebuilds all native modules
(`better-sqlite3`) against the Electron Node.js version.

### electron-builder ASAR config

Native `.node` binaries cannot be loaded from inside an ASAR archive. They must
be unpacked:

```yaml
# electron-builder.yml
asar: true
asarUnpack:
  - "**/*.node"
  - "**/better-sqlite3/**"
  - "**/drizzle/**"
```

---

## Communication Flow

```
Renderer (React)                  Main Process (Node.js)
─────────────────                 ──────────────────────
                                  
fetch('/api/agents')  ─────HTTP────►  Express router
                      ◄────JSON────   returns agent data

new WebSocket('/ws')  ────WS──────►  ws library (WebSocketServer)
                      ◄───events──   agent status, text chunks

ipcRenderer.invoke()  ────IPC─────►  ipcMain.handle()
                      ◄───result──   native dialog result
```

Three communication channels, each serving a distinct purpose:

| Channel | Purpose | Examples |
|---------|---------|---------|
| **HTTP (REST)** | CRUD operations, data queries | GET /api/agents, POST /api/sessions |
| **WebSocket** | Real-time events, streaming | Agent text, status changes, notifications |
| **IPC** | Native desktop features | File dialogs, window control, auto-update |

The HTTP and WebSocket channels are **unchanged** from the CLI version. Only IPC
is new and desktop-specific.

---

## Security Model

| Layer | Protection |
|-------|-----------|
| `nodeIntegration: false` | Renderer cannot access Node.js APIs directly |
| `contextIsolation: true` | Preload runs in isolated context, not shared with page JS |
| `sandbox: false` (preload only) | Preload needs IPC access; renderer is still isolated |
| localhost-only binding | Server binds to 127.0.0.1, not 0.0.0.0 |
| Auth token | Same token-based auth as CLI mode. Desktop auto-injects the token. |
| CSP headers | Helmet middleware sets Content-Security-Policy |

### Auth in Desktop Mode

In CLI mode, the server prints an auth token to stdout. In desktop mode, the
main process generates the token and injects it into the renderer:

```typescript
// In server-runner.ts
const authToken = crypto.randomUUID();
process.env.SERVER_SECRET = authToken;
// Token is also passed to the renderer via a cookie set on loadURL
```
