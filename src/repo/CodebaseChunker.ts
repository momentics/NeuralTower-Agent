/**
 * Оркестратор разбиения всего репозитория на фрагменты.
 *
 * Использует FileIndex для определения файлов, выбирает
 * подходящий чанкер для каждого языка, и собирает
 * все фрагменты для индексации.
 */

import * as fs from "fs/promises"
import * as path from "path"
import type { IFileIndex } from "./FileIndex"
import type {
  IChunkerConfig,
  ICodeChunk,
  ICodebaseChunkResult,
} from "./ChunkTypes"
import { errorMessage } from "../core/Errors"
import type { IChunker } from "./Chunker"
import { LineChunker, TypeScriptChunker, createDefaultChunkerConfig } from "./Chunker"
import { detectLanguageShort } from "../utils/LanguageDetector"
import { createDomainLogger } from "../core/Logger"

const log = createDomainLogger("CodebaseChunker")
export { createDefaultChunkerConfig } from "./Chunker"

/**
 * Интерфейс оркестратора разбиения репозитория.
 */
export interface ICodebaseChunker {
  chunkAll(signal?: AbortSignal): Promise<ICodebaseChunkResult>
  chunkFile(filePath: string, signal?: AbortSignal): Promise<ICodeChunk[]>
}

/**
 * Оркестратор разбиения репозитория.
 */
export class CodebaseChunker implements ICodebaseChunker {
  private readonly chunkers: Map<string, IChunker> = new Map()
  private readonly config: IChunkerConfig

  constructor(
    private readonly fileIndex: IFileIndex,
    chunkerConfig?: IChunkerConfig
  ) {
    this.config = chunkerConfig ?? createDefaultChunkerConfig()
    this.registerChunkers()
  }

  /**
   * Разбить все файлы репозитория на фрагменты.
   * Использует FileIndex для получения списка файлов.
   */
  async chunkAll(signal?: AbortSignal): Promise<ICodebaseChunkResult> {
    const chunks: ICodeChunk[] = []
    let filesProcessed = 0
    let filesSkipped = 0

    // Получить все файлы из индекса
    const entries = this.fileIndex.findByPattern("")

    for (const entry of entries) {
      if (signal?.aborted) break
      // Пропустить слишком большие файлы
      if (entry.size > this.config.maxFileSize) {
        filesSkipped++
        continue
      }

      try {
        const content = await fs.readFile(entry.path, "utf-8")
        const chunker = this.getChunkerForLanguage(entry.language)
        const result = chunker.chunk(entry.path, content)

        chunks.push(...result.chunks)
        filesProcessed++
      } catch (err: unknown) {
        const msg = errorMessage(err)
        log.error(`Не удалось прочитать файл ${entry.path}: ${msg}`)
        filesSkipped++
      }
    }

    return {
      chunks,
      filesProcessed,
      filesSkipped,
      totalChunks: chunks.length,
    }
  }

  /**
   * Разбить один файл на фрагменты.
   */
  async chunkFile(filePath: string, signal?: AbortSignal): Promise<ICodeChunk[]> {
    if (signal?.aborted) return []
    try {
      const content = await fs.readFile(filePath, "utf-8")
      const lang = this.detectLanguageFromPath(filePath)
      const chunker = this.getChunkerForLanguage(lang)
      const result = chunker.chunk(filePath, content)
      return result.chunks
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Не удалось обработать файл ${filePath}: ${msg}`)
      return []
    }
  }

  /**
   * Зарегистрировать чанкеры для разных языков.
   */
  private registerChunkers(): void {
    // TypeScript и JavaScript — структурный чанкер
    const tsChunker = new TypeScriptChunker(this.config)
    this.chunkers.set("ts", tsChunker)
    this.chunkers.set("tsx", tsChunker)
    this.chunkers.set("mts", tsChunker)
    this.chunkers.set("cts", tsChunker)
    this.chunkers.set("js", tsChunker)
    this.chunkers.set("jsx", tsChunker)
    this.chunkers.set("mjs", tsChunker)
    this.chunkers.set("cjs", tsChunker)

    // Для остальных языков — линейный чанкер
    const lineChunker = new LineChunker(this.config)
    this.chunkers.set("py", lineChunker)
    this.chunkers.set("rs", lineChunker)
    this.chunkers.set("go", lineChunker)
    this.chunkers.set("java", lineChunker)
    this.chunkers.set("kt", lineChunker)
    this.chunkers.set("rb", lineChunker)
    this.chunkers.set("c", lineChunker)
    this.chunkers.set("cpp", lineChunker)
    this.chunkers.set("cs", lineChunker)
    this.chunkers.set("swift", lineChunker)
    this.chunkers.set("html", lineChunker)
    this.chunkers.set("css", lineChunker)
    this.chunkers.set("sh", lineChunker)
    this.chunkers.set("unknown", lineChunker)
  }

  /**
   * Выбрать чанкер для языка.
   */
  private getChunkerForLanguage(language: string): IChunker {
    return this.chunkers.get(language) ?? new LineChunker(this.config)
  }

  /**
   * Определить язык по пути к файлу.
   */
  private detectLanguageFromPath(filePath: string): string {
    return detectLanguageShort(filePath)
  }
}
