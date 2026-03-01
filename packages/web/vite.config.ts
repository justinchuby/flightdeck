import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendPort = process.env.VITE_API_PORT || process.env.PORT || '3001';
const backendUrl = `http://localhost:${backendPort}`;
const backendWs = `ws://localhost:${backendPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': backendUrl,
      '/mcp': backendUrl,
      '/ws': {
        target: backendWs,
        ws: true,
        // Suppress ECONNRESET / EPIPE errors when backend restarts or drops connections
        configure: (proxy) => {
          proxy.on('error', () => {});
          proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
            socket.on('error', () => {});
          });
          proxy.on('open', (socket) => {
            socket.on('error', () => {});
          });
          proxy.on('close', (_res, socket) => {
            socket?.on?.('error', () => {});
          });
        },
      },
    },
  },
});
