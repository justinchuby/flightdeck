import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': {
        target: 'ws://localhost:3001',
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
