/**
 * Универсальный AST-экстрактор: извлекает символьные узлы из файлов
 * языков без выделенных экстракторов по спецификации языка
 * (WASM-грамматика + карта «тип tree-sitter узла → kind узла графа»).
 *
 * Извлечение намеренно простое: объявления типов узлов из карты,
 * contains-рёбра от ближайшего контейнера, сигнатура — первая строка
 * объявления. Кросс-файловые ссылки не разрешаются (этим занимаются
 * эвристический резолвер и фреймворк-резолверы).
 */

import { getParser } from '../WasmRuntime';
import {
  INode,
  IEdge,
  IUnresolvedReference,
  IExtractionResult,
  IExtractionError,
  NodeKind,
  EdgeKind,
  Language,
} from '../../ntgraph/Types';
import { ExtractorBase } from '../ExtractorBase';

/** Спецификация языка для универсального экстрактора. */
export interface IGenericLanguageSpec {
  /** Язык (ntgraph). */
  language: Language;
  /** Имя WASM-грамматики (wasm-manifest). */
  grammar: string;
  /** Расширения файлов. */
  extensions: string[];
  /** Тип узла tree-sitter → kind узла графа. */
  nodeTypes?: Partial<Record<string, NodeKind>>;
  /**
   * kind по первому токену объявления: ключ «тип_узла:токен» → kind
   * (Zig: const/var в одном типе variable_declaration).
   */
  tokenKinds?: Record<string, NodeKind>;
  /**
   * Для грамматик, где объявления парсятся как вызовы (Elixir:
   * defmodule/def) — имя ключевого слова → kind.
   */
  callKeywords?: Record<string, NodeKind>;
  /** Функции внутри типов помечать как Method (Scala). */
  methodInsideTypes?: boolean;
}

/** Типы узлов, несущие имя символа в разных грамматиках. */
const NAME_NODE_TYPES = new Set([
  'identifier', 'name', 'function_name', 'method_name', 'class_name',
  'constant_name', 'variable_name', 'property_identifier',
  'field_identifier', 'label', 'struct_name', 'enum_name', 'type_name',
  'module_name', 'macro_name', 'contract_name', 'function_signature',
  'pattern', 'selectors', 'bare_key', 'value_name', 'value_identifier',
  'constructor_name',
]);

/** Кinds контейнеров, внутри которых функции считаются методами. */
const TYPE_CONTAINER_KINDS = new Set<NodeKind>([
  NodeKind.Class,
  NodeKind.Interface,
  NodeKind.Struct,
  NodeKind.Enum,
]);

export class GenericAstExtractor extends ExtractorBase {
  constructor(private readonly spec: IGenericLanguageSpec) {
    super();
  }

  public getLanguage(): Language {
    return this.spec.language;
  }

  public getSupportedExtensions(): string[] {
    return this.spec.extensions;
  }

  public extract(content: string, filePath: string, frameworkNames?: string[]): IExtractionResult {
    const start = Date.now();
    const nodes: INode[] = [];
    const edges: IEdge[] = [];
    const unresolvedReferences: IUnresolvedReference[] = [];
    const errors: IExtractionError[] = [];

    const p = getParser(this.spec.grammar);
    if (!p) {
      errors.push(this.createError(
        `WASM-грамматика ${this.spec.grammar} не загружена`,
        filePath,
        'error',
        'parse_error',
      ));
      return { nodes, edges, unresolvedReferences, errors, durationMs: Date.now() - start };
    }

    const tree = p.parse(content);
    if (!tree) {
      errors.push(this.createError('Не удалось разобрать файл', filePath, 'error', 'parse_error'));
      return { nodes, edges, unresolvedReferences, errors, durationMs: Date.now() - start };
    }

    // Строки файла считаем один раз: сигнатура каждого узла берётся из них,
    // и повторный split на каждом узле был бы дорог для больших файлов.
    const lines = content.split('\n');
    const fileNode = this.createNode(filePath, NodeKind.File, filePath, 1, lines.length, 0, 0);
    nodes.push(fileNode);
    const moduleName = filePath.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '');
    const moduleNode = this.createNode(filePath, NodeKind.Module, moduleName, 1, lines.length, 0, 0, { filePath });
    nodes.push(moduleNode);
    edges.push(this.createEdge(fileNode.id, moduleNode.id, EdgeKind.Contains));

