/**
 * Webview чата: сообщения, сессии, стриминг, разрешения
 * и режимы агента (build / plan / explore).
 *
 * Бандлится esbuild в out/webview/chat.js (IIFE) и грузится в webview
 * с nonce. Все обработчики событий привязываются через addEventListener
 * (CSP webview запрещает inline onclick).
 */

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

const vscode = acquireVsCodeApi()

// ── DOM-ссылки ────────────────────────────────────────

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
const permAllowBtn = document.getElementById("perm-allow") as HTMLButtonElement
const permDenyBtn = document.getElementById("perm-deny") as HTMLButtonElement
const statusDot = document.getElementById("status-dot") as HTMLSpanElement
const statusText = document.getElementById("status-text") as HTMLSpanElement
const statusMode = document.getElementById("status-mode") as HTMLDivElement
const sessionsSection = document.getElementById("sessions-section") as HTMLDivElement
const newChatBtn = document.getElementById("btn-new-chat") as HTMLButtonElement
const settingsBtn = document.getElementById("btn-settings") as HTMLButtonElement
const sessionsBtn = document.getElementById("btn-sessions") as HTMLButtonElement
const checkpointsBtn = document.getElementById("btn-checkpoints") as HTMLButtonElement
const modeErrorEl = document.getElementById("mode-error") as HTMLDivElement

// ── Типы и состояние ──────────────────────────────────

interface SessionInfo {
  id: string
  title: string
  pinned: boolean
  updatedAt: number
  messageCount: number
  active: boolean
}

let currentEl: HTMLElement | null = null
let sessions: SessionInfo[] = []
let isStreaming = false
let currentMode = "build"
let allowedModes: string[] = ["plan", "explore"]
let pendingPermission: { requestId: string; toolName: string; description: string } | null = null
let modeErrorTimer: number | null = null
let pendingSnapshot: { runId: string; fileCount: number } | null = null
const snapshotInfos = new Map<string, { fileCount: number }>()

const modeNames: Record<string, string> = {
  build: "Построение",
  plan: "Планирование",
  explore: "Исследование",
}

const modeIcons: Record<string, string> = {
  build: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>',
  explore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
}

// ── Режимы агента ─────────────────────────────────────

/** Применить состояние режима от extension: активный чип, disabled, статус-бар. */
function applyMode(mode: string, allowed: string[]): void {
  currentMode = mode
  allowedModes = Array.isArray(allowed) ? allowed : []
  const chips = document.querySelectorAll<HTMLElement>(".mode-chip")
  chips.forEach((chip) => {
    const m = chip.dataset.mode ?? ""
    const isActive = m === mode
    const isDisabled = !isActive && !allowedModes.includes(m)
    chip.classList.toggle("inactive", !isActive)
    chip.classList.toggle("disabled", isDisabled)
    if (isActive) {
      chip.title = "Текущий режим"
    } else if (isDisabled) {
      chip.title = `Недоступно из режима «${modeNames[mode] ?? mode}»`
    } else {
      chip.title = modeNames[m] ?? m
    }
  })
  statusMode.innerHTML = `${modeIcons[mode] ?? ""} ${modeNames[mode] ?? mode}`
}

/** Показать временную ошибку под панелью режимов (3 секунды). */
function showModeError(message: string): void {
  modeErrorEl.textContent = message
  modeErrorEl.style.display = "block"
  if (modeErrorTimer !== null) {
    window.clearTimeout(modeErrorTimer)
  }
  modeErrorTimer = window.setTimeout(() => {
    modeErrorEl.style.display = "none"
    modeErrorTimer = null
  }, 3000)
}

/** Запросить смену режима: локальная валидация + сообщение в extension. */
function requestModeSwitch(mode: string): void {
  if (mode !== currentMode && !allowedModes.includes(mode)) {
    showModeError(
      `Переход в режим «${modeNames[mode] ?? mode}» недоступен из режима «${modeNames[currentMode] ?? currentMode}»`,
    )
    return
  }
  vscode.postMessage({ type: "switchMode", mode })
}

// ── Отправка сообщения ────────────────────────────────

