import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      external: ['react', 'react/jsx-runtime'],
    },
  },
});
