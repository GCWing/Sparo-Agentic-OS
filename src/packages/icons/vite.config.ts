import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const packageRoot = path.resolve(__dirname);

export default defineConfig({
  root: packageRoot,
  publicDir: false,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
  },
  build: {
    outDir: 'dist-preview',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(packageRoot, 'preview.html'),
    },
  },
});
