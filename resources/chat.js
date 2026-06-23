const vscode = acquireVsCodeApi()

const form = document.getElementById("chat-form") as HTMLFormElement
const input = document.getElementById("input") as HTMLTextAreaElement
const messages = document.getElementById("messages") as HTMLDivElement
const emptyState = document.getElementById("empty-state") as HTMLDivElement
const sessionsList = document.getElementById("sessions-list") as HTMLDivElement
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement
const contextPills = document.getElementById("context-pills") as HTMLDivElement
const permOverlay = document.getElementById("perm-overlay") as HTMLDivElement
const permDesc = document.getElementById("perm-desc") as HTMLDivElement
const statusDot = document.getElementById("status-dot") as HTMLSpanElement
const statusText = document.getElementById("status-text") as HTMLSpanElement
const statusMode = document.getElementById("status-mode") as HTMLDivElement
const sessionsSection = document.getElementById("sessions-section") as HTMLDivElement

let currentEl: HTMLElement | null = null
let sessions: Array<{ id: string; title: string; pinned: boolean; updatedAt: number; messageCount: number; active: boolean }> = []
let isStreaming = false
let currentMode = "build"
let pendingPermission: { requestId: string; toolName: string; description: string } | null = null

// ── Отправка сообщения ──────────────────────────────

form.addEventListener("submit", (e) => {
  e.preventDefault()
  const text = input.value.trim()
  if (!text) return
  input.value = ""
  input.style.height = "auto"
  setStreaming(true)
  vscode.postMessage({ type: "sendMessage", content: text })
})

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    form.requestSubmit()
  }
})

input.addEventListener("input", () => {
  input.style.height = "auto"
  input.style.height = Math.min(input.scrollHeight, 100) + "px"
})

stopBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "stopAgent" })
})

// ── Переключение режима ─────────────────────────────

window.switchMode = function(mode: string): void {
  currentMode = mode
  const chips = document.querySelectorAll(".mode-chip") as NodeListOf<HTMLDivElement>
  chips.forEach((chip) => {
    const m = chip.dataset.mode
    if (m === mode) {
      chip.classList.remove("inactive")
    } else {
      chip.classList.add("inactive")
    }
  })
  const modeNames: Record<string, string> = { build: "Построение", plan: "Планирование", explore: "Исследование" }
  const modeIcons: Record<string, string> = {
    build: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>',
    plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>',
    explore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  }
  statusMode.innerHTML = `${modeIcons[mode] || ""} ${modeNames[mode] || mode}`
  vscode.postMessage({ type: "switchMode", mode })
}

// ── Быстрые действия ────────────────────────────────

window.sendQuick = function(text: string): void {
  if (isStreaming) return
  input.value = text
  form.requestSubmit()
}

// ── Разрешения ──────────────────────────────────────

window.allowPermission = function(): void {
  if (pendingPermission) {
    vscode.postMessage({
      type: "permissionResponse",
      requestId: pendingPermission.requestId,
      allowed: true,
      always: false,
    })
  }
  closePermDialog()
}

window.denyPermission = function(): void {
  if (pendingPermission) {
    vscode.postMessage({
      type: "permissionResponse",
      requestId: pendingPermission.requestId,
      allowed: false,
      always: false,
    })
  }
  closePermDialog()
}

function closePermDialog(): void {
  permOverlay.style.display = "none"
  pendingPermission = null
}

function showPermDialog(requestId: string, toolName: string, description: string): void {
  pendingPermission = { requestId, toolName, description }
  permDesc.innerHTML = `Инструмент <code style="font-family:var(--mono);font-size:10px;background:var(--bg-primary);padding:1px 4px;border-radius:3px;">${toolName}</code> хочет выполнить действие. Разрешить?`
  permOverlay.style.display = "flex"
}

// ── Обработка сообщений от расширения ────────────────

