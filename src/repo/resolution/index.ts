/**
 * Точка экспорта модуля resolution.
 */

export { ReferenceResolver } from './Resolver';
export { isBuiltInSymbol, JS_BUILT_INS, REACT_HOOKS, PYTHON_BUILT_INS, PYTHON_BUILT_IN_TYPES, PYTHON_BUILT_IN_METHODS, GO_BUILT_INS, GO_STDLIB_PACKAGES, PASCAL_BUILT_INS, PASCAL_UNIT_PREFIXES, C_BUILT_INS, CPP_BUILT_INS } from './BuiltIns';
export { matchReference, matchByFilePath, matchFunctionRef, matchDottedCallChain, matchScopedCallChain, sameLanguageFamily, crossesKnownFamily, resolveMethodOnType, preferCallSiteFile, isLexicallyReachable } from './NameMatcher';
export { resolveViaImport, resolveJvmImport, extractImportMappings, extractReExports, loadCppIncludeDirs, isPhpIncludePathRef } from './ImportResolver';
export { synthesizeCallbackEdges } from './CallbackSynthesizer';
export { synthesizeGoframeEdges, GOFRAME_ROUTE_MARKER } from './GoframeSynthesizer';
export { synthesizeCfnptrEdges } from './CfnptrSynthesizer';
export { HIGH_VALUE_NODE_KINDS, SUPERTYPE_BEARING_KINDS, CONTAINER_NODE_KINDS, CHAIN_LANGUAGES, SCOPED_CHAIN_LANGUAGES, CHAIN_SHAPE, MAX_HOPS, DEFAULT_CACHE_LIMIT, AMBIGUOUS_NAME_CEILING } from './Constants';
export { cgroupMemoryAvailable, darwinMemoryAvailable, memoryBudgetBytes } from './MemoryBudget';
export { detectFrameworks, getAllFrameworkResolvers, getFrameworkResolver, getApplicableFrameworks, registerFrameworkResolver } from './Frameworks';

// Регистрация всех встроенных фреймворк-резолверов
import './fw-resolvers';
