/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API = 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // In production the backend serves this app, so dev proxies the API paths to it.
  server: {
    proxy: { '/auth': API, '/sessions': API, '/pairing': API, '/me': API, '/health': API }
  },
  test: { environment: 'jsdom', globals: true, setupFiles: './src/test-setup.ts' }
});
