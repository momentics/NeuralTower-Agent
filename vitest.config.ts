import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/ref/**", "**/out/**"],
    environment: "node",
    // Тестовые процессы (форки) грузят WASM-грамматики: --liftoff-only
    // исключает OOM/краш V8 turboshaft (см. план_wasm.md §1.3).
    // Vitest 4: poolOptions удалён — execArgv является top-level опцией.
    pool: "forks",
    execArgv: ["--liftoff-only"],
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ["src/__tests__/Setup.ts"],
    alias: {
      vscode: path.resolve(__dirname, "src/__tests__/VscodeMock.ts"),
    },
  },
})
