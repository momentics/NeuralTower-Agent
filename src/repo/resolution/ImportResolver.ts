/**
 * Разрешение ссылок через импорты.
 *
 * resolveViaImport, resolveJvmImport, extractImportMappings,
 * extractReExports, loadCppIncludeDirs, isPhpIncludePathRef.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  IUnresolvedReference,
  IResolvedRef,
  IResolutionContext,
  IImportMapping,
  IReExport,
} from '../ntgraph/Types';
import { loadProjectAliases } from '../extraction/PathAliases';
import type { AliasMap } from '../extraction/PathAliases';

// =============================================================================
// resolveViaImport
// =============================================================================

/**
 * Разрешение ссылки через import-карты файла.
 *
 * Ищет импорт, который сопоставляет имя ссылки с модулем, затем ищет
 * определение в целевом модуле.
 */
export function resolveViaImport(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  if (!ref.filePath) return null;

  const mappings = context.getImportMappings(ref.filePath);
  if (!mappings.length) return null;

  // Ищем импорт, который сопоставляет имя ссылки
  for (const mapping of mappings) {
    if (mapping.localName === ref.referenceName || mapping.exportedName === ref.referenceName) {
      // Ищем определение в целевом модуле
      const targetNodes = context.getNodesByFile(mapping.resolvedPath || mapping.source);
      for (const node of targetNodes) {
        if (node.name === mapping.exportedName || node.name === ref.referenceName) {
          return {
            original: ref,
            targetNodeId: node.id,
            confidence: 0.95,
            provenance: 'import-mapping',
          };
        }
      }

      // Ищем по qualifiedName
      const qName = `${mapping.source}.${mapping.exportedName}`;
      const qNodes = context.getNodesByQualifiedName(qName);
      if (qNodes.length > 0) {
        return {
          original: ref,
          targetNodeId: qNodes[0]!.id,
          confidence: 0.9,
          provenance: 'import-qualified',
        };
      }
    }
  }

  // Проверяем реэкспорт
  const reExports = context.getReExports(ref.filePath);
  for (const reExport of reExports) {
    if (reExport.kind === 'named' && reExport.exportedName === ref.referenceName) {
      const sourceNodes = context.getNodesByFile(reExport.source);
      for (const node of sourceNodes) {
        if (node.name === reExport.originalName) {
          return {
            original: ref,
            targetNodeId: node.id,
            confidence: 0.85,
            provenance: 're-export',
          };
        }
      }
    }
  }

  return null;
}

// =============================================================================
// resolveJvmImport
// =============================================================================

/**
 * JVM FQN разрешение: com.example.foo.Bar → поиск по qualifiedName.
 */
export function resolveJvmImport(
  ref: IUnresolvedReference,
  context: IResolutionContext
): IResolvedRef | null {
  const name = ref.referenceName;

  // Проверяем, похоже ли на JVM FQN
  if (!name.includes('.')) return null;

  const lang = ref.language ?? '';
  if (!['java', 'kotlin', 'scala'].includes(lang)) return null;

  // Ищем по точному qualifiedName
  const exactMatches = context.getNodesByQualifiedName(name);
  if (exactMatches.length > 0) {
    return {
      original: ref,
      targetNodeId: exactMatches[0]!.id,
      confidence: 0.95,
      provenance: 'jvm-fqn',
    };
  }

  // Ищем по последнему сегменту
  const lastSegment = name.split('.').pop()!;
  const nameMatches = context.getNodesByName(lastSegment);
  for (const node of nameMatches) {
    if (node.qualifiedName === name || node.qualifiedName.endsWith(`.${lastSegment}`)) {
      return {
        original: ref,
        targetNodeId: node.id,
        confidence: 0.8,
        provenance: 'jvm-segment',
      };
    }
  }

  return null;
}

// =============================================================================
// extractImportMappings
// =============================================================================

/**
 * Извлечение импортов из содержимого файла.
 */
export function extractImportMappings(
  filePath: string,
  content: string,
  language: string
): IImportMapping[] {
  const mappings: IImportMapping[] = [];

  switch (language) {
    case 'typescript':
    case 'javascript':
    case 'tsx':
    case 'jsx':
      extractJsImports(content, mappings);
      break;
    case 'python':
      extractPythonImports(content, mappings);
      break;
    case 'go':
      extractGoImports(content, mappings);
      break;
    case 'java':
    case 'kotlin':
    case 'scala':
      extractJvmImports(content, mappings);
      break;
    case 'rust':
      extractRustImports(content, mappings);
      break;
    case 'ruby':
      extractRubyImports(content, mappings);
      break;
    case 'php':
      extractPhpImports(content, mappings);
      break;
    case 'csharp':
      extractCsharpImports(content, mappings);
      break;
    case 'c':
    case 'cpp':
      extractCImports(content, mappings);
      break;
  }

  return mappings;
}

