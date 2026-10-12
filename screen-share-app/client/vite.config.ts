import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared/types'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      // Redireciona chamadas /api ao servidor de sinalização
      '/socket.io': {
        target: process.env.VITE_SERVER_URL ?? 'http://127.0.0.1:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
