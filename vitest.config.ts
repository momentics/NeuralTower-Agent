import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/ref/**", "**/out/**"],
    environment: "node",
    setupFiles: ["src/__tests__/setup.ts"],
    alias: {
      vscode: path.resolve(__dirname, "src/__tests__/vscode-mock.ts"),
    },
  },
})
