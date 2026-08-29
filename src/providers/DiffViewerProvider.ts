import * as vscode from "vscode"
import type { GitDiffOutcome } from "../services/git/GitService"
import type { IFileDiff } from "../services/snapshot"
import { buildWebviewHtml } from "../shared/WebviewBuilder"

/**
 * Режимы просмотрщика diff: diff рабочей области
 * или предпросмотр изменений запроса (чекпоинт).
 */
export type DiffView =
  | { type: "workspace"; diff: GitDiffOutcome }
  | { type: "request"; runId: string; files: IFileDiff[] }

/**
 * Интерфейс просмотрщика diff.
 */
export interface IDiffViewerProvider {
  openPanel(view: DiffView): void
  /** Открыта ли панель. */
  isOpen(): boolean
  close(): void
  dispose(): void
  /** Колбэк «откатить выбранные файлы» (устанавливается ChatProvider). */
  setRevertSelectedHandler(handler: ((runId: string, files: string[]) => void) | null): void
}

export class DiffViewerProvider implements IDiffViewerProvider, vscode.Disposable {
  public static readonly viewType = "neuralTowerAgent.diffViewer"
  public static readonly title = "Изменения агента"

  private panel: vscode.WebviewPanel | undefined
  private disposables: vscode.Disposable[] = []
  private revertHandler: ((runId: string, files: string[]) => void) | null = null

  constructor(private readonly extUri: vscode.Uri) {}

  setRevertSelectedHandler(handler: ((runId: string, files: string[]) => void) | null): void {
    this.revertHandler = handler
  }

