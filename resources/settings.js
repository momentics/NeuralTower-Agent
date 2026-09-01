const vscode = acquireVsCodeApi()

const urlInput = document.getElementById("url")
const modelInput = document.getElementById("model")
const modelList = document.getElementById("model-list")
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

// Дружелюбное имя модели: если ID — путь (SGLang возвращает путь к файлам
// модели), показываем последний сегмент.
function friendlyModelName(id) {
  const s = String(id)
  const parts = s.split(/[\\/]+/)
  const last = parts[parts.length - 1]
  return last && last !== s ? last : s
}

// ── Обработка сообщений ─────────────────────────────

window.addEventListener("message", (event) => {
  const data = event.data

  switch (data.type) {
    case "settingsData":
      urlInput.value = data.config.url
      modelList.replaceChildren()
      for (const m of data.models) {
        const opt = document.createElement("option")
        opt.value = m
        opt.label = friendlyModelName(m)
        modelList.appendChild(opt)
      }
      modelInput.value = data.config.model || ""
      const models = data.models || []
      if (models.length > 0 && data.config.model && !models.includes(data.config.model)) {
        setStatus(
          models.length === 1
            ? `Модель «${data.config.model}» не найдена на сервере. Доступна: ${friendlyModelName(models[0])}`
            : `Модель «${data.config.model}» не найдена на сервере`,
          false,
        )
      } else if (!data.config.model && models.length === 1) {
        setStatus(`Модель выбрана автоматически: ${friendlyModelName(models[0])}`, true)
      } else if (!data.config.model && models.length > 1) {
        setStatus(`На сервере несколько моделей — укажите модель в поле «Модель»`, false)
      }
      if (maxRetriesInput) maxRetriesInput.value = String(data.config.maxRetries)
      if (timeoutMsInput) timeoutMsInput.value = String(data.config.timeoutMs)
      if (maxIterationsInput) maxIterationsInput.value = String(data.config.maxIterations)
      if (maxSessionsInput) maxSessionsInput.value = String(data.config.maxSessions)
      setToggle(autoApproveToggle, data.config.autoApprove)
      setToggle(notificationsEnabledToggle, data.config.notificationsEnabled)
      setToggle(notifyAgentDoneToggle, data.config.notifyAgentDone)
      setToggle(notifyPermissionsToggle, data.config.notifyPermissions)
      const mcpList = document.getElementById("mcp-list")
      if (mcpList) {
        mcpList.replaceChildren()
        const servers = data.config.mcpServers || []
        if (servers.length === 0) {
          const empty = document.createElement("div")
          empty.className = "mcp-row mcp-empty"
          empty.textContent = "Внешние MCP-серверы не настроены"
          mcpList.appendChild(empty)
        }
        for (const s of servers) {
          const row = document.createElement("div")
          row.className = "mcp-row"
          const name = document.createElement("span")
          name.className = "mcp-name"
          name.textContent = `${s.ready ? "●" : "○"} ${s.name}`
          const cmd = document.createElement("span")
          cmd.className = "mcp-cmd"
          cmd.textContent = `${s.command}${s.toolCount > 0 ? ` · ${s.toolCount} инструментов` : s.ready ? "" : " · не подключен"}`
          row.appendChild(name)
          row.appendChild(cmd)
          mcpList.appendChild(row)
        }
      }
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
  // Пустое поле модели — осмысленное состояние: автовыбор с сервера.
  vscode.postMessage({
    type: "settingsSave",
    url: urlInput.value,
    model: modelInput.value.trim(),
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
