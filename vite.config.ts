import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

// `baseline-browser-mapping` warns when its published data is older than two
// months even if the project is already pinned to the latest available release.
process.env.BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA ??= "true";
process.env.BROWSERSLIST_IGNORE_OLD_DATA ??= "true";

const host = process.env.TAURI_DEV_HOST;
const manualChunkGroups = [
  {
    name: "vendor-tauri",
    packages: [
      "/node_modules/@tauri-apps/api/",
      "/node_modules/@tauri-apps/plugin-os/",
      "/node_modules/@tauri-apps/plugin-fs/",
    ],
  },
  {
    name: "vendor-ui",
    packages: [
      "/node_modules/lucide-react/",
      "/node_modules/react-i18next/",
      "/node_modules/i18next/",
      "/node_modules/sonner/",
    ],
  },
] as const;

const manualChunks = (id: string): string | undefined => {
  const normalizedId = id.replaceAll("\\", "/");
  return manualChunkGroups.find((group) =>
    group.packages.some((packagePath) => normalizedId.includes(packagePath)),
  )?.name;
};

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Path aliases
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      "@/bindings": resolve(import.meta.dirname, "./src/bindings.ts"),
    },
  },

  // Multiple entry points for main app and overlay
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        overlay: resolve(import.meta.dirname, "src/overlay/index.html"),
        detail: resolve(import.meta.dirname, "src/detail/index.html"),
      },
      output: {
        manualChunks,
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
