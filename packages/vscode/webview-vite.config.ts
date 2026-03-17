import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * Vite config for building the Flightdeck web app as a VS Code webview.
 *
 * Key differences from the normal web build:
 * - base is './' (relative paths for webview resource loading)
 * - Output goes to dist/webview/ (separate from extension host bundle)
 * - WebSocket connections are replaced by a postMessage bridge
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  root: resolve(__dirname, '../web'),
  build: {
    outDir: resolve(__dirname, 'dist/webview'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, '../web/index.html'),
    },
    // Produce deterministic chunk names for CSP script-src
    sourcemap: false,
  },
  resolve: {
    alias: {
      // Redirect WebSocket transport to the postMessage bridge
      '@flightdeck/ws-transport': resolve(__dirname, 'src/webview/bridge.ts'),
    },
  },
  define: {
    // Signal to the web app that it's running inside a VS Code webview
    'import.meta.env.VSCODE_WEBVIEW': JSON.stringify(true),
  },
});
