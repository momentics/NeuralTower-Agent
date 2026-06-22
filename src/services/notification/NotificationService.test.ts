import { describe, it, expect, vi, beforeEach } from "vitest"
import { NotificationService } from "./NotificationService"
import type { IWindowService } from "../../core/VscodeApi"

describe("NotificationService", () => {
  let window: IWindowService
  let service: NotificationService

  beforeEach(() => {
    window = {
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showWarningMessage: vi.fn().mockResolvedValue(undefined),
      showErrorMessage: vi.fn().mockResolvedValue(undefined),
    }
    service = new NotificationService(window)
  })

  it("shows info notification", async () => {
    await service.show("info", "test message")
    expect(window.showInformationMessage).toHaveBeenCalledWith("test message")
  })

  it("shows warning notification", async () => {
    await service.show("warning", "test message")
    expect(window.showWarningMessage).toHaveBeenCalledWith("test message")
  })

  it("shows error notification", async () => {
    await service.show("error", "test message")
    expect(window.showErrorMessage).toHaveBeenCalledWith("test message")
  })

  it("shows agentDone when enabled", async () => {
    await service.show("agentDone", "done")
    expect(window.showInformationMessage).toHaveBeenCalledWith("done")
  })

  it("skips agentDone when disabled", async () => {
    service.setOptions({ agentCompletion: false })
    await service.show("agentDone", "done")
    expect(window.showInformationMessage).not.toHaveBeenCalled()
  })

  it("shows permissionRequest when enabled", async () => {
    await service.show("permissionRequest", "allow?")
    expect(window.showWarningMessage).toHaveBeenCalledWith("allow?")
  })

  it("skips permissionRequest when disabled", async () => {
    service.setOptions({ permissionRequests: false })
    await service.show("permissionRequest", "allow?")
    expect(window.showWarningMessage).not.toHaveBeenCalled()
  })

  it("skips all when disabled", async () => {
    service.setOptions({ enabled: false })
    await service.show("info", "test")
    expect(window.showInformationMessage).not.toHaveBeenCalled()
  })

  it("shows actions", async () => {
    await service.show("info", "test", ["OK", "Cancel"])
    expect(window.showInformationMessage).toHaveBeenCalledWith("test", "OK", "Cancel")
  })

  it("askPermission returns allow", async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValue("Разрешить" as any)
    const result = await service.askPermission("bash", "Run command?")
    expect(result).toBe("allow")
  })

  it("askPermission returns allowAlways", async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValue("Разрешить всегда" as any)
    const result = await service.askPermission("bash", "Run command?")
    expect(result).toBe("allowAlways")
  })

  it("askPermission returns deny", async () => {
    vi.mocked(window.showWarningMessage).mockResolvedValue("Запретить" as any)
    const result = await service.askPermission("bash", "Run command?")
    expect(result).toBe("deny")
  })

  it("askPermission returns deny when disabled", async () => {
    service.setOptions({ enabled: false })
    const result = await service.askPermission("bash", "Run?")
    expect(result).toBe("deny")
  })

  it("set and get options", () => {
    service.setOptions({ sounds: true })
    expect(service.getOptions().sounds).toBe(true)
  })

  it("init and dispose are no-ops", async () => {
    await service.init()
    service.dispose()
  })
})
