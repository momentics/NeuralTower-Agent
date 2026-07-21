/**
 * Фреймворк-резолвер для Spring Boot.
 */

import type {
  IFrameworkResolver,
  IUnresolvedReference,
  IResolvedRef,
  IResolutionContext,
  INode,
  IFrameworkExtractionResult,
  Language,
} from '../../ntgraph/Types';
import { NodeKind } from '../../ntgraph/Types';
import { registerFrameworkResolver } from '../Frameworks';
import * as crypto from 'crypto';

/** Языки, к которым применим резолвер. */
const LANGUAGES: Language[] = ['java', 'kotlin'];

/** Spring relaxed binding: canonical config key. */
function canonicalConfigKey(key: string): string {
  return key.replace(/[-_:]/g, '').toLowerCase();
}

/** Spring relaxed binding: canonical config key including dots. */
function canonicalConfigKeyDotted(key: string): string {
  return key.replace(/[-_:.]/g, '').toLowerCase();
}

/** Парсинг YAML (indent-based) для извлечения leaf-key узлов. */
function extractSpringConfigYaml(
  filePath: string,
  content: string
): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  const lines = content.split('\n');
  let currentPath = '';
  let indentStack: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.search(/\S/);
    const kvMatch = trimmed.match(/^(\S+?):\s*(.*)$/);

    if (!kvMatch) continue;

    const key = kvMatch[1];
    const value = kvMatch[2].trim();

    // Корректируем стек индентации
    while (indentStack.length > 0 && indentStack[indentStack.length - 1] >= indent) {
      indentStack.pop();
    }

    const fullPath = indentStack.length > 0
      ? `${currentPath}.${key}`
      : key;

    indentStack.push(indent);

    if (!value || value === '{}' || value === '[]') {
      currentPath = fullPath;
      continue;
    }

    // Leaf key — создаём узел (без значения, только ключ — безопасность)
    nodes.push({
      id: crypto.createHash('sha256').update(`config:${filePath}:${fullPath}`).digest('hex'),
      kind: NodeKind.Constant,
      name: fullPath,
      qualifiedName: `${filePath}#${fullPath}`,
      filePath,
      language: 'yaml',
      startLine: i + 1,
      endLine: i + 1,
      startColumn: 0,
      endColumn: trimmed.length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Парсинг .properties для извлечения leaf-key узлов. */
function extractSpringConfigProperties(
  filePath: string,
  content: string
): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;

    const kvMatch = line.match(/^([^=]+)=(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1].trim();

    // Leaf key — создаём узел (без значения, только ключ — безопасность)
    nodes.push({
      id: crypto.createHash('sha256').update(`config:${filePath}:${key}`).digest('hex'),
      kind: NodeKind.Constant,
      name: key,
      qualifiedName: `${filePath}#${key}`,
      filePath,
      language: 'properties',
      startLine: i + 1,
      endLine: i + 1,
      startColumn: 0,
      endColumn: line.length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Извлечение Spring Boot route-узлов. */
function extractSpringRoutes(
  filePath: string,
  content: string,
  language: Language
): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // @GetMapping, @PostMapping и т.д. (Java + Kotlin)
  const routeRe = /@(?:Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(content))) {
    const routePath = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`route:${filePath}:${routePath}`).digest('hex'),
      kind: NodeKind.Route,
      name: routePath,
      qualifiedName: `${filePath}#${routePath}`,
      filePath,
      language,
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Извлечение @Value("${key}") узлов. */
function extractValueBindings(
  filePath: string,
  content: string,
  language: Language
): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // @Value("${key}")
  const valueRe = /@Value\s*\(\s*"\$\{([^}]+)\}"/g;
  let m: RegExpExecArray | null;
  while ((m = valueRe.exec(content))) {
    const key = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`value:${filePath}:${key}`).digest('hex'),
      kind: NodeKind.Constant,
      name: key,
      qualifiedName: `${filePath}#${key}`,
      filePath,
      language,
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Обнаружение Spring Boot проекта. */
function detectSpring(context: IResolutionContext): boolean {
  const files = context.getAllFiles();

  // Проверяем pom.xml / build.gradle
  for (const buildFile of ['pom.xml', 'build.gradle', 'build.gradle.kts']) {
    if (!files.includes(buildFile)) continue;
    const content = context.getFileContent?.(buildFile);
    if (content && /(?:spring-boot|springframework)/i.test(content)) return true;
  }

  // Проверяем Java файлы на аннотации
  const javaFiles = files.filter((f) => f.endsWith('.java') || f.endsWith('.kt'));
  for (const f of javaFiles) {
    const content = context.getFileContent?.(f);
    if (content && /@(?:SpringBootApplication|RestController|Service|Repository)/.test(content)) {
      return true;
    }
  }

  return false;
}

/** Резолвер Spring Boot. */
const springResolver: IFrameworkResolver = {
  name: 'Spring Boot',
  languages: LANGUAGES,

  detect: detectSpring,

  claimsReference(name: string): boolean {
    // ConfigurationProperties prefix refs
    return name.includes(':');
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // *Service
    if (/Service$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'spring-service',
        };
      }
    }

    // *Repository
    if (/Repository$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'spring-repository',
        };
      }
    }

    // *Controller
    if (/Controller$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'spring-controller',
        };
      }
    }

    // Entity/Model (PascalCase)
    if (/^[A-Z][a-z]+\w*$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.7,
          provenance: 'spring-entity',
        };
      }
    }

    // *Component / *Config
    if (/Component$/.test(name) || /Config$/.test(name)) {
      const nodes = context.getNodesByName(name).filter((n) => n.kind === 'class');
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.8,
          provenance: 'spring-component',
        };
      }
    }

    // Config-key @Value("${key}")
    if (name.includes(':')) {
      const configNodes = context.getNodesByName(name);
      if (configNodes.length === 1) {
        return {
          original: ref,
          targetNodeId: configNodes[0]!.id,
          confidence: 0.8,
          provenance: 'spring-config',
        };
      }

      // Spring relaxed binding
      const canonical = canonicalConfigKeyDotted(name);
      const allConfigNodes = context.getNodesByKind('constant');
      for (const cn of allConfigNodes) {
        if (canonicalConfigKeyDotted(cn.name) === canonical) {
          return {
            original: ref,
            targetNodeId: cn.id,
            confidence: 0.75,
            provenance: 'spring-config-relaxed',
          };
        }
      }
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    const lang: Language = filePath.endsWith('.kt') ? 'kotlin' : 'java';

    // Spring config files
    if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) {
      const yamlResult = extractSpringConfigYaml(filePath, content);
      allNodes.push(...yamlResult.nodes);
      allRefs.push(...yamlResult.references);
    } else if (filePath.endsWith('.properties')) {
      const propsResult = extractSpringConfigProperties(filePath, content);
      allNodes.push(...propsResult.nodes);
      allRefs.push(...propsResult.references);
    }

    // Spring Boot routes
    if (filePath.endsWith('.java') || filePath.endsWith('.kt')) {
      const routeResult = extractSpringRoutes(filePath, content, lang);
      allNodes.push(...routeResult.nodes);
      allRefs.push(...routeResult.references);

      const valueResult = extractValueBindings(filePath, content, lang);
      allNodes.push(...valueResult.nodes);
      allRefs.push(...valueResult.references);
    }

    return { nodes: allNodes, references: allRefs };
  },
};

registerFrameworkResolver(springResolver);
