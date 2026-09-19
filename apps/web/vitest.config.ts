import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    coverage: { include: ["lib/**/*.ts"], exclude: ["lib/**/*.test.ts"] },
  },
});