form.addEventListener("submit", (e: SubmitEvent) => {
  e.preventDefault()
  const text = input.value.trim()
  if (!text) return
  input.value = ""
  input.style.height = "auto"
  setStreaming(true)
  vscode.postMessage({ type: "sendMessage", content: text })
})

input.addEventListener("keydown", (e: KeyboardEvent) => {
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

// ── Режимы: чипы ──────────────────────────────────────

document.querySelectorAll<HTMLElement>(".mode-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    requestModeSwitch(chip.dataset.mode ?? "")
  })
})

// ── Быстрые действия ──────────────────────────────────

document.querySelectorAll<HTMLElement>(".quick-action").forEach((el) => {
  el.addEventListener("click", () => {
    const text = el.dataset.text ?? ""
    if (isStreaming) return
    input.value = text
    form.requestSubmit()
  })
})

// ── Кнопки шапки ──────────────────────────────────────

newChatBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "createSession" })
})

settingsBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "settings" })
})

sessionsBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "sessionList" })
})

// ── Чекпоинты: панель списка ───────────────────────────

/** Панель чекпоинтов активной сессии (рядом со списком сессий). */
const checkpointPanel = document.createElement("div")
checkpointPanel.className = "checkpoint-panel"
checkpointPanel.style.display = "none"
if (sessionsList) sessionsList.insertAdjacentElement("afterend", checkpointPanel)

checkpointsBtn.addEventListener("click", () => {
  if (checkpointPanel.style.display === "none") {
    vscode.postMessage({ type: "listCheckpoints" })
    checkpointPanel.style.display = "block"
  } else {
    checkpointPanel.style.display = "none"
  }
})

// ── Разрешения ────────────────────────────────────────

permAllowBtn.addEventListener("click", () => {
  if (pendingPermission) {
    vscode.postMessage({
      type: "permissionResponse",
      requestId: pendingPermission.requestId,
      allowed: true,
      always: false,
    })
  }
  closePermDialog()
})

permDenyBtn.addEventListener("click", () => {
  if (pendingPermission) {
    vscode.postMessage({
      type: "permissionResponse",
      requestId: pendingPermission.requestId,
      allowed: false,
      always: false,
    })
  }
  closePermDialog()
})

function closePermDialog(): void {
  permOverlay.style.display = "none"
  pendingPermission = null
}

function showPermDialog(requestId: string, toolName: string, description: string): void {
  pendingPermission = { requestId, toolName, description }
  permDesc.innerHTML = `Инструмент <code>${toolName}</code> хочет выполнить действие. Разрешить?`
  permOverlay.style.display = "flex"
}

// ── Сообщения от extension ────────────────────────────