window.addEventListener("message", (event) => {
  const data = event.data

  switch (data.type) {
    case "messageConfirmed":
      hideEmpty()
      append("user", data.content)
      currentEl = append("assistant", "")
      break

    case "streamChunk":
      if (currentEl) currentEl.textContent += data.text
      messages.scrollTop = messages.scrollHeight
      break

    case "streamDone":
      removeStreamingDot()
      setStreaming(false)
      currentEl = null
      break

    case "streamError":
      if (currentEl) currentEl.remove()
      append("error", data.error)
      setStreaming(false)
      currentEl = null
      break

    case "newChat":
      while (messages.firstChild) messages.removeChild(messages.firstChild)
      showEmpty()
      currentEl = null
      setStreaming(false)
      contextPills.innerHTML = ""
      break

    case "toolUse":
      appendToolUse(data.toolName)
      break

    case "toolResult":
      appendToolResult(data.toolName, data.output, data.success)
      break

    case "sessionList":
      sessions = data.sessions
      renderSessions()
      break

    case "switchSession":
      vscode.postMessage({ type: "createSession" })
      break

    case "agentDone":
      break

    case "permissionRequest":
      showPermDialog(data.requestId, data.toolName, data.description)
      break
  }
})

// ── Состояние стриминга ─────────────────────────────

function setStreaming(streaming: boolean): void {
  isStreaming = streaming
  sendBtn.style.display = streaming ? "none" : "flex"
  stopBtn.style.display = streaming ? "flex" : "none"
  sendBtn.disabled = streaming
  input.disabled = streaming

  if (streaming) {
    statusDot.className = "status-dot yellow"
    statusText.textContent = "Работает"
  } else {
    statusDot.className = "status-dot green"
    statusText.textContent = "Подключено"
  }
}

// ── Добавление сообщений ────────────────────────────

function append(role: string, text: string): HTMLElement {
  const wrapper = document.createElement("div")
  wrapper.className = `msg ${role}`

  const avatar = document.createElement("div")
  avatar.className = "msg-avatar"
  avatar.textContent = role === "user" ? "U" : "N"

  const bubble = document.createElement("div")
  bubble.className = "msg-bubble"
  bubble.textContent = text

  wrapper.appendChild(avatar)
  wrapper.appendChild(bubble)
  messages.appendChild(wrapper)
  messages.scrollTop = messages.scrollHeight
  return bubble
}

function appendStreaming(): void {
  if (currentEl) {
    const dot = document.createElement("span")
    dot.className = "streaming-dot"
    currentEl.appendChild(dot)
  }
}

function removeStreamingDot(): void {
  if (currentEl) {
    const dot = currentEl.querySelector(".streaming-dot")
    if (dot) dot.remove()
  }
}

function appendToolUse(toolName: string): void {
  const el = document.createElement("div")
  el.className = "tool-use"
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--peach)" stroke-width="2"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg> ${toolName}`
  messages.appendChild(el)
  messages.scrollTop = messages.scrollHeight
}

function appendToolResult(toolName: string, output: string, success: boolean): void {
  const el = document.createElement("div")
  el.className = `tool-result${success ? "" : " fail"}`
  const truncated = output.length > 500 ? output.slice(0, 500) + "..." : output
  el.textContent = `[${toolName}] ${truncated}`
  messages.appendChild(el)
  messages.scrollTop = messages.scrollHeight
}

// ── Скрытие / показ пустого состояния ───────────────

function hideEmpty(): void {
  if (emptyState) emptyState.style.display = "none"
  if (sessionsSection) sessionsSection.style.display = "none"
  appendStreaming()
}

function showEmpty(): void {
  if (emptyState) emptyState.style.display = "flex"
  if (sessionsSection) sessionsSection.style.display = "block"
}

// ── Время ───────────────────────────────────────────

function timeAgo(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  const weeks = Math.floor(diff / 604800000)

  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  return `${weeks}w`
}

// ── Рендер сессий ───────────────────────────────────

function renderSessions(): void {
  if (!sessionsList) return

  sessionsList.innerHTML = ""

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  const shown = sorted.slice(0, 5)

  for (const s of shown) {
    const item = document.createElement("div")
    item.className = `session-item${s.active ? " active" : ""}`

    const dot = document.createElement("span")
    dot.className = `session-dot ${s.active ? "live" : "done"}`

    const title = document.createElement("span")
    title.className = "session-title"
    title.textContent = s.title
    title.title = s.title

    const time = document.createElement("span")
    time.className = "session-time"
    time.textContent = timeAgo(s.updatedAt)

    item.appendChild(dot)
    item.appendChild(title)
    item.appendChild(time)

    item.addEventListener("click", () => {
      if (!s.active) {
        vscode.postMessage({ type: "switchSession", sessionId: s.id })
      }
    })

    sessionsList.appendChild(item)
  }
}