    const nodeKinds = new Map<string, NodeKind>();
    nodeKinds.set(fileNode.id, NodeKind.File);
    nodeKinds.set(moduleNode.id, NodeKind.Module);
    this.walk(tree.rootNode, moduleNode.id, filePath, lines, nodes, edges, nodeKinds, null);
    tree.delete();

    return { nodes, edges, unresolvedReferences, errors, durationMs: Date.now() - start };
  }

  /** kind для узла: карта типов → токен объявления → ключевое слово вызова. */
  private kindFor(node: any): NodeKind | undefined {
    const mapped = this.spec.nodeTypes?.[node.type];
    if (mapped) return mapped;
    if (this.spec.tokenKinds) {
      const first = this.firstToken(node);
      if (first) {
        const byToken = this.spec.tokenKinds[`${node.type}:${first}`];
        if (byToken) return byToken;
      }
    }
    if (node.type === 'call' && this.spec.callKeywords) {
      const keyword = this.firstIdentifier(node);
      if (keyword) return this.spec.callKeywords[keyword];
    }
    return undefined;
  }

  /** Рекурсивный обход: объявления из карты — узлы, вложенные — внутрь. */
  private walk(
    node: any,
    containerId: string,
    filePath: string,
    lines: string[],
    nodes: INode[],
    edges: IEdge[],
    nodeKinds: Map<string, NodeKind>,
    suppressName: string | null,
  ): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child) continue;
      let kind = this.kindFor(child);
      if (kind) {
        // Методные объявления внутри типов (Scala и др.)
        if (kind === NodeKind.Function && this.spec.methodInsideTypes) {
          const containerKind = nodeKinds.get(containerId);
          if (containerKind && TYPE_CONTAINER_KINDS.has(containerKind)) {
            kind = NodeKind.Method;
          }
        }
        const name = this.extractName(child);
        if (name) {
          if (name !== suppressName) {
            const created = this.createNode(
              filePath,
              kind,
              name,
              child.startPosition.row + 1,
              child.endPosition.row + 1,
              child.startPosition.column,
              child.endPosition.column,
              { signature: this.extractSignature(child, lines) },
            );
            nodes.push(created);
            edges.push(this.createEdge(containerId, created.id, EdgeKind.Contains));
            nodeKinds.set(created.id, kind);
            // Вложенные объявления (методы класса и т. п.) — внутрь текущего узла;
            // suppressName гасит дубль того же символа среди прямых детей
            // (Dart: function_signature внутри method_signature).
            this.walk(child, created.id, filePath, lines, nodes, edges, nodeKinds, name);
            continue;
          }
          // Имя совпало с родительским объявлением — узел не дублируем
          this.walk(child, containerId, filePath, lines, nodes, edges, nodeKinds, null);
          continue;
        }
      }
      this.walk(child, containerId, filePath, lines, nodes, edges, nodeKinds, null);
    }
  }

  /**
   * Имя символа: поле name → прямой child-идентификатор → pattern-поле.
   * Для pattern-узлов (OCaml, ReScript) имя — первый идентификатор внутри:
   * текст паттерна функции с параметрами (`add a b`) целиком не годится.
   */
  private extractName(node: any): string | null {
    // Dart-метод: имя — идентификатор внутри вложенного function_signature
    if (node.type === 'method_signature') {
      return this.firstIdentifier(node);
    }
    // Elixir: defmodule/def парсятся как вызовы — имя в arguments
    if (node.type === 'call' && this.spec.callKeywords) {
      const args = this.childOfType(node, 'arguments');
      if (args) {
        const id = this.firstIdentifier(args);
        if (id) return id;
      }
    }
    const byField = node.childForFieldName?.('name');
    if (byField) {
      const name = this.nameFromNode(byField);
      if (name) return name;
    }
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && NAME_NODE_TYPES.has(c.type)) {
        const name = this.nameFromNode(c);
        if (name) return name;
      }
    }
    // Грамматики с pattern-полем (OCaml и др.): первый идентификатор внутри
    const pattern = node.childForFieldName?.('pattern');
    if (pattern) {
      const id = this.firstIdentifier(pattern);
      if (id) return id;
    }
    // JSON pair: имя — первый строковый ключ (без кавычек)
    if (node.type === 'pair') {
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c && c.type === 'string' && c.text.length >= 2) return c.text.slice(1, -1);
      }
    }
    return null;
  }

  /** Имя из узла-носителя: pattern даёт первый идентификатор, остальные — текст. */
  private nameFromNode(node: any): string | null {
    if (node.type === 'pattern') return this.firstIdentifier(node);
    return node.text || null;
  }

  /** Первый идентификатор в поддереве (глубина не более 3). */
  private firstIdentifier(node: any, depth = 0): string | null {
    if (depth > 3) return null;
    if (
      node.type === 'identifier' || node.type === 'variable_name' ||
      node.type === 'name' || node.type === 'alias'
    ) {
      return node.text;
    }
    for (let i = 0; i < node.childCount; i++) {
      const found = this.firstIdentifier(node.child(i), depth + 1);
      if (found) return found;
    }
    return null;
  }

  /** Первый анонимный токен (ключевое слово) узла. */
  private firstToken(node: any): string | null {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && !c.isNamed) return c.type;
    }
    return null;
  }

  /** Первый именованный child заданного типа. */
  private childOfType(node: any, type: string): any {
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c && c.type === type) return c;
    }
    return null;
  }

  /** Сигнатура — первая строка объявления (до 200 символов). */
  private extractSignature(node: any, lines: string[]): string | undefined {
    const firstLine = lines[node.startPosition.row]?.trim() ?? '';
    if (!firstLine) return undefined;
    return firstLine.length > 200 ? firstLine.slice(0, 200) + '…' : firstLine;
  }
}

