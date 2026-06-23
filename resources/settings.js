const vscode = acquireVsCodeApi()

const urlInput = document.getElementById("url") as HTMLInputElement
const modelSelect = document.getElementById("model") as HTMLSelectElement
const maxRetriesInput = document.getElementById("maxRetries") as HTMLInputElement
const timeoutMsInput = document.getElementById("timeoutMs") as HTMLInputElement
const maxIterationsInput = document.getElementById("maxIterations") as HTMLInputElement
const maxSessionsInput = document.getElementById("maxSessions") as HTMLInputElement
const autoApproveToggle = document.getElementById("autoApprove") as HTMLDivElement
const notificationsEnabledToggle = document.getElementById("notificationsEnabled") as HTMLDivElement
const notifyAgentDoneToggle = document.getElementById("notifyAgentDone") as HTMLDivElement
const notifyPermissionsToggle = document.getElementById("notifyPermissions") as HTMLDivElement
const btnSave = document.getElementById("btn-save") as HTMLButtonElement
const btnTest = document.getElementById("btn-test") as HTMLButtonElement
const statusEl = document.getElementById("status") as HTMLDivElement

let cfg = {
  url: "",
  model: "",
  maxRetries: 3,
  timeoutMs: 60000,
  maxIterations: 20,
  maxSessions: 50,
  autoApprove: false,
  notificationsEnabled: true,
  notifyAgentDone: true,
  notifyPermissions: true,
}

// ── Переключение toggle ─────────────────────────────

window.toggleClick = function(el: HTMLElement): void {
  el.classList.toggle("on")
}

function setToggle(el: HTMLElement | null, on: boolean): void {
  if (!el) return
  if (on) {
    el.classList.add("on")
  } else {
    el.classList.remove("on")
  }
}

// ── Обработка сообщений ─────────────────────────────

window.addEventListener("message", (event) => {
  const data = event.data

  switch (data.type) {
    case "settingsData":
      cfg = data.config
      urlInput.value = data.config.url
      modelSelect.innerHTML = ""
      for (const m of data.models) {
        const opt = document.createElement("option")
        opt.value = m
        opt.textContent = m
        if (m === data.config.model) opt.selected = true
        modelSelect.appendChild(opt)
      }
      if (data.models.length === 0) {
        const opt = document.createElement("option")
        opt.value = data.config.model || ""
        opt.textContent = data.config.model || "(none)"
        modelSelect.appendChild(opt)
      }
      if (maxRetriesInput) maxRetriesInput.value = String(data.config.maxRetries ?? 3)
      if (timeoutMsInput) timeoutMsInput.value = String(data.config.timeoutMs ?? 60000)
      if (maxIterationsInput) maxIterationsInput.value = String(data.config.maxIterations ?? 20)
      if (maxSessionsInput) maxSessionsInput.value = String(data.config.maxSessions ?? 50)
      setToggle(autoApproveToggle, data.config.autoApprove ?? false)
      setToggle(notificationsEnabledToggle, data.config.notificationsEnabled ?? true)
      setToggle(notifyAgentDoneToggle, data.config.notifyAgentDone ?? true)
      setToggle(notifyPermissionsToggle, data.config.notifyPermissions ?? true)
      break
    case "settingsSaved":
      setStatus("Настройки сохранены", true)
      break
    case "settingsTestResult":
      setStatus(data.message, data.success)
      break
  }
})

// ── Сохранение ──────────────────────────────────────

btnSave.addEventListener("click", () => {
  vscode.postMessage({
    type: "settingsSave",
    url: urlInput.value,
    model: modelSelect.value,
    maxRetries: maxRetriesInput ? Number(maxRetriesInput.value) : 3,
    timeoutMs: timeoutMsInput ? Number(timeoutMsInput.value) : 60000,
    autoApprove: autoApproveToggle.classList.contains("on"),
    notificationsEnabled: notificationsEnabledToggle.classList.contains("on"),
    notifyAgentDone: notifyAgentDoneToggle.classList.contains("on"),
    notifyPermissions: notifyPermissionsToggle.classList.contains("on"),
  })
})

// ── Проверка соединения ─────────────────────────────

btnTest.addEventListener("click", () => {
  vscode.postMessage({ type: "settingsTest", url: urlInput.value })
})

// ── Статус ──────────────────────────────────────────

function setStatus(msg: string, ok: boolean): void {
  statusEl.textContent = msg
  statusEl.className = `status-line ${ok ? "ok" : "err"}`
}
