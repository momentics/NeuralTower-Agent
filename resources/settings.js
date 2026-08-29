const vscode = acquireVsCodeApi()

const urlInput = document.getElementById("url")
const modelSelect = document.getElementById("model")
const maxRetriesInput = document.getElementById("maxRetries")
const timeoutMsInput = document.getElementById("timeoutMs")
const maxIterationsInput = document.getElementById("maxIterations")
const maxSessionsInput = document.getElementById("maxSessions")
const autoApproveToggle = document.getElementById("autoApprove")
const notificationsEnabledToggle = document.getElementById("notificationsEnabled")
const notifyAgentDoneToggle = document.getElementById("notifyAgentDone")
const notifyPermissionsToggle = document.getElementById("notifyPermissions")
const btnSave = document.getElementById("btn-save")
const btnTest = document.getElementById("btn-test")
const statusEl = document.getElementById("status")

// ── Переключение toggle ─────────────────────────────

window.toggleClick = function (el) {
  el.classList.toggle("on")
}

function setToggle(el, on) {
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
      if (maxRetriesInput) maxRetriesInput.value = String(data.config.maxRetries)
      if (timeoutMsInput) timeoutMsInput.value = String(data.config.timeoutMs)
      if (maxIterationsInput) maxIterationsInput.value = String(data.config.maxIterations)
      if (maxSessionsInput) maxSessionsInput.value = String(data.config.maxSessions)
      setToggle(autoApproveToggle, data.config.autoApprove)
      setToggle(notificationsEnabledToggle, data.config.notificationsEnabled)
      setToggle(notifyAgentDoneToggle, data.config.notifyAgentDone)
      setToggle(notifyPermissionsToggle, data.config.notifyPermissions)
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
    maxRetries: Number(maxRetriesInput.value),
    timeoutMs: Number(timeoutMsInput.value),
    maxIterations: Number(maxIterationsInput.value),
    maxSessions: Number(maxSessionsInput.value),
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

function setStatus(msg, ok) {
  statusEl.textContent = msg
  statusEl.className = `status-line ${ok ? "ok" : "err"}`
}