window.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as Record<string, unknown> & { type: string }

  switch (data.type) {
    case "messageConfirmed":
      hideEmpty()
      append("user", String(data.content))
      currentEl = append("assistant", "")
      break

    case "streamChunk":
      if (currentEl) currentEl.textContent += String(data.text)
      messages.scrollTop = messages.scrollHeight
      break

    case "streamDone":
      removeStreamingDot()
      if (pendingSnapshot && currentEl) {
        attachRevertButton(currentEl, pendingSnapshot)
      }
      pendingSnapshot = null
      setStreaming(false)
      currentEl = null
      break

    case "streamError":
      if (currentEl) currentEl.remove()
      append("error", String(data.error))
      setStreaming(false)
      currentEl = null
      break

    case "newChat":
      for (let i = messages.children.length - 1; i >= 0; i--) {
        const child = messages.children[i]
        if (child !== emptyState) child.remove()
      }
      showEmpty()
      currentEl = null
      setStreaming(false)
      contextPills.innerHTML = ""
      break

    case "toolUse":
      appendToolUse(String(data.toolName))
      break

    case "toolResult":
      appendToolResult(String(data.toolName), String(data.output), Boolean(data.success))
      break

    case "sessionList":
      sessions = data.sessions as SessionInfo[]
      renderSessions()
      break

    case "switchSession":
      vscode.postMessage({ type: "createSession" })
      break

    case "agentDone":
      break

    case "permissionRequest":
      showPermDialog(String(data.requestId), String(data.toolName), String(data.description))
      break

    case "modeChanged":
      applyMode(String(data.mode), data.allowed as string[])
      break

    case "modeSwitchError":
      showModeError(String(data.message))
      break

    case "snapshotInfo": {
      const info = { runId: String(data.runId), fileCount: Number(data.fileCount) }
      if (info.fileCount > 0) {
        pendingSnapshot = info
        if (currentEl) {
          attachRevertButton(currentEl, info)
          pendingSnapshot = null
        }
      }
      break
    }

    case "checkpointList": {
      checkpointPanel.innerHTML = ""
      const list = (data.checkpoints as Array<{ runId: string; createdAt: number; fileCount: number }>) ?? []
      if (list.length === 0) {
        const empty = document.createElement("div")
        empty.className = "checkpoint-empty"
        empty.textContent = "Чекпоинтов пока нет"
        checkpointPanel.appendChild(empty)
        break
      }
      for (const cp of list) {
        const rowEl = document.createElement("div")
        rowEl.className = "checkpoint-row"
        const time = new Date(cp.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
        const label = document.createElement("span")
        label.className = "checkpoint-label"
        label.textContent = `${time} · ${cp.fileCount} файл(ов)`
        const btn = document.createElement("button")
        btn.type = "button"
        btn.className = "checkpoint-restore"
        btn.textContent = "Только файлы"
        btn.addEventListener("click", () => {
          if (!window.confirm("Откатить изменения этого запроса? Файлы, изменённые последующими запросами, не будут затронуты.")) return
          btn.disabled = true
          vscode.postMessage({ type: "restoreCheckpoint", runId: cp.runId })
        })
        const fullBtn = document.createElement("button")
        fullBtn.type = "button"
        fullBtn.className = "checkpoint-restore checkpoint-restore-full"
        fullBtn.textContent = "Файлы + переписка"
        fullBtn.title = "Откатить файлы запроса и отмотать переписку к состоянию до него"
        fullBtn.addEventListener("click", () => {
          if (!window.confirm("Вернуть файлы и переписку к состоянию до этого запроса? Последующие сообщения будут удалены.")) return
          fullBtn.disabled = true
          vscode.postMessage({ type: "restoreSessionCheckpoint", runId: cp.runId })
        })
        rowEl.appendChild(label)
        rowEl.appendChild(btn)
        rowEl.appendChild(fullBtn)
        checkpointPanel.appendChild(rowEl)
      }
      break
    }

    case "snapshotReverted": {
      const runId = String(data.runId)
      const ok = Boolean(data.ok)
      const undoAvailable = Boolean(data.undoAvailable)
      const skipped = Number(data.skippedCount ?? 0)
      showToast(
        ok
          ? `Изменения откатлены${skipped > 0 ? `, пропущено: ${skipped} (изменялись после запроса)` : ""}`
          : `Не удалось откатить: ${String(data.error ?? "ошибка")}`,
        ok,
      )
      if (ok) {
        const revertBtn = document.querySelector<HTMLButtonElement>(`.snapshot-revert[data-run-id="${runId}"]`)
        const undoBtn = document.querySelector<HTMLButtonElement>(`.snapshot-undo[data-run-id="${runId}"]`)
        if (undoAvailable && revertBtn && undoBtn) {
          // Откат можно отменить — показать кнопку undo вместо revert
          revertBtn.style.display = "none"
          undoBtn.style.display = ""
          undoBtn.disabled = false
        } else {
          // Undo недоступен — убрать обе кнопки для этого запроса
          document.querySelectorAll<HTMLElement>(".snapshot-revert[data-run-id], .snapshot-undo[data-run-id]")
            .forEach((el) => { if (el.dataset.runId === runId) el.remove() })
        }
      }
      break
    }

    case "undoReverted": {
      const runId = String(data.runId)
      const ok = Boolean(data.ok)
      showToast(
        ok ? "Откат отменён — изменения возвращены" : `Не удалось отменить откат: ${String(data.error ?? "ошибка")}`,
        ok,
      )
      if (ok) {
        const revertBtn = document.querySelector<HTMLButtonElement>(`.snapshot-revert[data-run-id="${runId}"]`)
        const undoBtn = document.querySelector<HTMLButtonElement>(`.snapshot-undo[data-run-id="${runId}"]`)
        if (revertBtn) { revertBtn.style.display = ""; revertBtn.disabled = false }
        if (undoBtn) undoBtn.style.display = "none"
      }
      break
    }

    case "sessionCheckpointRestored": {
      const ok = Boolean(data.ok)
      if (ok) {
        // Чистим чат: extension перешлёт переписку до чекпоинта
        // (sendActiveMessages) — старые элементы удаляем, как в newChat
        for (let i = messages.children.length - 1; i >= 0; i--) {
          const child = messages.children[i]
          if (child !== emptyState) child.remove()
        }
        currentEl = null
        showEmpty()
      }
      showToast(
        ok ? "Сессия восстановлена к выбранному моменту" : `Не удалось восстановить сессию: ${String(data.error ?? "ошибка")}`,
        ok,
      )
      break
    }
  }
})