/** Извлечение импортов JavaScript/TypeScript. */
function extractJsImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // import { Foo, Bar } from './module'
    const namedMatch = line.match(/^\s*import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/);
    if (namedMatch) {
      const names = namedMatch[1].split(',').map((n: string) => n.trim());
      for (const name of names) {
        const [local, exported] = name.split(/\s+as\s+/);
        mappings.push({
          localName: local.trim(),
          exportedName: exported?.trim() || local.trim(),
          source: namedMatch[2],
          isDefault: false,
          isNamespace: false,
        });
      }
      continue;
    }

    // import Foo from './module'
    const defaultMatch = line.match(/^\s*import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/);
    if (defaultMatch) {
      mappings.push({
        localName: defaultMatch[1],
        exportedName: 'default',
        source: defaultMatch[2],
        isDefault: true,
        isNamespace: false,
      });
      continue;
    }

    // import * as Foo from './module'
    const nsMatch = line.match(/^\s*import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/);
    if (nsMatch) {
      mappings.push({
        localName: nsMatch[1],
        exportedName: '*',
        source: nsMatch[2],
        isDefault: false,
        isNamespace: true,
      });
    }
  }
}

/** Извлечение импортов Python. */
function extractPythonImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // from module import Foo, Bar
    const fromMatch = line.match(/^\s*from\s+([\w.]+)\s+import\s+(.+)/);
    if (fromMatch) {
      const names = fromMatch[2].split(',').map((n: string) => n.trim());
      for (const name of names) {
        const [local, exported] = name.split(/\s+as\s+/);
        mappings.push({
          localName: local.trim(),
          exportedName: exported?.trim() || local.trim(),
          source: fromMatch[1],
          isDefault: false,
          isNamespace: false,
        });
      }
      continue;
    }

    // import module
    const importMatch = line.match(/^\s*import\s+([\w.]+)/);
    if (importMatch) {
      const parts = importMatch[1].split('.');
      mappings.push({
        localName: parts[parts.length - 1],
        exportedName: importMatch[1],
        source: importMatch[1],
        isDefault: false,
        isNamespace: true,
      });
    }
  }
}

/** Извлечение импортов Go. */
function extractGoImports(content: string, mappings: IImportMapping[]): void {
  const importBlock = content.match(/import\s*\((.*?)\)/s);
  if (importBlock) {
    const lines = importBlock[1].split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      // alias "path"
      const aliasMatch = trimmed.match(/^(\w+)\s+"([^"]+)"/);
      if (aliasMatch) {
        const parts = aliasMatch[2].split('/');
        mappings.push({
          localName: aliasMatch[1],
          exportedName: parts[parts.length - 1],
          source: aliasMatch[2],
          isDefault: false,
          isNamespace: true,
        });
        continue;
      }

      // "path"
      const pathMatch = trimmed.match(/^"([^"]+)"/);
      if (pathMatch) {
        const parts = pathMatch[1].split('/');
        mappings.push({
          localName: parts[parts.length - 1],
          exportedName: parts[parts.length - 1],
          source: pathMatch[1],
          isDefault: false,
          isNamespace: true,
        });
      }
    }
  }
}

/** Извлечение импортов JVM. */
function extractJvmImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // import com.example.Foo;
    const importMatch = line.match(/^\s*import\s+(static\s+)?([\w.*]+)\s*;/);
    if (importMatch) {
      const fqName = importMatch[2];
      const parts = fqName.split('.');
      mappings.push({
        localName: parts[parts.length - 1] === '*' ? '' : parts[parts.length - 1],
        exportedName: fqName,
        source: fqName,
        isDefault: false,
        isNamespace: parts[parts.length - 1] === '*',
      });
    }
  }
}

/** Извлечение импортов Rust. */
function extractRustImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // use crate::foo::Bar;
    const useMatch = line.match(/^\s*use\s+([\w::]+)\s*;/);
    if (useMatch) {
      const parts = useMatch[1].split('::');
      mappings.push({
        localName: parts[parts.length - 1] === '*' ? '' : parts[parts.length - 1],
        exportedName: useMatch[1],
        source: useMatch[1],
        isDefault: false,
        isNamespace: parts[parts.length - 1] === '*',
      });
    }
  }
}

