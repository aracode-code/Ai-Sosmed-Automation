import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = 'http://127.0.0.1:4317';

/**
 * Dashboard hanya berbicara ke Local API lewat proxy loopback:
 * tidak ada CORS, dan UI tidak pernah membuka database langsung (LLD §2).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': API_TARGET, '/health': API_TARGET }
  },
  preview: {
    port: 5175,
    strictPort: true,
    proxy: { '/api': API_TARGET, '/health': API_TARGET }
  }
});
