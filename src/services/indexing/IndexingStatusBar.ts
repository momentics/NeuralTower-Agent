import * as vscode from "vscode"
import type { CodebaseIndexer, IndexingState } from "./CodebaseIndexer"
import type { Plugin } from "../../shared/types"
import { StatusBarIndicator } from "../../services/StatusBarIndicator"

export class IndexingStatusBar extends StatusBarIndicator implements Plugin {
  name = "indexing-status"

  private state: IndexingState = "idle"
  private stateDisposable: vscode.Disposable | null = null

  constructor(private readonly indexer: CodebaseIndexer) {
    super(
      vscode.StatusBarAlignment.Right,
      98,
      "neuralTowerAgent.reindex",
      "Индекс кодовой базы",
    )
    this.stateDisposable = this.indexer.onDidChangeState((s) => {
      this.state = s
      this.syncBar()
    })
  }

  async init(): Promise<void> {
    this.state = this.indexer.getState()
    this.syncBar()
  }

  override dispose(): void {
    this.stateDisposable?.dispose()
    this.stateDisposable = null
    super.dispose()
  }

  private syncBar(): void {
    const stats = this.indexer.stats()

    if (this.state === "idle") {
      this.setText(`$(check) Индекс: ${stats.ftsChunks}`)
      this.setColor(new vscode.ThemeColor("testing.iconPassed"))
      this.setTooltip([
        "Индекс кодовой базы: готов",
        `FTS-чанков: ${stats.ftsChunks}`,
        `Векторных чанков: ${stats.vectorChunks}`,
        `Эмбеддинги: ${stats.embeddingAvailable ? "доступны" : "недоступны"}`,
        "Нажмите для повторной индексации",
      ].join("\n"))
    } else if (this.state === "indexing") {
      this.setText("$(loading~spin) Индексация...")
      this.setColor(new vscode.ThemeColor("editorWarning.foreground"))
      this.setTooltip("Индексация кодовой базы...")
    } else {
      this.setText("$(error) Индекс: ошибка")
      this.setColor(new vscode.ThemeColor("testing.iconErrored"))
      this.setTooltip("Индекс кодовой базы: ошибка\nНажмите для повторной индексации")
    }
    this.show()
  }
}
