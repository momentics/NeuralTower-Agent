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
import type { ICodebaseChunker } from "../../repo/CodebaseChunker"
import type { ICodebaseSearch } from "../../repo/CodebaseSearch"
import type { IEmbeddingProvider } from "../../backend/IEmbeddingProvider"
import { createDomainLogger } from "../../core/logger"
import { errorMessage } from "../../core/errors"

const log = createDomainLogger("CodebaseIndexer")

const FILE_EVENT_DEBOUNCE_MS = 300

/**
 * Состояние индексации.
 */
export type IndexingState = "idle" | "indexing" | "error"

/**
 * Интерфейс сервиса индексации.
 */
export interface ICodebaseIndexer {
  start(workspaceUri: vscode.Uri): Promise<void>
  reindex(workspacePath: string, signal?: AbortSignal): Promise<void>
  getState(): IndexingState
  stats(): { vectorChunks: number; ftsChunks: number; embeddingAvailable: boolean }
  dispose(): void
  onDidChangeState: vscode.Event<IndexingState>
}

/**
 * Сервис инкрементальной индексации.
 */
export class CodebaseIndexer implements ICodebaseIndexer {
  private state: IndexingState = "idle"
  private disposables: vscode.Disposable[] = []
  private isDisposed = false
  private readonly _onDidChangeState = new vscode.EventEmitter<IndexingState>()
  readonly onDidChangeState = this._onDidChangeState.event

  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private pendingPaths: string[] = []

  constructor(
    private readonly fileIndex: IFileIndex,
    private readonly chunker: ICodebaseChunker,
    private readonly search: ICodebaseSearch,
    private readonly embeddingProvider: IEmbeddingProvider | null
  ) {}

  /**
   * Начать индексацию и подписаться на события VS Code.
   */
  async start(workspaceUri: vscode.Uri): Promise<void> {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (this.isDisposed) return
        this.scheduleFileChange(doc.uri.fsPath)
      }),

      vscode.workspace.onDidDeleteFiles(async (e) => {
        if (this.isDisposed) return
        for (const file of e.files) {
          this.scheduleFileDelete(file.fsPath)
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
  async reindex(workspacePath: string, signal?: AbortSignal): Promise<void> {
    await this.fullIndex(workspacePath, signal)
  }

  /**
   * Полная индексация репозитория.
   */
  async fullIndex(workspacePath: string, signal?: AbortSignal): Promise<void> {
    if (this.state === "indexing") return
    if (signal?.aborted) return

    this.setState("indexing")

    try {
      // Очистить старые индексы
      await this.search.clear()

      // Построить файловый индекс
      await this.fileIndex.build(workspacePath, undefined, signal)

      // Разбить все файлы на фрагменты
      const result = await this.chunker.chunkAll(signal)

      // Индексировать фрагменты
      await this.search.indexChunks(result.chunks, signal)

      this.setState("idle")
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Индексация кодовой базы не выполнена: ${msg}`)
      this.setState("error")
    }
  }

  /**
   * Запланировать обработку изменения файла с дебаунсом.
   */
  private scheduleFileChange(filePath: string): void {
    this.pendingPaths.push(filePath)
    if (this.debounceTimer) return
    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null
      const paths = this.pendingPaths.splice(0)
      for (const p of paths) {
        if (this.isDisposed) return
        await this.onFileChanged(p)
      }
    }, FILE_EVENT_DEBOUNCE_MS)
  }

  /**
   * Запланировать обработку удаления файла с дебаунсом.
   */
  private scheduleFileDelete(filePath: string): void {
    this.pendingPaths.push(`__DELETE__${filePath}`)
    if (this.debounceTimer) return
    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null
      const paths = this.pendingPaths.splice(0)
      for (const raw of paths) {
        if (this.isDisposed) return
        if (raw.startsWith("__DELETE__")) {
          await this.onFileDeleted(raw.slice(10))
        } else {
          await this.onFileChanged(raw)
        }
      }
    }, FILE_EVENT_DEBOUNCE_MS)
  }

  /**
   * Обработка изменения файла (сохранение).
   */
  private async onFileChanged(filePath: string): Promise<void> {
    if (this.isDisposed || this.state === "indexing") return

    try {
      await this.search.deleteByFile(filePath)
      const chunks = await this.chunker.chunkFile(filePath)
      if (chunks.length > 0) {
        await this.search.indexChunks(chunks)
      }
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Ошибка при индексации файла ${filePath}: ${msg}`)
    }
  }

  /**
   * Обработка удаления файла.
   */
  private async onFileDeleted(filePath: string): Promise<void> {
    if (this.isDisposed) return
    try {
      await this.search.deleteByFile(filePath)
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Ошибка при удалении индекса файла ${filePath}: ${msg}`)
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
  stats(): { vectorChunks: number; ftsChunks: number; embeddingAvailable: boolean } {
    return this.search.stats()
  }

  /**
   * Остановить индексацию и освободить ресурсы.
   */
  dispose(): void {
    this.isDisposed = true
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.pendingPaths = []
    this._onDidChangeState.dispose()
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables = []
  }
}
