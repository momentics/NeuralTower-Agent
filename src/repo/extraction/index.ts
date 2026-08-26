/**
 * Баррель-экспорт модуля экстракции.
 * Пересылает все публичные API из подмодулей в одном месте.
 */

// =============================================================================
// База экстракторов
// =============================================================================

export { ExtractorBase, IExtractor } from './ExtractorBase';

// =============================================================================
// Экстракторы по языкам
// =============================================================================

export { TypeScriptExtractor } from './extractors/TypeScript';
export { PythonExtractor } from './extractors/Python';
export { GoExtractor } from './extractors/Go';
export { RustExtractor } from './extractors/Rust';
export { JavaExtractor } from './extractors/Java';
export { KotlinExtractor } from './extractors/Kotlin';
export { CppExtractor } from './extractors/Cpp';
export { CSharpExtractor } from './extractors/CSharp';
export { RazorExtractor } from './extractors/Razor';
export { AstroExtractor } from './extractors/Astro';
export { DefaultExtractor } from './extractors/Default';
export { SvelteExtractor } from './extractors/Svelte';
export { LiquidExtractor } from './extractors/Liquid';
export { VueExtractor } from './extractors/Vue';

// =============================================================================
// Детекция языка и грамматики
// =============================================================================

// Экстракция
export { extractFromSource, getExtractor } from './extractors/registry';

// Языки
export {
  detectLanguage,
  loadExtensionOverrides,
  EXTENSION_TO_LANGUAGE,
  isSourceFile,
  isLanguageSupported,
  getSupportedLanguages,
  isFileLevelOnlyLanguage,
} from './LanguageDetector';

// Грамматики (WASM-рантайм)
export {
  initWasmRuntime,
  resolveWasmDir,
  loadGrammarWasm,
  loadGrammarsForLanguages,
  getParser,
  getParserForFile,
  isGrammarLoaded,
} from './WasmRuntime';

// =============================================================================
// Пул воркеров парсинга
// =============================================================================

export { ParseWorkerPool, resolveParsePoolSize, resolveParseWorkerPath, WASM_WORKER_EXEC_ARGV } from './ParserWorkerPool';
export type { ParseTask, ParsePoolWorker } from './ParserWorkerPool';

// =============================================================================
// Валидация путей
// =============================================================================

export { shouldIndexFile, isBinaryFile, isTooLarge, resolveRelativePath } from './PathValidation';

// =============================================================================
// Вложенные репозитории
// =============================================================================

export { discoverEmbeddedRepoRoots, findIgnoredEmbeddedRepos, classifyGitDir } from './EmbeddedRepos';

// =============================================================================
// Оркестратор индексации
// =============================================================================

export { ExtractionOrchestrator, IndexOptions, IIndexAndResolveResult } from './Orchestrator';

// =============================================================================
// Gitignore
// =============================================================================

export { readGitignorePatterns, isValidUtf8, matchGitignorePattern } from './Gitignore';

// =============================================================================
// Типы из ntgraph
// =============================================================================

export type {
  IIndexProgress,
  IIndexResult,
  ISyncResult,
  IGraphQueryContext,
  IFileContext,
  IResolutionContext,
  IResolvedRef,
  IResolutionResult,
  IReExport,
  IAliasMap,
  IGoModule,
  IWorkspacePackages,
  IImportMapping,
  IFrameworkResolver,
} from '../ntgraph/Types';
