import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { versionInjectionPlugin } from "./vite.config.version-plugin";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const isProduction = mode === 'production' || (command === 'build' && mode !== 'development');
  const isTest = mode === 'test';
  
  return {
    plugins: [
      react(),
      versionInjectionPlugin()
    ],

    // Path resolution
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        ...(isTest ? { "monaco-editor": path.resolve(__dirname, "./src/test/mocks/monaco-editor.ts") } : {}),
        "@": path.resolve(__dirname, "./src"),
        "@/shared": path.resolve(__dirname, "./src/shared"),
        "@/core": path.resolve(__dirname, "./src/core"),
        "@/tools": path.resolve(__dirname, "./src/tools"),
        "@/design-system": path.resolve(__dirname, "./src/design-system"),
        "@/hooks": path.resolve(__dirname, "./src/hooks"),
        "@/styles": path.resolve(__dirname, "./src/design-system/styles"),
        "@/types": path.resolve(__dirname, "./src/shared/types"),
        "@/utils": path.resolve(__dirname, "./src/shared/utils"),
      },
    },

  css: {
    preprocessorOptions: {
      scss: {
        // SCSS preprocessing options (sourcemap is controlled by build.sourcemap)
      },
    },
    // dev mode enabled, release mode disabled
    devSourcemap: !isProduction,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5722,
    // Tauri devUrl is fixed to http://localhost:5722.
    // If Vite silently falls back to another port, the desktop webview stays blank.
    strictPort: true,
    host: host || "localhost",
    hmr: {
      protocol: "ws",
      host: host || "localhost",
      port: 5721,
    },
    // Allow access to workspace root for dependencies like monaco-editor
    fs: {
      allow: [
        path.resolve(__dirname, '../../'), // Workspace root
      ],
    },
    watch: {
      // Ignore Rust crates and apps so the watcher doesn't fan out across the
      // whole workspace. Note: "**/apps/**" is intentionally NOT used here —
      // it would also match src/web-ui/src/app/scenes/apps/ and break HMR
      // for that scene.
      ignored: [
        "**/src-tauri/**",
        "**/src/apps/**",
        "**/src/crates/**",
        "**/target/**",
        "**/.git/**",
        "**/node_modules/.cache/**",
        "**/dist/**",
      ],
      // NTFS / APFS / inotify all deliver native fs notifications fine for a
      // pnpm monorepo. Polling makes Vite stat thousands of files every 100ms
      // and turns a 2-3 s cold start into 20-40 s of white screen on Windows.
      // Only enable polling for cases like network drives or WSL ↔ Windows
      // cross-FS edits, behind an env flag.
      usePolling: process.env.VITE_USE_POLLING === "1",
    },
  },

  // Optimize dependency pre-building.
  //
  // Without an `include` list, Vite discovers heavy deps lazily as the first
  // request walks the import graph; each discovery triggers a "full reload to
  // re-optimize" and stalls dev for several seconds at a time. Listing every
  // top-level heavy dep here lets the pre-bundle finish before the very first
  // request and keeps cold-start under 5 seconds even on Windows.
  optimizeDeps: {
    exclude: [],
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-i18next',
      'i18next',
      'zustand',
      'zustand/middleware',
      'zustand/middleware/immer',
      'zustand/react/shallow',
      '@tauri-apps/api/core',
      '@tauri-apps/api/event',
      '@tauri-apps/api/path',
      '@tauri-apps/api/window',
      '@tauri-apps/api/dpi',
      '@monaco-editor/react',
      'react-markdown',
      'remark-gfm',
      'remark-math',
      'rehype-raw',
      'rehype-katex',
      'mermaid',
      'mermaid/dist/mermaid.esm.min.mjs',
    ],
  },

  // Build options
  build: {
    // Enable CSS code splitting
    cssCodeSplit: true,
    // release version disable sourcemap, dev/debug version enable
    sourcemap: !isProduction,
    // Output to the project root directory dist/
    outDir: '../../dist',
    // Empty the output directory
    emptyOutDir: true,
  }
  };
});
