import { describe, it, expect, beforeEach } from "vitest"
import { AutocompleteService } from "./AutocompleteService"

describe("AutocompleteService", () => {
  let service: AutocompleteService

  beforeEach(() => {
    service = new AutocompleteService()
  })

  it("has correct name and version", () => {
    expect(service.name).toBe("autocomplete")
    expect(service.version).toBe("0.1.0")
  })

  it("init is no-op", async () => {
    await service.init()
  })

  it("dispose is no-op", () => {
    service.dispose()
  })
})
