const vscode = acquireVsCodeApi()

const form = document.getElementById("chat-form") as HTMLFormElement
const input = document.getElementById("input") as HTMLInputElement
const messages = document.getElementById("messages") as HTMLDivElement
const sessionBar = document.getElementById("session-bar") as HTMLDivElement
const btn = form.querySelector("button") as HTMLButtonElement

let currentEl: HTMLElement | null = null
let sessions: Array<{ id: string; title: string; pinned: boolean; updatedAt: number; messageCount: number; active: boolean }> = []

form.addEventListener("submit", (e) => {
  e.preventDefault()
  const text = input.value.trim()
  if (!text) return
  input.value = ""
  btn.disabled = true
  vscode.postMessage({ type: "sendMessage", content: text })
})

window.addEventListener("message", (event) => {
  const data = event.data

  switch (data.type) {
    case "messageConfirmed":
      append("user", data.content)
      currentEl = append("assistant", "")
      break

    case "streamChunk":
      if (currentEl) currentEl.textContent += data.text
      messages.scrollTop = messages.scrollHeight
      break

    case "streamDone":
      btn.disabled = false
      currentEl = null
      break

    case "streamError":
      if (currentEl) currentEl.remove()
      append("error", data.error)
      btn.disabled = false
      currentEl = null
      break

    case "newChat":
      while (messages.firstChild) messages.removeChild(messages.firstChild)
      currentEl = null
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
      renderSessionBar()
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

function append(role: string, text: string): HTMLElement {
  const el = document.createElement("div")
  el.className = `msg ${role}`
  el.textContent = text
  messages.appendChild(el)
  messages.scrollTop = messages.scrollHeight
  return el
}

function renderSessionBar(): void {
  sessionBar.innerHTML = ""
  if (sessions.length === 0) return

  const active = sessions.find((s) => s.active)
  if (active) {
    const badge = document.createElement("span")
    badge.className = "session-badge"
    badge.textContent = active.title
    const pinBtn = document.createElement("span")
    pinBtn.className = `pin-btn ${active.pinned ? "pinned" : ""}`
    pinBtn.textContent = active.pinned ? "📌" : "📍"
    pinBtn.title = active.pinned ? "Unpin" : "Pin"
    pinBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "pinSession", sessionId: active.id })
    })
    badge.appendChild(pinBtn)
    badge.addEventListener("click", () => {
      const newTitle = prompt("Rename session:", active.title)
      if (newTitle && newTitle !== active.title) {
        vscode.postMessage({ type: "renameSession", sessionId: active.id, title: newTitle })
      }
    })
    sessionBar.appendChild(badge)

    const delBtn = document.createElement("span")
    delBtn.className = "del-btn"
    delBtn.textContent = "×"
    delBtn.title = "Delete session"
    delBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "deleteSession", sessionId: active.id })
    })
    sessionBar.appendChild(delBtn)
  }
}

function handlePermissionRequest(data: { toolName: string; description: string }): void {
  const allow = confirm(`Allow ${data.toolName}?\n${data.description}\n\nOK = Allow, Cancel = Deny`)
  vscode.postMessage({ type: "permissionResponse", toolName: data.toolName, allowed: allow, always: false })
}