/** Извлечение импортов Ruby. */
function extractRubyImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // require 'module'
    const reqMatch = line.match(/^\s*(?:require|require_relative)\s+['"]([^'"]+)['"]/);
    if (reqMatch) {
      mappings.push({
        localName: '',
        exportedName: reqMatch[1],
        source: reqMatch[1],
        isDefault: false,
        isNamespace: true,
      });
    }
  }
}

/** Извлечение импортов PHP. */
function extractPhpImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // use Foo\Bar;
    const useMatch = line.match(/^\s*use\s+([\w\\]+)\s*;/);
    if (useMatch) {
      const parts = useMatch[1].split('\\');
      mappings.push({
        localName: parts[parts.length - 1],
        exportedName: useMatch[1],
        source: useMatch[1],
        isDefault: false,
        isNamespace: false,
      });
    }
  }
}

/** Извлечение импортов C#. */
function extractCsharpImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // using System.Collections;
    const usingMatch = line.match(/^\s*using\s+([\w.]+)\s*;/);
    if (usingMatch) {
      const parts = usingMatch[1].split('.');
      mappings.push({
        localName: parts[parts.length - 1],
        exportedName: usingMatch[1],
        source: usingMatch[1],
        isDefault: false,
        isNamespace: true,
      });
    }
  }
}

/** Извлечение импортов C/C++. */
function extractCImports(content: string, mappings: IImportMapping[]): void {
  const lines = content.split('\n');
  for (const line of lines) {
    // #include <header> or #include "header"
    const includeMatch = line.match(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/);
    if (includeMatch) {
      mappings.push({
        localName: '',
        exportedName: includeMatch[1],
        source: includeMatch[1],
        isDefault: false,
        isNamespace: true,
      });
    }
  }
}

// =============================================================================
// extractReExports
// =============================================================================

/**
 * Извлечение реэкспорта из содержимого файла.
 */
export function extractReExports(content: string, language: string): IReExport[] {
  const reExports: IReExport[] = [];

  if (['typescript', 'javascript', 'tsx', 'jsx'].includes(language)) {
    const lines = content.split('\n');
    for (const line of lines) {
      // export { Foo } from './module'
      const namedMatch = line.match(/^\s*export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/);
      if (namedMatch) {
        const names = namedMatch[1].split(',').map((n: string) => n.trim());
        for (const name of names) {
          const [exported, original] = name.split(/\s+as\s+/);
          reExports.push({
            kind: 'named',
            exportedName: exported.trim(),
            originalName: original?.trim() || exported.trim(),
            source: namedMatch[2],
          });
        }
        continue;
      }

      // export * from './module'
      const wildcardMatch = line.match(/^\s*export\s*\*\s*from\s*['"]([^'"]+)['"]/);
      if (wildcardMatch) {
        reExports.push({
          kind: 'wildcard',
          source: wildcardMatch[1],
        });
      }
    }
  }

  return reExports;
}

// =============================================================================
// loadCppIncludeDirs
// =============================================================================

/**
 * Загрузка директорий include из C++ конфигурации.
 */
export function loadCppIncludeDirs(projectRoot: string): string[] {
  const dirs: string[] = [];

  // CMakeLists.txt
  const cmakePath = path.join(projectRoot, 'CMakeLists.txt');
  if (fs.existsSync(cmakePath)) {
    const content = fs.readFileSync(cmakePath, 'utf-8');
    const matches = content.matchAll(/include_directories\s*\(\s*([^)]+)\)/g);
    for (const match of matches) {
      const paths = match[1].split(/\s+/);
      for (const p of paths) {
        const trimmed = p.trim();
        if (trimmed) dirs.push(path.isAbsolute(trimmed) ? trimmed : path.join(projectRoot, trimmed));
      }
    }
  }

  // Makefile
  const makefilePath = path.join(projectRoot, 'Makefile');
  if (fs.existsSync(makefilePath)) {
    const content = fs.readFileSync(makefilePath, 'utf-8');
    const matches = content.matchAll(/-I(\S+)/g);
    for (const match of matches) {
      dirs.push(match[1]);
    }
  }

  return dirs;
}

// =============================================================================
// isPhpIncludePathRef
// =============================================================================

/**
 * PHP include path обнаружение: предотвращает фоллбэк к name-matcher.
 */
export function isPhpIncludePathRef(ref: IUnresolvedReference): boolean {
  if (ref.language !== 'php') return false;

  const name = ref.referenceName;
  // PHP include path ссылки содержат разделители путей
  return name.includes('/') || name.includes('\\') || name.endsWith('.php');
}

// =============================================================================
// loadProjectAliases
// =============================================================================

/**
 * Загрузка path-алиасов из tsconfig.json / jsconfig.json.
 */
// loadProjectAliases imported directly from extraction/PathAliases.ts
