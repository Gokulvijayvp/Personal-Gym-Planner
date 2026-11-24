import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

declare const process: { env: Record<string, string | undefined> }; // avoids needing @types/node

// Backend the dev server proxies /api to. Override with API_PROXY_TARGET (e.g. to test against another backend).
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  // 15 s: the page tests are heavy and the whole suite runs in parallel, so a busy machine must not turn a slow test into a failure.
  test: { environment: "node", include: ["src/**/*.test.{ts,tsx}"], testTimeout: 15000 },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/health": { target: apiTarget, changeOrigin: true }
    }
  }
});
