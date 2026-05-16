import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const webUiRoot = path.resolve(__dirname);

// Vite config for the design-system preview.
export default defineConfig({
  root: webUiRoot,
  plugins: [react()],
  publicDir: false,

  // Path resolution
  resolve: {
    alias: {
      "@": path.resolve(webUiRoot, "src"),
      "@/shared": path.resolve(webUiRoot, "src/shared"),
      "@/core": path.resolve(webUiRoot, "src/core"),
      "@/tools": path.resolve(webUiRoot, "src/tools"),
      "@/design-system": path.resolve(webUiRoot, "src/design-system"),
      "@/hooks": path.resolve(webUiRoot, "src/hooks"),
      "@/styles": path.resolve(webUiRoot, "src/design-system/styles"),
      "@/types": path.resolve(webUiRoot, "src/shared/types"),
      "@/utils": path.resolve(webUiRoot, "src/shared/utils"),
    },
  },

  // Design-system preview server config.
  server: {
    port: 3000,
    open: "/preview.html",
    host: true,
  },

  // Design-system preview build config.
  build: {
    outDir: "dist-preview",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        preview: path.resolve(webUiRoot, "preview.html"),
      },
    },
  },
});
