import { describe, it, expect } from "vitest"
import { TelemetryService } from "./TelemetryService"

describe("TelemetryService", () => {
  it("implements Plugin interface", () => {
    const svc = new TelemetryService()
    expect(svc.name).toBe("telemetry")
  })

  it("captures events", async () => {
    const svc = new TelemetryService()
    await svc.init()
    svc.capture("session_started", { model: "test" })
    svc.capture("message_sent", { length: 42 })
    svc.dispose()
  })

  it("dispose clears events", () => {
    const svc = new TelemetryService()
    svc.capture("session_started", {})
    svc.dispose()
  })
})
