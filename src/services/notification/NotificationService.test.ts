import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { NotificationService } from "./NotificationService"

describe("NotificationService", () => {
  let service: NotificationService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new NotificationService()
    vi.spyOn(vscode.window, "showInformationMessage").mockResolvedValue(undefined as any)
    vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined as any)
    vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined as any)
  })

  it("shows info notification", async () => {
    await service.show("info", "test message")
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("test message")
  })

  it("shows warning notification", async () => {
    await service.show("warning", "test message")
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("test message")
  })

  it("shows error notification", async () => {
    await service.show("error", "test message")
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("test message")
  })

  it("shows agentDone when enabled", async () => {
    await service.show("agentDone", "done")
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("done")
  })

  it("skips agentDone when disabled", async () => {
    service.setOptions({ agentCompletion: false })
    await service.show("agentDone", "done")
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
  })

  it("shows permissionRequest when enabled", async () => {
    await service.show("permissionRequest", "allow?")
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith("allow?")
  })

  it("skips permissionRequest when disabled", async () => {
    service.setOptions({ permissionRequests: false })
    await service.show("permissionRequest", "allow?")
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled()
  })

  it("skips all when disabled", async () => {
    service.setOptions({ enabled: false })
    await service.show("info", "test")
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
  })

  it("shows actions", async () => {
    await service.show("info", "test", ["OK", "Cancel"])
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("test", "OK", "Cancel")
  })

  it("askPermission returns allow", async () => {
    vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue("Разрешить" as any)
    const result = await service.askPermission("bash", "Run command?")
    expect(result).toBe("allow")
  })

  it("askPermission returns allowAlways", async () => {
    vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue("Разрешить всегда" as any)
    const result = await service.askPermission("bash", "Run command?")
    expect(result).toBe("allowAlways")
  })

  it("askPermission returns deny", async () => {
    vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue("Запретить" as any)
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