// ── Состояние стриминга ───────────────────────────────

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

// ── Добавление сообщений ──────────────────────────────

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

// ── Чекпоинты: откат изменений запроса ──────────────────

/**
 * Прикрепить кнопку отката к assistant-сообщению.
 * @param bubble элемент пузыря сообщения
 */
function attachRevertButton(bubble: HTMLElement, info: { runId: string; fileCount: number }): void {
  const wrapper = bubble.closest(".msg") ?? bubble.parentElement
  if (!wrapper) return
  // Не дублировать кнопку для одного запроса
  if (wrapper.querySelector(`.snapshot-revert[data-run-id="${info.runId}"]`)) return

  snapshotInfos.set(info.runId, info)

  const row = document.createElement("div")
  row.className = "snapshot-revert-row"

  const btn = document.createElement("button")
  btn.type = "button"
  btn.className = "snapshot-revert"
  btn.dataset.runId = info.runId
  btn.textContent = `↩ Откатить изменения (${info.fileCount})`
  btn.title = "Вернуть файлы к состоянию перед этим запросом"
  btn.addEventListener("click", () => {
    const confirmed = window.confirm(
      `Откатить ${info.fileCount} файл(ов) к состоянию перед запросом? Откат можно отменить.`,
    )
    if (!confirmed) return
    btn.disabled = true
    vscode.postMessage({ type: "revertSnapshot", runId: info.runId })
  })

  const undoBtn = document.createElement("button")
  undoBtn.type = "button"
  undoBtn.className = "snapshot-undo"
  undoBtn.dataset.runId = info.runId
  undoBtn.textContent = "↺ Отменить откат"
  undoBtn.style.display = "none"
  undoBtn.addEventListener("click", () => {
    if (!window.confirm("Вернуть изменения запроса обратно?")) return
    undoBtn.disabled = true
    vscode.postMessage({ type: "undoRevertSnapshot", runId: info.runId })
  })

  const selectBtn = document.createElement("button")
  selectBtn.type = "button"
  selectBtn.className = "snapshot-select"
  selectBtn.dataset.runId = info.runId
  selectBtn.textContent = "Выбрать…"
  selectBtn.title = "Посмотреть изменения и откатить выбранные файлы"
  selectBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "openRequestDiff", runId: info.runId })
  })

  row.appendChild(btn)
  row.appendChild(undoBtn)
  row.appendChild(selectBtn)
  wrapper.appendChild(row)
  messages.scrollTop = messages.scrollHeight
}

/** Показать всплывающее уведомление (toast) в чате. */
function showToast(text: string, success: boolean): void {
  const toast = document.createElement("div")
  toast.className = `nt-toast${success ? " ok" : " err"}`
  toast.textContent = text
  document.body.appendChild(toast)
  window.setTimeout(() => {
    toast.classList.add("hide")
    window.setTimeout(() => toast.remove(), 300)
  }, 4000)
}

// ── Скрытие / показ пустого состояния ─────────────────

function hideEmpty(): void {
  if (emptyState) emptyState.style.display = "none"
  if (sessionsSection) sessionsSection.style.display = "none"
  appendStreaming()
}

function showEmpty(): void {
  if (emptyState) emptyState.style.display = "flex"
  if (sessionsSection) sessionsSection.style.display = "block"
}

// ── Время ─────────────────────────────────────────────

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

// ── Рендер сессий ─────────────────────────────────────

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
