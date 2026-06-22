import * as vscode from "vscode"
import type { GitDiffOutcome } from "../services/git/GitService"
import { buildWebviewHtml } from "../shared/WebviewBuilder"

/**
 * Интерфейс просмотрщика diff.
 */
export interface IDiffViewerProvider {
  openPanel(diff?: GitDiffOutcome): void
  close(): void
  dispose(): void
}

export class DiffViewerProvider implements IDiffViewerProvider, vscode.Disposable {
  public static readonly viewType = "neuralTowerAgent.diffViewer"
  public static readonly title = "Изменения агента"

  private panel: vscode.WebviewPanel | undefined
  private disposables: vscode.Disposable[] = []

  constructor(private readonly extUri: vscode.Uri) {}

  openPanel(diff?: GitDiffOutcome): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two)
      if (diff) this.updateDiff(diff)
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

    this.panel.onDidDispose(() => {
      for (const d of this.disposables) d.dispose()
      this.disposables = []
      this.panel = undefined
    }, null, this.disposables)

    if (diff) this.updateDiff(diff)
  }

  close(): void {
    this.panel?.dispose()
  }

  private updateDiff(diff: GitDiffOutcome): void {
    if (!this.panel) return
    if (!diff.ok) {
      this.panel.webview.postMessage({
        type: "diffUpdate",
        diff: {
          changed: [`Ошибка: ${diff.error}`],
          additions: 0,
          deletions: 0,
        },
      })
      return
    }
    this.panel.webview.postMessage({
      type: "diffUpdate",
      diff: {
        changed: diff.changed,
        additions: diff.additions,
        deletions: diff.deletions,
      },
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
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); }
    h2 { margin-bottom: 12px; font-size: 14px; }
    .summary { display: flex; gap: 16px; margin-bottom: 16px; }
    .stat { padding: 8px 12px; border-radius: 4px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-input-border); }
    .stat .label { font-size: 11px; opacity: 0.7; }
    .stat .value { font-size: 20px; font-weight: bold; }
    .additions .value { color: #6a9955; }
    .deletions .value { color: #f85149; }
    .files .value { color: #569cd6; }
    .file-list { list-style: none; max-height: 400px; overflow-y: auto; }
    .file-list li { padding: 4px 8px; font-size: 12px; border-bottom: 1px solid var(--vscode-input-border); cursor: default; }
    .file-list li:hover { background: var(--vscode-list-hoverBackground); }
    .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 20px 0; }`,
      inlineJs: `
    const countEl = document.getElementById('count')
    const addsEl = document.getElementById('adds')
    const delsEl = document.getElementById('dels')
    const fileList = document.getElementById('fileList')
    const empty = document.getElementById('empty')
    empty.style.display = 'block'
    window.addEventListener('message', (event) => {
      const msg = event.data
      if (msg.type === 'diffUpdate') {
        const { changed, additions, deletions } = msg.diff
        countEl.textContent = changed.length
        addsEl.textContent = additions
        delsEl.textContent = deletions
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
    })`,
      body: `
  <h2>Изменения файлов</h2>
  <div class="summary">
    <div class="stat files"><div class="label">Файлов</div><div class="value" id="count">0</div></div>
    <div class="stat additions"><div class="label">Добавлено строк</div><div class="value" id="adds">0</div></div>
    <div class="stat deletions"><div class="label">Удалено строк</div><div class="value" id="dels">0</div></div>
  </div>
  <ul class="file-list" id="fileList"></ul>
  <div class="empty" id="empty">Нет изменений</div>`,
    })
  }
}
