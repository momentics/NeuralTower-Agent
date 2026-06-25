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
export { CppExtractor } from './extractors/Cpp';
export { CSharpExtractor } from './extractors/CSharp';
export { DefaultExtractor } from './extractors/Default';

// =============================================================================
// Детекция языка и грамматики
// =============================================================================

export { detectLanguage, EXTENSION_TO_LANGUAGE } from './LanguageDetector';
export { loadGrammar, getGrammarName, getGrammarVariant } from './Grammars';

// =============================================================================
// Парсер (worker-поток)
// =============================================================================

export { parseFile, destroy } from './ParserWorker';

// =============================================================================
// Валидация путей
// =============================================================================

export { shouldIndexFile, isBinaryFile, isTooLarge, resolveRelativePath } from './PathValidation';

// =============================================================================
// Вложенные репозитории
// =============================================================================

export { discoverEmbeddedRepos } from './EmbeddedRepos';

// =============================================================================
// Детекция фреймворков
// =============================================================================

export { detectFrameworks } from './FrameworkDetection';

// =============================================================================
// Оркестратор индексации
// =============================================================================

export { IndexOrchestrator, IndexOptions } from './Orchestrator';

// =============================================================================
// Типы из ntgraph
// =============================================================================

export type {
  IIndexProgress,
  IIndexResult,
  ISyncResult,
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
