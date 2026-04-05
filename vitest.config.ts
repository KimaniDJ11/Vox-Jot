import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@/bindings": resolve(__dirname, "./src/bindings.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "jsdom",
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
  },
});
