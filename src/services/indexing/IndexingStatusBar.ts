import * as vscode from "vscode"
import type { CodebaseIndexer, IndexingState } from "../indexing/CodebaseIndexer"
import type { Plugin } from "../../shared/types"

export class IndexingStatusBar implements Plugin {
  name = "indexing-status"
  version = "0.1.0"

  private statusBar: vscode.StatusBarItem
  private state: IndexingState = "idle"

  constructor(private readonly indexer: CodebaseIndexer) {
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      98,
    )
    this.statusBar.command = "neuralTowerAgent.reindex"
    this.statusBar.tooltip = "Индекс кодовой базы"

    this.indexer.onDidChangeState((s) => {
      this.state = s
      this.syncBar()
    })
  }

  async init(): Promise<void> {
    this.state = this.indexer.getState()
    this.syncBar()
  }

  dispose(): void {
    this.statusBar.dispose()
  }

  private syncBar(): void {
    const stats = this.indexer.getStats()

    if (this.state === "idle") {
      this.statusBar.text = `$(check) Индекс: ${stats.ftsChunks}`
      this.statusBar.color = new vscode.ThemeColor("testing.iconPassed")
      this.statusBar.tooltip = [
        "Индекс кодовой базы: готов",
        `FTS-чанков: ${stats.ftsChunks}`,
        `Векторных чанков: ${stats.vectorChunks}`,
        `Эмбеддинги: ${stats.embeddingAvailable ? "доступны" : "недоступны"}`,
        "Нажмите для повторной индексации",
      ].join("\n")
    } else if (this.state === "indexing") {
      this.statusBar.text = "$(loading~spin) Индексация..."
      this.statusBar.color = new vscode.ThemeColor("editorWarning.foreground")
      this.statusBar.tooltip = "Индексация кодовой базы..."
    } else {
      this.statusBar.text = "$(error) Индекс: ошибка"
      this.statusBar.color = new vscode.ThemeColor("testing.iconErrored")
      this.statusBar.tooltip = "Индекс кодовой базы: ошибка\nНажмите для повторной индексации"
    }
    this.statusBar.show()
  }
}
