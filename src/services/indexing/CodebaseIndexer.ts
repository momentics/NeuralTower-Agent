/**
 * Сервис инкрементальной индексации репозитория.
 *
 * Следит за изменениями файлов в VS Code и обновляет
 * индексы (векторное хранилище и FTS) при сохранении,
 * удалении или создании файлов.
 *
 * При открытии рабочей области выполняется полная
 * индексация. Далее — только инкрементальные обновления.
 */

import * as vscode from "vscode"
import type { IFileIndex } from "../../repo/FileIndex"
import type { CodebaseChunker } from "../../repo/CodebaseChunker"
import type { CodebaseSearch } from "../../repo/CodebaseSearch"
import type { IEmbeddingProvider } from "../../backend/IEmbeddingProvider"

/**
 * Состояние индексации.
 */
export type IndexingState = "idle" | "indexing" | "error"

/**
 * Сервис инкрементальной индексации.
 */
export class CodebaseIndexer {
  private state: IndexingState = "idle"
  private disposables: vscode.Disposable[] = []
  private isDisposed = false
  private readonly _onDidChangeState = new vscode.EventEmitter<IndexingState>()
  readonly onDidChangeState = this._onDidChangeState.event

  constructor(
    private readonly fileIndex: IFileIndex,
    private readonly chunker: CodebaseChunker,
    private readonly search: CodebaseSearch,
    private readonly embeddingProvider: IEmbeddingProvider | null
  ) {}

  /**
   * Начать индексацию и подписаться на события VS Code.
   */
  async start(workspaceUri: vscode.Uri): Promise<void> {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (this.isDisposed) return
        await this.onFileChanged(doc.uri.fsPath)
      }),

      vscode.workspace.onDidDeleteFiles(async (e) => {
        if (this.isDisposed) return
        for (const file of e.files) {
          await this.onFileDeleted(file.fsPath)
        }
      }),
      vscode.workspace.onDidCreateFiles(async (e) => {
        if (this.isDisposed) return
        for (const file of e.files) {
          // Не индексировать сразу — подождать сохранения
        }
      })
    )

    await this.fullIndex(workspaceUri.fsPath)
  }

  private setState(newState: IndexingState): void {
    if (this.state !== newState) {
      this.state = newState
      this._onDidChangeState.fire(newState)
    }
  }

  /**
   * Запустить полную индексацию (публичный метод для команды).
   */
  async reindex(workspacePath: string): Promise<void> {
    await this.fullIndex(workspacePath)
  }

  /**
   * Полная индексация репозитория.
   */
  async fullIndex(workspacePath: string): Promise<void> {
    if (this.state === "indexing") return

    this.setState("indexing")

    try {
      // Очистить старые индексы
      await this.search.clear()

      // Построить файловый индекс
      await this.fileIndex.build(workspacePath)

      // Разбить все файлы на фрагменты
      const result = await this.chunker.chunkAll()

      // Индексировать фрагменты
      await this.search.indexChunks(result.chunks)

      this.setState("idle")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Индексация кодовой базы не выполнена: ${msg}`)
      this.setState("error")
    }
  }

  /**
   * Обработка изменения файла (сохранение).
   */
  private async onFileChanged(filePath: string): Promise<void> {
    if (this.state === "indexing") return

    try {
      await this.search.deleteByFile(filePath)
      const chunks = await this.chunker.chunkFile(filePath)
      if (chunks.length > 0) {
        await this.search.indexChunks(chunks)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Ошибка при индексации файла ${filePath}: ${msg}`)
    }
  }

  /**
   * Обработка удаления файла.
   */
  private async onFileDeleted(filePath: string): Promise<void> {
    try {
      await this.search.deleteByFile(filePath)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Ошибка при удалении индекса файла ${filePath}: ${msg}`)
    }
  }

  /**
   * Текущее состояние индексации.
   */
  getState(): IndexingState {
    return this.state
  }

  /**
   * Получить статистику индексации.
   */
  getStats() {
    return this.search.stats()
  }

  /**
   * Остановить индексацию и освободить ресурсы.
   */
  dispose(): void {
    this.isDisposed = true
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables = []
  }
}
