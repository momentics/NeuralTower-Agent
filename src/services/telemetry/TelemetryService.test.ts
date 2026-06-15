import { describe, it, expect } from "vitest"
import { TelemetryService } from "../../services/telemetry/TelemetryService"

describe("TelemetryService", () => {
  it("implements Plugin interface", () => {
    const svc = new TelemetryService()
    expect(svc.name).toBe("telemetry")
    expect(svc.version).toBe("0.1.0")
  })

  it("captures events", async () => {
    const svc = new TelemetryService()
    await svc.init()
    svc.capture("session_started", { model: "test" })
    svc.capture("message_sent", { length: 42 })
    svc.dispose()
  })

  it("singleton get returns same instance", () => {
    const a = TelemetryService.get()
    const b = TelemetryService.get()
    expect(a).toBe(b)
  })

  it("dispose clears events", () => {
    const svc = new TelemetryService()
    svc.capture("session_started", {})
    svc.dispose()
  })
})
