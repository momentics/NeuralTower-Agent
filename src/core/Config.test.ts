import { describe, it, expect } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"
import { DEFAULT_BACKEND_URL, loadDefaultBackendConfig } from "./Config"

describe("Config", () => {
  it("loadDefaultBackendConfig использует единый дефолтный адрес", () => {
    expect(loadDefaultBackendConfig().url).toBe(DEFAULT_BACKEND_URL)
  })

  it("дефолт в package.json совпадает с DEFAULT_BACKEND_URL", () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const pkgPath = path.join(here, "..", "..", "package.json")
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      contributes: { configuration: { properties: Record<string, { default?: string }> } }
    }
    const declared = pkg.contributes.configuration.properties["neuralTowerAgent.neuralTowerUrl"].default
    expect(declared).toBe(DEFAULT_BACKEND_URL)
  })
})
