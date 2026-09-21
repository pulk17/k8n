import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{lib,store}/**/*.test.ts"],
    coverage: { include: ["lib/**/*.ts", "store/**/*.ts"], exclude: ["**/*.test.ts"] },
  },
});
