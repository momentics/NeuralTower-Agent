/**
 * Экстрактор для Razor/Blazor.
 *
 * Использует регулярные выражения для парсинга и извлечения узлов,
 * рёбер и неразрешённых ссылок из .cshtml и .razor файлов.
 */

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

export class RazorExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'razor';
  }

  public getSupportedExtensions(): string[] {
    return ['.cshtml', '.razor'];
  }

  public extract(
    content: string,
    filePath: string,
    _frameworkNames?: string[]
  ): IExtractionResult {
    const nodes: INode[] = [];
    const edges: IEdge[] = [];
    const unresolvedRefs: IUnresolvedReference[] = [];
    const errors: IExtractionError[] = [];
    const start = Date.now();

    const lines = content.split('\n');
    const totalLines = lines.length;

    // Корневой узел — файл
    const fileNode = this.createNode(
      filePath,
      NodeKind.File,
      filePath,
      1,
      totalLines,
      0,
      0
    );
    nodes.push(fileNode);

    // Module-узел
    const moduleNode = this.createNode(
      filePath,
      NodeKind.Module,
      filePath,
      1,
      totalLines,
      0,
      0
    );
    nodes.push(moduleNode);
    edges.push(this.createEdge(fileNode.id, moduleNode.id, EdgeKind.Contains));

    // Извлекаем @model
    this.extractModel(content, lines, filePath, moduleNode.id, nodes, edges, unresolvedRefs);

    // Извлекаем @inject
    this.extractInject(content, lines, filePath, moduleNode.id, nodes, edges, unresolvedRefs);

    // Извлекаем @using
    this.extractUsing(content, lines, filePath, moduleNode.id, nodes, edges, unresolvedRefs);

    // Извлекаем обработчики событий: @onclick, @onchange и т.д.
    this.extractEventHandlers(content, lines, filePath, moduleNode.id, nodes, edges, unresolvedRefs);

    // Извлекаем ссылки на компоненты: <ComponentName ... />
    this.extractComponentRefs(content, lines, filePath, moduleNode.id, nodes, edges, unresolvedRefs);

    return {
      nodes,
      edges,
      unresolvedReferences: unresolvedRefs,
      errors,
      durationMs: Date.now() - start,
    };
  }

  /** Извлекает объявление @model. */
  protected extractModel(
    content: string,
    lines: string[],
    filePath: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[]
  ): void {
    const regex = /@model\s+([\w.<>\[\],\s]+)/;
    const match = content.match(regex);
    if (!match) return;

    const modelType = match[1].trim();
    const line = this.getLine(content, match.index!);
    const column = (match.index ?? 0) + '@model '.length;

    const modelNode = this.createNode(
      filePath,
      NodeKind.Class,
      modelType,
      line,
      line,
      column,
      column + modelType.length,
      {
        qualifiedName: modelType,
      }
    );
    nodes.push(modelNode);
    edges.push(this.createEdge(parentId, modelNode.id, EdgeKind.Contains));

    // Неразрешённая ссылка на тип модели
    unresolvedRefs.push(this.createUnresolvedRef(
      modelNode.id,
      modelType,
      EdgeKind.References,
      line,
      column,
      filePath
    ));
  }

  /** Извлекает объявления @inject. */
  protected extractInject(
    content: string,
    lines: string[],
    filePath: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[]
  ): void {
    const regex = /@inject\s+([\w<>\[\],\s]+?)\s+(\w+)/g;
    let m;
    while ((m = regex.exec(content)) !== null) {
      const typeExpr = m[1].trim();
      const name = m[2].trim();
      const line = this.getLine(content, m.index!);
      const column = (m.index ?? 0) + '@inject '.length;

      const injectNode = this.createNode(
        filePath,
        NodeKind.Field,
        name,
        line,
        line,
        column,
        column + typeExpr.length + name.length,
        {
          qualifiedName: name,
        }
      );
      nodes.push(injectNode);
      edges.push(this.createEdge(parentId, injectNode.id, EdgeKind.Contains));

      // Неразрешённая ссылка на тип
      unresolvedRefs.push(this.createUnresolvedRef(
        injectNode.id,
        typeExpr,
        EdgeKind.References,
        line,
        column,
        filePath
      ));
    }
  }

  /** Извлекает директивы @using. */
  protected extractUsing(
    content: string,
    lines: string[],
    filePath: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[]
  ): void {
    const regex = /@using\s+([\w.]+)/g;
    let m;
    while ((m = regex.exec(content)) !== null) {
      const ns = m[1].trim();
      const line = this.getLine(content, m.index!);
      const column = (m.index ?? 0) + '@using '.length;

      const importNode = this.createNode(
        filePath,
        NodeKind.Import,
        ns,
        line,
        line,
        column,
        column + ns.length
      );
      nodes.push(importNode);
      edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Contains));
      edges.push(this.createEdge(parentId, importNode.id, EdgeKind.Imports));

      unresolvedRefs.push(this.createUnresolvedRef(
        importNode.id,
        ns,
        EdgeKind.Imports,
        line,
        column,
        filePath
      ));
    }
  }

  /** Извлекает обработчики событий: @onclick, @onchange и т.д. */
  protected extractEventHandlers(
    content: string,
    lines: string[],
    filePath: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[]
  ): void {
    const regex = /@on(\w+)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = regex.exec(content)) !== null) {
      const eventName = m[1].trim();
      const handlerExpr = m[2].trim();
      const line = this.getLine(content, m.index!);
      const column = m.index ?? 0;

      const handlerNode = this.createNode(
        filePath,
        NodeKind.Method,
        `@on${eventName}`,
        line,
        line,
        column,
        column + m[0].length,
        {
          qualifiedName: `@on${eventName}`,
        }
      );
      nodes.push(handlerNode);
      edges.push(this.createEdge(parentId, handlerNode.id, EdgeKind.Contains));

      // Извлекаем имя метода из выражения обработчика
      const methodRef = this.extractMethodName(handlerExpr);
      if (methodRef) {
        edges.push(this.createEdge(handlerNode.id, this.nodeId(filePath, NodeKind.Method, methodRef, 0), EdgeKind.Calls, {
          metadata: { referenceName: methodRef },
          line,
          column,
        }));
        unresolvedRefs.push(this.createUnresolvedRef(
          handlerNode.id,
          methodRef,
          EdgeKind.Calls,
          line,
          column,
          filePath
        ));
      }
    }
  }

  /** Извлекает имя метода из выражения обработчика. */
  protected extractMethodName(expr: string): string | null {
    // Лямбда: @code => SomeMethod() или просто SomeMethod
    const lambdaMatch = expr.match(/=>\s*(\w+)/);
    if (lambdaMatch) return lambdaMatch[1];

    // Метод-ссылка: SomeMethod
    if (/^\w+$/.test(expr)) return expr;

    // Вызов: SomeMethod()
    const callMatch = expr.match(/^(\w+)\s*\(/);
    if (callMatch) return callMatch[1];

    return null;
  }

  /** Извлекает ссылки на компоненты: <ComponentName ... /> или <ComponentName>...</ComponentName>. */
  protected extractComponentRefs(
    content: string,
    lines: string[],
    filePath: string,
    parentId: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[]
  ): void {
    // Самозакрывающиеся: <ComponentName ... /> или <ComponentName/>
    const selfClosingRegex = /<(\/?)([A-Z][\w.]*)\s*[^>]*\/>/g;
    let m;
    while ((m = selfClosingRegex.exec(content)) !== null) {
      const compName = m[2].trim();
      const line = this.getLine(content, m.index!);
      const column = m.index! + 1;

      const compNode = this.createNode(
        filePath,
        NodeKind.Component,
        compName,
        line,
        line,
        column,
        column + compName.length
      );
      nodes.push(compNode);
      edges.push(this.createEdge(parentId, compNode.id, EdgeKind.Contains));

      unresolvedRefs.push(this.createUnresolvedRef(
        compNode.id,
        compName,
        EdgeKind.References,
        line,
        column,
        filePath
      ));
    }

    // Открывающие теги компонентов (не самозакрывающиеся): <ComponentName> или <ComponentName attr="val">
    const openTagRegex = /<(\/?)([A-Z][\w.]*)\s*(?:[^\/>].*?)?>/g;
    while ((m = openTagRegex.exec(content)) !== null) {
      const compName = m[2].trim();
      const line = this.getLine(content, m.index!);
      const column = m.index! + 1;

      const compNode = this.createNode(
        filePath,
        NodeKind.Component,
        compName,
        line,
        line,
        column,
        column + compName.length
      );
      nodes.push(compNode);
      edges.push(this.createEdge(parentId, compNode.id, EdgeKind.Contains));

      unresolvedRefs.push(this.createUnresolvedRef(
        compNode.id,
        compName,
        EdgeKind.References,
        line,
        column,
        filePath
      ));
    }
  }

  /** Возвращает номер строки для позиции в содержимом. */
  protected getLine(content: string, index: number): number {
    return content.substring(0, index).split('\n').length;
  }
}
