const vscode = acquireVsCodeApi()

const form = document.getElementById("chat-form") as HTMLFormElement
const input = document.getElementById("input") as HTMLTextAreaElement
const messages = document.getElementById("messages") as HTMLDivElement
const emptyState = document.getElementById("empty-state") as HTMLDivElement
const tasksList = document.getElementById("tasks-list") as HTMLDivElement
const viewAll = document.getElementById("view-all") as HTMLDivElement
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement
const tasksSection = document.getElementById("tasks-section") as HTMLDivElement

let currentEl: HTMLElement | null = null
let sessions: Array<{ id: string; title: string; pinned: boolean; updatedAt: number; messageCount: number; active: boolean }> = []
let isStreaming = false

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
  input.style.height = Math.min(input.scrollHeight, 120) + "px"
})

stopBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "stopAgent" })
})

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
      break

    case "toolUse":
      const toolMsg = document.createElement("div")
      toolMsg.className = "msg tool"
      toolMsg.textContent = `[tool: ${data.toolName}]`
      messages.appendChild(toolMsg)
      messages.scrollTop = messages.scrollHeight
      break

    case "toolResult":
      const resMsg = document.createElement("div")
      resMsg.className = `msg tool-result ${data.success ? "success" : "fail"}`
      const truncated = data.output.length > 500 ? data.output.slice(0, 500) + "..." : data.output
      resMsg.textContent = `[result: ${data.toolName}] ${truncated}`
      messages.appendChild(resMsg)
      messages.scrollTop = messages.scrollHeight
      break

    case "sessionList":
      sessions = data.sessions
      renderTasks()
      break

    case "switchSession":
      vscode.postMessage({ type: "createSession" })
      break

    case "agentDone":
      break

    case "permissionRequest":
      handlePermissionRequest(data)
      break
  }
})

function setStreaming(streaming: boolean): void {
  isStreaming = streaming
  sendBtn.style.display = streaming ? "none" : "flex"
  stopBtn.style.display = streaming ? "flex" : "none"
  sendBtn.disabled = streaming
  input.disabled = streaming
}

function append(role: string, text: string): HTMLElement {
  const el = document.createElement("div")
  el.className = `msg ${role}`
  el.textContent = text
  messages.appendChild(el)
  messages.scrollTop = messages.scrollHeight
  return el
}

function hideEmpty(): void {
  if (emptyState) emptyState.style.display = "none"
  if (tasksSection) tasksSection.style.display = "none"
}

function showEmpty(): void {
  if (emptyState) emptyState.style.display = "flex"
  if (tasksSection) tasksSection.style.display = "block"
}

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

function renderTasks(): void {
  if (!tasksList || !viewAll) return

  tasksList.innerHTML = ""

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

  const shown = sorted.slice(0, 3)

  for (const s of shown) {
    const item = document.createElement("div")
    item.className = `task-item${s.active ? " active" : ""}`

    const title = document.createElement("span")
    title.className = "task-title"
    title.textContent = s.title
    title.title = s.title

    const time = document.createElement("span")
    time.className = "task-time"
    time.textContent = timeAgo(s.updatedAt)

    item.appendChild(title)
    item.appendChild(time)

    item.addEventListener("click", () => {
      if (!s.active) {
        vscode.postMessage({ type: "switchSession", sessionId: s.id })
      }
    })

    tasksList.appendChild(item)
  }

  if (sorted.length > 3) {
    viewAll.textContent = `View all (${sorted.length})`
    viewAll.style.display = "inline-block"
    viewAll.addEventListener("click", () => {
      vscode.postMessage({ type: "sessionList" })
    })
  } else {
    viewAll.style.display = "none"
  }
}

function handlePermissionRequest(data: { requestId: string; toolName: string; description: string }): void {
  const allow = confirm(`Allow ${data.toolName}?\n${data.description}\n\nOK = Allow, Cancel = Deny`)
  vscode.postMessage({ type: "permissionResponse", requestId: data.requestId, allowed: allow, always: false })
}
