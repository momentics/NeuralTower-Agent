/**
 * Точка экспорта модуля resolution.
 */

export { ReferenceResolver } from './Resolver';
export { isBuiltInSymbol, JS_BUILT_INS, REACT_HOOKS, PYTHON_BUILT_INS, PYTHON_BUILT_IN_TYPES, PYTHON_BUILT_IN_METHODS, GO_BUILT_INS, GO_STDLIB_PACKAGES, PASCAL_BUILT_INS, PASCAL_UNIT_PREFIXES, C_BUILT_INS, CPP_BUILT_INS } from './BuiltIns';
export { matchReference, matchFunctionRef, matchDottedCallChain, matchScopedCallChain, sameLanguageFamily, crossesKnownFamily } from './NameMatcher';
export { resolveViaImport, resolveJvmImport, extractImportMappings, extractReExports, loadCppIncludeDirs, isPhpIncludePathRef } from './ImportResolver';
export { synthesizeCallbackEdges } from './CallbackSynthesizer';
export { HIGH_VALUE_NODE_KINDS, SUPERTYPE_BEARING_KINDS, CONTAINER_NODE_KINDS, CHAIN_LANGUAGES, SCOPED_CHAIN_LANGUAGES, CHAIN_SHAPE, MAX_HOPS, DEFAULT_CACHE_LIMIT } from './Constants';
