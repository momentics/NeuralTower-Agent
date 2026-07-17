export { FileIndex } from "./FileIndex"
export type { IFileIndex, IIndexEntry } from "./FileIndex"
export { RepoAnalyzer } from "./RepoAnalyzer"
export { InMemoryVectorStore } from "./InMemoryVectorStore"
export type { IVectorStore, IChunkEmbedding, ISearchResult } from "./IVectorStore"
export { FullTextSearch } from "./FullTextSearch"
export { SqliteFullTextSearch } from "./SqliteFullTextSearch"
export { CodebaseSearch } from "./CodebaseSearch"
export type { ICodebaseSearch, IUnifiedSearchResult } from "./CodebaseSearch"
export { CodebaseChunker, type ICodebaseChunker, createDefaultChunkerConfig } from "./CodebaseChunker"
export type { ChunkNodeKind, ICodeChunk, IChunkResult, ICodebaseChunkResult, IChunkerConfig, ISearchConfig, SearchMode } from "./ChunkTypes"
export { NtGraphDb } from "./ntgraph"

// Графовый обход
export { GraphTraverser } from "./graph"

// Разрешение ссылок
export { ReferenceResolver, isBuiltInSymbol, matchReference, matchFunctionRef, resolveViaImport, resolveJvmImport, extractImportMappings, extractReExports, synthesizeCallbackEdges, HIGH_VALUE_NODE_KINDS, SUPERTYPE_BEARING_KINDS, CONTAINER_NODE_KINDS, CHAIN_LANGUAGES, SCOPED_CHAIN_LANGUAGES, MAX_HOPS } from "./resolution"

// Построение контекста
export { ContextBuilder, formatContextAsMarkdown, formatContextAsJson, extractSymbolsFromQuery, LOW_CONFIDENCE_MARKER } from "./context"
