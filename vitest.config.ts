import { defineConfig } from "vitest/config";

// Os testes do app ficam em src/. Os do relay público (server/) usam o runner
// nativo do Node (node --test) e são rodados à parte.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