  openPanel(view: DiffView): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two)
      this.updateView(view)
      return
    }

    this.panel = vscode.window.createWebviewPanel(
      DiffViewerProvider.viewType,
      DiffViewerProvider.title,
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extUri],
      },
    )

    this.panel.webview.html = this.buildHtml()

    // Входящие сообщения webview: «откатить выбранные файлы»
    this.panel.webview.onDidReceiveMessage(
      (msg: { type?: string; runId?: string; files?: unknown }) => {
        if (msg?.type === "revertSelected" && this.revertHandler && typeof msg.runId === "string") {
          const files = Array.isArray(msg.files)
            ? msg.files.filter((f): f is string => typeof f === "string")
            : []
          this.revertHandler(msg.runId, files)
        }
      },
      null,
      this.disposables,
    )

    this.panel.onDidDispose(() => {
      for (const d of this.disposables) d.dispose()
      this.disposables = []
      this.panel = undefined
    }, null, this.disposables)

    this.updateView(view)
  }

  isOpen(): boolean {
    return this.panel !== undefined
  }

  close(): void {
    this.panel?.dispose()
  }

  private updateView(view: DiffView): void {
    if (!this.panel) return
    if (view.type === "workspace") {
      if (!view.diff.ok) {
        this.panel.webview.postMessage({
          type: "diffUpdate",
          diff: {
            changed: [`Ошибка: ${view.diff.error}`],
            additions: 0,
            deletions: 0,
          },
        })
        return
      }
      this.panel.webview.postMessage({
        type: "diffUpdate",
        diff: {
          changed: view.diff.changed,
          additions: view.diff.additions,
          deletions: view.diff.deletions,
        },
      })
      return
    }
    this.panel.webview.postMessage({
      type: "requestDiffUpdate",
      runId: view.runId,
      files: view.files,
    })
  }

  dispose(): void {
    this.close()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }

  private buildHtml(): string {
    return buildWebviewHtml(this.panel!.webview, this.extUri, {
      inlineCss: `
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }

    :root {
      --bg-primary: #1e1e2e;
      --bg-secondary: #181825;
      --bg-tertiary: #11111b;
      --bg-surface: #313244;
      --bg-hover: #45475a;
      --text-primary: #cdd6f4;
      --text-secondary: #a6adc8;
      --text-muted: #6c7086;
      --accent: #89b4fa;
      --green: #a6e3a1;
      --red: #f38ba8;
      --border: #45475a;
      --font: var(--vscode-font-family, 'Inter', sans-serif);
      --mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
    }

    body {
      font-family: var(--font);
      color: var(--text-primary);
      background: var(--bg-primary);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .diff-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-secondary);
      flex-shrink: 0;
    }

    .diff-header-left {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .diff-title {
      font-size: 13px;
      font-weight: 600;
    }

    .diff-stats {
      display: flex;
      gap: 12px;
      margin-left: 16px;
    }

    .diff-stat {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-family: var(--mono);
    }

    .diff-stat.add { color: var(--green); }
    .diff-stat.del { color: var(--red); }

    .diff-actions {
      display: flex;
      gap: 4px;
    }

    .icon-btn {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      border-radius: 6px;
      cursor: pointer;
      color: var(--text-muted);
      transition: all 0.15s;
    }

    .icon-btn:hover {
      background: var(--bg-surface);
      color: var(--text-primary);
    }

    .icon-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .icon-btn svg {
      width: 16px;
      height: 16px;
    }

    .diff-body {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    .diff-file-list {
      width: 180px;
      border-right: 1px solid var(--border);
      overflow-y: auto;
      flex-shrink: 0;
      padding: 8px;
    }

    .diff-file {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      color: var(--text-secondary);
      transition: background 0.1s;
    }

    .diff-file:hover { background: var(--bg-surface); }
    .diff-file.active { background: var(--bg-surface); color: var(--text-primary); }

    .diff-file svg { width: 12px; height: 12px; flex-shrink: 0; }

    .diff-file-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-check { accent-color: var(--accent); cursor: pointer; flex-shrink: 0; }
    .diff-file .warn { color: var(--red); font-size: 11px; flex-shrink: 0; }

    .diff-content {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
      font-family: var(--mono);
      font-size: 11px;
      line-height: 1.6;
    }

    .diff-line {
      display: flex;
      padding: 0 12px;
    }

    .diff-line.added {
      background: rgba(166,227,161,0.08);
    }

    .diff-line.removed {
      background: rgba(243,139,168,0.08);
    }

    .diff-line-num {
      width: 40px;
      text-align: right;
      padding-right: 12px;
      color: var(--text-muted);
      user-select: none;
      flex-shrink: 0;
    }

    .diff-line.added .diff-line-num { color: var(--green); }
    .diff-line.removed .diff-line-num { color: var(--red); }

    .diff-line-sign {
      width: 16px;
      flex-shrink: 0;
    }

    .diff-line.added .diff-line-sign { color: var(--green); }
    .diff-line.removed .diff-line-sign { color: var(--red); }

    .diff-line-text {
      flex: 1;
      white-space: pre;
    }

    .diff-line.added .diff-line-text { color: var(--green); }
    .diff-line.removed .diff-line-text { color: var(--red); }
    .diff-line.diff-hunk .diff-line-text { color: var(--accent); }

    .empty {
      color: var(--text-muted);
      font-style: italic;
      padding: 20px 0;
      text-align: center;
    }

    .summary {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
    }

    .stat {
      padding: 8px 12px;
      border-radius: 4px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
    }

    .stat .label { font-size: 11px; color: var(--text-muted); }
    .stat .value { font-size: 20px; font-weight: bold; }
    .additions .value { color: var(--green); }
    .deletions .value { color: var(--red); }
    .files .value { color: var(--accent); }

    .file-list { list-style: none; max-height: 400px; overflow-y: auto; }
    .file-list li {
      padding: 4px 8px;
      font-size: 12px;
      border-bottom: 1px solid var(--border);
      cursor: default;
      color: var(--text-secondary);
    }
    .file-list li:hover { background: var(--bg-hover); }

    h2 {
      margin: 0 0 12px;
      font-size: 14px;
    }`,
      inlineJs: `
    const vscode = acquireVsCodeApi()

    const statAdds = document.getElementById('stat-adds')
    const statDels = document.getElementById('stat-dels')
    const statFiles = document.getElementById('stat-files')
    const fileList = document.getElementById('fileList')
    const empty = document.getElementById('empty')
    empty.style.display = 'block'

    const workspaceBody = document.getElementById('diffWorkspace')
    const requestBody = document.getElementById('diffRequest')
    const requestFileList = document.getElementById('requestFileList')
    const requestDiffContent = document.getElementById('requestDiffContent')
    const revertSelectedBtn = document.getElementById('btn-revert-selected')

    let requestRunId = null
    let requestFiles = []

    function pluralize(n) {
      if (n % 10 === 1 && n % 100 !== 11) return ''
      if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'а'
      return 'ов'
    }

    // Переключение режимов: workspace / предпросмотр запроса
    function showWorkspace() {
      if (workspaceBody) workspaceBody.style.display = ''
      if (requestBody) requestBody.style.display = 'none'
      if (revertSelectedBtn) revertSelectedBtn.style.display = 'none'
    }

    function showRequest() {
      if (workspaceBody) workspaceBody.style.display = 'none'
      if (requestBody) requestBody.style.display = ''
      if (revertSelectedBtn) {
        revertSelectedBtn.style.display = ''
        revertSelectedBtn.disabled = false
      }
    }

    // Построчный рендер unified diff (существующие CSS-классы .diff-line*)
    function renderRequestDiff(file) {
      requestDiffContent.innerHTML = ''
      if (!file || !file.diff) {
        const div = document.createElement('div')
        div.className = 'empty'
        div.textContent = file ? 'Нет diff' : 'Выберите файл'
        requestDiffContent.appendChild(div)
        return
      }
      file.diff.split('\\n').forEach((line) => {
        const row = document.createElement('div')
        let cls = 'diff-line'
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
          cls += ' diff-hunk'
        } else if (line.startsWith('+')) {
          cls += ' added'
        } else if (line.startsWith('-')) {
          cls += ' removed'
        }
        row.className = cls
        const num = document.createElement('span')
        num.className = 'diff-line-num'
        const sign = document.createElement('span')
        sign.className = 'diff-line-sign'
        sign.textContent = line.slice(0, 1)
        const text = document.createElement('span')
        text.className = 'diff-line-text'
        text.textContent = line.slice(1)
        row.appendChild(num)
        row.appendChild(sign)
        row.appendChild(text)
        requestDiffContent.appendChild(row)
      })
    }

    // Список файлов запроса: чекбокс + имя + ⚠ для правок пользователя
    function renderRequestFiles() {
      requestFileList.innerHTML = ''
      requestFiles.forEach((file) => {
        const row = document.createElement('div')
        row.className = 'diff-file'

        const check = document.createElement('input')
        check.type = 'checkbox'
        check.className = 'file-check'
        check.checked = !file.userTouched
        check.addEventListener('click', (e) => e.stopPropagation())

        const name = document.createElement('span')
        name.className = 'diff-file-name'
        name.textContent = file.path.split('/').pop()
        name.title = file.path

        row.appendChild(check)
        row.appendChild(name)

        if (file.userTouched) {
          const warn = document.createElement('span')
          warn.className = 'warn'
          warn.textContent = '⚠'
          warn.title = 'Файл изменялся после запроса'
          row.appendChild(warn)
        }

        row.addEventListener('click', () => {
          requestFileList.querySelectorAll('.diff-file').forEach((el) => el.classList.remove('active'))
          row.classList.add('active')
          renderRequestDiff(file)
        })
        requestFileList.appendChild(row)
      })
    }

    // «Откатить выбранные файлы»: собрать отмеченные пути и отправить extension
    revertSelectedBtn.addEventListener('click', () => {
      const files = []
      requestFileList.querySelectorAll('.diff-file').forEach((row, i) => {
        const check = row.querySelector('input.file-check')
        if (check && check.checked && requestFiles[i]) files.push(requestFiles[i].path)
      })
      if (files.length === 0) return
      vscode.postMessage({ type: 'revertSelected', runId: requestRunId, files })
      revertSelectedBtn.disabled = true
    })

    window.addEventListener('message', (event) => {
      const msg = event.data
      if (msg.type === 'diffUpdate') {
        showWorkspace()
        requestRunId = null
        requestFiles = []
        const { changed, additions, deletions } = msg.diff

        // Обновить статистику в хедере
        if (statAdds) statAdds.textContent = '+' + additions
        if (statDels) statDels.textContent = '-' + deletions
        if (statFiles) statFiles.textContent = changed.length + ' файл' + pluralize(changed.length)

        // Список файлов слева
        const filePanel = document.getElementById('diffFileList')
        if (filePanel) {
          filePanel.innerHTML = ''
          changed.forEach((f, i) => {
            const div = document.createElement('div')
            div.className = 'diff-file' + (i === 0 ? ' active' : '')
            div.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="' + (i === 0 ? 'var(--accent)' : 'var(--text-muted)') + '" stroke-width="2"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg> ' + f
            div.addEventListener('click', () => {
              filePanel.querySelectorAll('.diff-file').forEach((el) => {
                el.classList.remove('active')
                el.querySelector('svg').setAttribute('stroke', 'var(--text-muted)')
              })
              div.classList.add('active')
              div.querySelector('svg').setAttribute('stroke', 'var(--accent)')
            })
            filePanel.appendChild(div)
          })
        }

        // Список файлов справа (совместимость)
        fileList.innerHTML = ''
        if (changed.length === 0) {
          empty.style.display = 'block'
        } else {
          empty.style.display = 'none'
          changed.forEach((f) => {
            const li = document.createElement('li')
            li.textContent = f
            fileList.appendChild(li)
          })
        }
      }
      if (msg.type === 'requestDiffUpdate') {
        requestRunId = msg.runId
        requestFiles = Array.isArray(msg.files) ? msg.files : []
        showRequest()
        // В режиме предпросмотра статистика по файлам запроса
        if (statAdds) statAdds.textContent = '+0'
        if (statDels) statDels.textContent = '-0'
        if (statFiles) statFiles.textContent = requestFiles.length + ' файл' + pluralize(requestFiles.length) + ' в запросе'
        renderRequestFiles()
        renderRequestDiff(null)
      }
    })`,
      body: `
  <div class="diff-header">
    <div class="diff-header-left">
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" style="width:16px;height:16px"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
      <span class="diff-title">Изменения агента</span>
      <div class="diff-stats">
        <span class="diff-stat add" id="stat-adds">+0</span>
        <span class="diff-stat del" id="stat-dels">-0</span>
        <span style="font-size:11px;color:var(--text-muted)" id="stat-files">0 файлов</span>
      </div>
    </div>
    <div class="diff-actions">
      <button class="icon-btn" id="btn-revert-selected" title="Откатить выбранные файлы" style="display:none">↩</button>
      <button class="icon-btn" title="Принять все">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      <button class="icon-btn" title="Отклонить все">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>

  <div class="diff-body" id="diffWorkspace">
    <div class="diff-file-list" id="diffFileList"></div>
    <div class="diff-content">
      <ul class="file-list" id="fileList"></ul>
      <div class="empty" id="empty">Нет изменений</div>
    </div>
  </div>

  <div class="diff-body" id="diffRequest" style="display:none">
    <div class="diff-file-list" id="requestFileList"></div>
    <div class="diff-content" id="requestDiffContent"><div class="empty">Выберите файл</div></div>
  </div>`,
    })
  }
}