/**
 * Экстрактор YAML: верхнеуровневые ключи документа — узлы.
 * WASM-грамматики для YAML в манифесте нет — парсинг построчный
 * (только ключи без отступа, вложенные структуры не раскрываются).
 */
export class YamlExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'yaml';
  }

  public getSupportedExtensions(): string[] {
    return ['.yaml', '.yml'];
  }

  public extract(content: string, filePath: string, frameworkNames?: string[]): IExtractionResult {
    const nodes: INode[] = [];
    const edges: IEdge[] = [];
    const lines = content.split('\n');

    const fileNode = this.createNode(filePath, NodeKind.File, filePath, 1, lines.length, 0, 0);
    nodes.push(fileNode);
    const moduleName = filePath.replace(/.*[/\\]/, '').replace(/\.[^.]+$/, '');
    const moduleNode = this.createNode(filePath, NodeKind.Module, moduleName, 1, lines.length, 0, 0, { filePath });
    nodes.push(moduleNode);
    edges.push(this.createEdge(fileNode.id, moduleNode.id, EdgeKind.Contains));

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([A-Za-z0-9_.-]+)\s*:/);
      if (!m) continue;
      const created = this.createNode(
        filePath,
        NodeKind.Variable,
        m[1],
        i + 1,
        i + 1,
        0,
        lines[i].length,
        { signature: lines[i].trim().slice(0, 200) },
      );
      nodes.push(created);
      edges.push(this.createEdge(moduleNode.id, created.id, EdgeKind.Contains));
    }

    return { nodes, edges, unresolvedReferences: [], errors: [], durationMs: 0 };
  }
}
