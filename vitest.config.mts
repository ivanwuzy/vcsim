import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], maxWorkers: 1, fileParallelism: false, testTimeout: 60000, hookTimeout: 60000 } });
