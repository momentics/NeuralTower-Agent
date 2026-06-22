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
import type { Plugin } from "../../shared/Types"
import { createDomainLogger } from "../../core/Logger"
import { errorMessage } from "../../core/Errors"

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
  onDidChangeState: vscode.Event<IndexingState>
}

/**
 * Сервис инкрементальной индексации.
 */
export class CodebaseIndexer implements Plugin, ICodebaseIndexer {
  name = "codebase-indexer"
  private state: IndexingState = "idle"
  private disposables: vscode.Disposable[] = []
  private isDisposed = false
  private readonly _onDidChangeState = new vscode.EventEmitter<IndexingState>()
  readonly onDidChangeState = this._onDidChangeState.event

  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private pendingOps: Array<{ type: "change"; path: string } | { type: "delete"; path: string }> = []

  constructor(
    private readonly fileIndex: IFileIndex,
    private readonly chunker: ICodebaseChunker,
    private readonly search: ICodebaseSearch,
    private readonly embeddingProvider: IEmbeddingProvider | null
  ) {}

  /** Инициализация не требуется — подписка на события происходит при start(). */
  async init(): Promise<void> {}

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
    this.pendingOps.push({ type: "change", path: filePath })
    if (this.debounceTimer) return
    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null
      const ops = this.pendingOps.splice(0)
      for (const op of ops) {
        if (this.isDisposed) return
        if (op.type === "change") {
          await this.onFileChanged(op.path)
        } else {
          await this.onFileDeleted(op.path)
        }
      }
    }, FILE_EVENT_DEBOUNCE_MS)
  }

  /**
   * Запланировать обработку удаления файла с дебаунсом.
   */
  private scheduleFileDelete(filePath: string): void {
    this.pendingOps.push({ type: "delete", path: filePath })
    if (this.debounceTimer) return
    this.debounceTimer = setTimeout(async () => {
      this.debounceTimer = null
      const ops = this.pendingOps.splice(0)
      for (const op of ops) {
        if (this.isDisposed) return
        if (op.type === "change") {
          await this.onFileChanged(op.path)
        } else {
          await this.onFileDeleted(op.path)
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
    this.pendingOps = []
    this._onDidChangeState.dispose()
    for (const d of this.disposables) {
      d.dispose()
    }
    this.disposables = []
  }
}
