import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/health': 'http://localhost:3001',
      '/metrics': 'http://localhost:3001',
      '/conversations': 'http://localhost:3001',
      '/chat': 'http://localhost:3001',
      '/ingest': 'http://localhost:3001'
    }
  }
});