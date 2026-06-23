const vscode = acquireVsCodeApi()

const urlInput = document.getElementById("url") as HTMLInputElement
const modelSelect = document.getElementById("model") as HTMLSelectElement
const maxRetriesInput = document.getElementById("maxRetries") as HTMLInputElement
const timeoutMsInput = document.getElementById("timeoutMs") as HTMLInputElement
const autoApproveCheckbox = document.getElementById("autoApprove") as HTMLInputElement
const btnSave = document.getElementById("btn-save") as HTMLButtonElement
const btnTest = document.getElementById("btn-test") as HTMLButtonElement
const statusEl = document.getElementById("status") as HTMLParagraphElement

let cfg = { url: "", model: "", maxRetries: 3, timeoutMs: 60000, autoApprove: false }

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
      if (autoApproveCheckbox) autoApproveCheckbox.checked = data.config.autoApprove ?? false
      break
    case "settingsSaved":
      setStatus("Saved", true)
      break
    case "settingsTestResult":
      setStatus(data.message, data.success)
      break
  }
})

btnSave.addEventListener("click", () => {
  cfg.url = urlInput.value
  cfg.model = modelSelect.value
  vscode.postMessage({
    type: "settingsSave",
    url: urlInput.value,
    model: modelSelect.value,
    maxRetries: maxRetriesInput ? Number(maxRetriesInput.value) : 3,
    timeoutMs: timeoutMsInput ? Number(timeoutMsInput.value) : 60000,
    autoApprove: autoApproveCheckbox ? autoApproveCheckbox.checked : false,
  })
})

btnTest.addEventListener("click", () => {
  vscode.postMessage({ type: "settingsTest", url: urlInput.value })
})

function setStatus(msg: string, ok: boolean): void {
  statusEl.textContent = msg
  statusEl.className = ok ? "success" : "error"
}
