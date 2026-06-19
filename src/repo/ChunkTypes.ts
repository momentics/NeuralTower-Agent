/**
 * Типы для структурного разбиения кода на фрагменты.
 * Каждый фрагмент — это смысловая единица кода (функция, класс, метод),
 * которая может быть независимо индексирована и найдена через семантический поиск.
 */

/** Тип AST-узла, из которого получен фрагмент. */
export type ChunkNodeKind =
  | "class"
  | "function"
  | "method"
  | "interface"
  | "type"
  | "enum"
  | "const"
  | "block"
  | "top_level"

/**
 * Фрагмент кода — минимальная смысловая единица для индексации.
 */
export interface CodeChunk {
  /** Уникальный идентификатор фрагмента. */
  id: string

  /** Абсолютный путь к файлу. */
  filePath: string

  /** Содержимое фрагмента (код). */
  content: string

  /** Номер начальной строки (1-индекс). */
  startLine: number

  /** Номер конечной строки (1-индекс, включительно). */
  endLine: number

  /** Тип AST-узла. */
  nodeKind: ChunkNodeKind

  /** Имя символа (например, имя функции или класса). */
  symbolName?: string

  /** Имя родительского символа (например, имя класса для метода). */
  parentName?: string

  /** Язык файла. */
  language: string

  /** Подпись функции/метода (если применимо). */
  signature?: string

  /** Комментарий JSDoc или аналог (если найден). */
  docComment?: string

  /** Число символов во фрагменте. */
  charLength: number
}

/**
 * Результат разбиения одного файла на фрагменты.
 */
export interface ChunkResult {
  /** Файл, который был разбит. */
  filePath: string

  /** Фрагменты кода. */
  chunks: CodeChunk[]

  /** Общее число строк в файле. */
  totalLines: number
}

/**
 * Результат разбиения всего репозитория.
 */
export interface CodebaseChunkResult {
  /** Все фрагменты из всех файлов. */
  chunks: CodeChunk[]

  /** Число обработанных файлов. */
  filesProcessed: number

  /** Число пропущенных файлов (слишком большие или игнорируемые). */
  filesSkipped: number

  /** Общее число фрагментов. */
  totalChunks: number
}

/**
 * Конфигурация чанкера.
 */
export interface ChunkerConfig {
  /** Максимальный размер фрагмента в символах. */
  maxChunkSize: number

  /** Размер перекрытия между фрагментами в строках. */
  overlapLines: number

  /** Максимальный размер файла для обработки (в символах). */
  maxFileSize: number

  /** Минимальное число строк для фрагмента. */
  minChunkLines: number

  /** Число строк контекста для добавления вокруг фрагмента. */
  contextLines: number
}

/**
 * Конфигурация поиска по репозиторию.
 */
export interface SearchConfig {
  /** Число результатов для возврата. */
  topK: number

  /** Минимальный порог релевантности (0-1). */
  minScore: number

  /** Режим поиска. */
  searchMode: SearchMode
}

/** Режим поиска по репозиторию. */
export type SearchMode = "semantic" | "keyword" | "hybrid"
