/**
 * Сервис инкрементальной индексации репозитория.
 *
 * Строит граф кода через ExtractionOrchestrator (tree-sitter → SQLite/FTS5)
 * и следит за изменениями файлов в VS Code: при сохранении или удалении
 * файла обновляет граф и векторное хранилище.
 *
 * При открытии рабочей области выполняется полная
 * индексация. Далее — только инкрементальные обновления.
 */

import * as path from "path"
import * as vscode from "vscode"
import type { IFileIndex } from "../../repo/FileIndex"
import type { ICodebaseSearch } from "../../repo/CodebaseSearch"
import type { IEmbeddingProvider } from "../../backend/IEmbeddingProvider"
import type { IPlugin } from "../../shared/Types"
import type { ExtractionOrchestrator } from "../../repo/extraction/Orchestrator"
import type { NtGraphDb } from "../../repo/ntgraph"
import type { INode, NodeKind } from "../../repo/ntgraph/Types"
import type { ICodeChunk, ChunkNodeKind } from "../../repo/ChunkTypes"
import { createDomainLogger } from "../../core/Logger"
import { errorMessage } from "../../core/Errors"
import { INDEX_FILE_EVENT_DEBOUNCE_MS } from "../../core/Config"

const log = createDomainLogger("CodebaseIndexer")

/** Виды узлов графа, индексируемых в векторное хранилище (семантический поиск). */
const VECTOR_NODE_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  "function", "method", "class", "interface", "type_alias", "struct",
  "enum", "constant", "variable", "route", "component", "trait",
  "protocol", "module", "namespace",
])

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
export class CodebaseIndexer implements IPlugin, ICodebaseIndexer {
  name = "codebase-indexer"
  private state: IndexingState = "idle"
  private disposables: vscode.Disposable[] = []
  private isDisposed = false
  private readonly _onDidChangeState = new vscode.EventEmitter<IndexingState>()
  readonly onDidChangeState = this._onDidChangeState.event

  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private pendingOps: Array<{ type: "change"; path: string } | { type: "delete"; path: string }> = []
  private pendingPaths = new Map<string, "change" | "delete">()
  private rootDir: string | null = null

  constructor(
    private readonly fileIndex: IFileIndex,
    private readonly search: ICodebaseSearch,
    private readonly embeddingProvider: IEmbeddingProvider | null,
    private readonly orchestrator: ExtractionOrchestrator | null = null,
    private readonly graphDb: NtGraphDb | null = null
  ) {}

  /** Инициализация не требуется — подписка на события происходит при start(). */
  async init(): Promise<void> {}

