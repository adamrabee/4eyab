import { defineConfig } from "vitest/config";
import path from "node:path";
import fs from "node:fs";

// Load .env.local (written by `npm run db:up`) so tests can reach the local stack.
if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // "server-only" throws outside a React Server environment; it's a no-op for tests
      "server-only": path.resolve(import.meta.dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
