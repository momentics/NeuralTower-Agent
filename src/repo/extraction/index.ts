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

// Экстракция
export { extractFromSource } from './tree-sitter';

// Языки
export {
  detectLanguage,
  loadExtensionOverrides,
  EXTENSION_TO_LANGUAGE,
  isSourceFile,
  isLanguageSupported,
  isGrammarLoaded,
  getSupportedLanguages,
  isFileLevelOnlyLanguage,
} from './LanguageDetector';

// Грамматики
export {
  initGrammars,
  loadGrammarsForLanguages,
  loadAllGrammars,
  loadGrammar,
  getGrammarName,
  getGrammarVariant,
} from './Grammars';

// =============================================================================
// Парсер (worker-поток)
// =============================================================================

export { parseFile, destroy, loadGrammars } from './ParserWorker';

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