  /**
   * Начать индексацию и подписаться на события VS Code.
   */
  async start(workspaceUri: vscode.Uri): Promise<void> {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (this.isDisposed) return
        this.scheduleOp("change", doc.uri.fsPath)
      }),

      vscode.workspace.onDidDeleteFiles((e) => {
        if (this.isDisposed) return
        for (const file of e.files) {
          this.scheduleOp("delete", file.fsPath)
        }
      }),
      vscode.workspace.onDidCreateFiles((e) => {
        if (this.isDisposed) return
        for (const file of e.files) {
          // Не индексировать сразу — подождать сохранения
        }
      })
    )

    // Полная индексация графа кода при старте
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
   *
   * Очищает индексы, строит файловый индекс, затем выполняет
   * AST-экстракцию (tree-sitter) в графовую БД с разрешением ссылок
   * и наполняет векторное хранилище узлами графа.
   */
  async fullIndex(workspacePath: string, signal?: AbortSignal): Promise<void> {
    if (this.state === "indexing") return
    if (signal?.aborted) return

    this.setState("indexing")
    this.rootDir = workspacePath

    try {
      // Очистить старые индексы (графовая БД + векторное хранилище)
      await this.search.clear()

      // Построить файловый индекс
      await this.fileIndex.build(workspacePath, undefined, signal)

      // AST-экстракция и разрешение ссылок (tree-sitter → SQLite)
      if (this.orchestrator) {
        await this.orchestrator.indexAndResolve({ signal })

        // Наполнить векторное хранилище узлами графа (семантический поиск)
        await this.indexVectorFromGraph(signal)
      }

      this.setState("idle")
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Индексация кодовой базы не выполнена: ${msg}`)
      this.setState("error")
    }
  }

  /**
   * Запланировать операцию с дебаунсом.
   */
  private scheduleOp(type: "change" | "delete", filePath: string): void {
    const existing = this.pendingPaths.get(filePath)
    if (existing === "delete" && type === "change") return
    this.pendingPaths.set(filePath, type)
    if (existing === type) return
    this.pendingOps.push({ type, path: filePath })
    if (this.debounceTimer) return
    this.debounceTimer = setTimeout(async () => {
      try {
        this.debounceTimer = null
        const ops = this.pendingOps.splice(0)
        this.pendingPaths.clear()
        for (const op of ops) {
          if (this.isDisposed) return
          if (op.type === "change") {
            await this.onFileChanged(op.path)
          } else {
            await this.onFileDeleted(op.path)
          }
        }
      } catch (err: unknown) {
        const msg = errorMessage(err)
        log.error(`Ошибка при обработке событий файлов: ${msg}`)
      }
    }, INDEX_FILE_EVENT_DEBOUNCE_MS)
  }

  /**
   * Обработка изменения файла (сохранение).
   *
   * Пересобирает узлы и рёбра файла в графовой БД и обновляет
   * векторное хранилище для этого файла.
   */
  private async onFileChanged(filePath: string): Promise<void> {
    if (this.isDisposed || this.state === "indexing") return

    const relPath = this.toRelativePath(filePath)
    if (relPath === null) return

    try {
      await this.search.deleteByFile(relPath)
      if (this.orchestrator) {
        await this.orchestrator.indexFile(relPath)
        await this.indexVectorForFile(relPath)
      }
      this.search.compactIfNeeded()
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Ошибка при индексации файла ${filePath}: ${msg}`)
    }
  }

  /**
   * Обработка удаления файла.
   *
   * Удаляет узлы, рёбра и запись файла из графовой БД
   * и фрагменты из векторного хранилища.
   */
  private async onFileDeleted(filePath: string): Promise<void> {
    if (this.isDisposed) return

    const relPath = this.toRelativePath(filePath)
    if (relPath === null) return

    try {
      if (this.graphDb) {
        await this.graphDb.deleteFile(relPath)
      }
      await this.search.deleteByFile(relPath)
      this.search.compactIfNeeded()
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Ошибка при удалении индекса файла ${filePath}: ${msg}`)
    }
  }

  /**
   * Абсолютный путь → относительный от корня рабочей области
   * (с прямыми слэшами, как хранятся пути в графовой БД).
   * Возвращает null, если файл вне рабочей области.
   */
  private toRelativePath(absPath: string): string | null {
    if (!this.rootDir) return null
    const rel = path.relative(this.rootDir, absPath)
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null
    return rel.split(path.sep).join("/")
  }

  /**
   * Наполнить векторное хранилище узлами всего графа.
   */
  private async indexVectorFromGraph(signal?: AbortSignal): Promise<void> {
    if (!this.graphDb || signal?.aborted) return
    const chunks = this.graphDb
      .getAllNodes()
      .filter((n) => VECTOR_NODE_KINDS.has(n.kind))
      .map((n) => this.nodeToChunk(n))
    await this.search.indexVectorChunks(chunks, signal)
  }

  /**
   * Наполнить векторное хранилище узлами одного файла.
   */
  private async indexVectorForFile(relPath: string): Promise<void> {
    if (!this.graphDb) return
    const chunks = this.graphDb
      .getNodesByFile(relPath)
      .filter((n) => VECTOR_NODE_KINDS.has(n.kind))
      .map((n) => this.nodeToChunk(n))
    await this.search.indexVectorChunks(chunks)
  }

  /**
   * Преобразование узла графа в фрагмент для векторного хранилища.
   */
  private nodeToChunk(node: INode): ICodeChunk {
    const content = node.signature ?? node.name
    return {
      id: node.id,
      filePath: node.filePath,
      content,
      startLine: node.startLine,
      endLine: node.endLine,
      nodeKind: this.mapNodeKind(node.kind),
      symbolName: node.name,
      language: node.language,
      signature: node.signature,
      docComment: node.docstring,
      charLength: content.length,
    }
  }

  /**
   * Преобразование NodeKind в ChunkNodeKind.
   */
  private mapNodeKind(kind: NodeKind): ChunkNodeKind {
    switch (kind) {
      case "class":
        return "class"
      case "function":
        return "function"
      case "method":
        return "method"
      case "interface":
        return "interface"
      case "type_alias":
        return "type"
      case "enum":
        return "enum"
      case "constant":
        return "const"
      default:
        return "block"
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
