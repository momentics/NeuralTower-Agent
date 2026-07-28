/**
 * Экстрактор для CFML (.cfm, .cfc, .cfs).
 *
 * Извлекает компоненты (class), методы, свойства и функции
 * из файлов ColdFusion Markup Language. Поддерживает два диалекта:
 * tag-based (.cfm, .cfc с тегами) и bare-script (.cfc/.cfs с компонентным синтаксисом).
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

/** Определяет, является ли файл bare-script CFML (компонентный синтаксис). */
function isBareScriptCfml(source: string): boolean {
  return /^\s*(?:component|interface)\b/i.test(source.trim()) ||
    /<cfscript>/i.test(source) === false && /\bcomponent\s*\{/i.test(source);
}

export class CfmlExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'cfml';
  }

  public getSupportedExtensions(): string[] {
    return ['.cfm', '.cfc', '.cfs'];
  }

  public extract(
    content: string,
    filePath: string,
    _frameworkNames?: string[]
  ): IExtractionResult {
    const start = Date.now();
    const nodes: INode[] = [];
    const edges: IEdge[] = [];
    const unresolvedRefs: IUnresolvedReference[] = [];
    const errors: IExtractionError[] = [];

    const lines = content.split('\n');
    const totalLines = lines.length;
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    const lang: Language = (ext === 'cfc' || ext === 'cfs') ? 'cfscript' : 'cfml';

    // Создаём узел файла
    const fileNode = this.createNode(
      filePath,
      NodeKind.File,
      filePath.split('/').pop() ?? filePath,
      1,
      totalLines,
      0,
      lines[totalLines - 1]?.length ?? 0,
      { qualifiedName: filePath }
    );
    nodes.push(fileNode);

    // Имя компонента из пути файла (CFC convention)
    const componentName = filePath.split('/').pop()?.replace(/\.(cfc|cfs|cfm)$/i, '') ?? 'UnknownComponent';

    if (ext === 'cfc' || ext === 'cfs') {
      // Парсинг CFC компонента
      this.extractCfcComponent(
        content, filePath, componentName, lang,
        nodes, edges, unresolvedRefs, fileNode
      );
    } else if (isBareScriptCfml(content)) {
      // Bare-script компонент
      this.extractCfcComponent(
        content, filePath, componentName, 'cfscript',
        nodes, edges, unresolvedRefs, fileNode
      );
    } else {
      // Tag-based CFML
      this.extractTagBasedCfml(
        content, filePath, componentName,
        nodes, edges, unresolvedRefs, fileNode
      );
    }

    const durationMs = Date.now() - start;
    return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs };
  }

  /** Извлекает структуру CFC-компонента (script syntax). */
  private extractCfcComponent(
    content: string,
    filePath: string,
    componentName: string,
    lang: Language,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    fileNode: INode
  ): void {
    // Создаём узел класса компонента
    const classNode = this.createNode(
      filePath,
      NodeKind.Class,
      componentName,
      1,
      content.split('\n').length,
      0,
      0,
      { qualifiedName: componentName, isExported: true }
    );
    nodes.push(classNode);
    edges.push({ source: fileNode.id, target: classNode.id, kind: EdgeKind.Contains });

    // Извлекаем extends/implements как unresolved references
    const extendsMatch = content.match(/\bextends\s*=\s*"([^"]+)"/i);
    if (extendsMatch) {
      unresolvedRefs.push({
        fromNodeId: classNode.id,
        referenceName: extendsMatch[1],
        referenceKind: 'extends',
        line: 1,
        column: 0,
        filePath,
        language: lang,
      });
    }

    const implementsMatch = content.match(/\bimplements\s*=\s*"([^"]+)"/i);
    if (implementsMatch) {
      const implTypes = implementsMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const implType of implTypes) {
        unresolvedRefs.push({
          fromNodeId: classNode.id,
          referenceName: implType,
          referenceKind: 'implements',
          line: 1,
          column: 0,
          filePath,
          language: lang,
        });
      }
    }

    // Извлекаем методы через script-синтаксис
    const methodRegex = /\bfunction\s+(\w+)\s*\(/g;
    let methodMatch;
    while ((methodMatch = methodRegex.exec(content)) !== null) {
      const methodName = methodMatch[1];
      const pos = methodMatch.index;
      const lineNum = content.substring(0, pos).split('\n').length;

      // Находим конец метода
      let braceCount = 0;
      let inFunction = false;
      let endPos = pos;
      for (let i = pos; i < content.length; i++) {
        if (content[i] === '{') { braceCount++; inFunction = true; }
        if (content[i] === '}') { braceCount--; if (inFunction && braceCount === 0) { endPos = i; break; } }
      }
      const endLine = content.substring(0, endPos).split('\n').length;

      // Qualified names через :: separator
      const methodNode = this.createNode(
        filePath,
        NodeKind.Method,
        methodName,
        lineNum,
        endLine,
        0,
        0,
        { qualifiedName: `${componentName}::${methodName}` }
      );
      nodes.push(methodNode);
      edges.push({ source: classNode.id, target: methodNode.id, kind: EdgeKind.Contains });
    }

    // Извлекаем свойства
    const propertyRegex = /\bproperty\s+name\s*=\s*"([^"]*)"/gi;
    let propMatch;
    while ((propMatch = propertyRegex.exec(content)) !== null) {
      const propName = propMatch[1];
      const pos = propMatch.index;
      const lineNum = content.substring(0, pos).split('\n').length;

      const propertyNode = this.createNode(
        filePath,
        NodeKind.Property,
        propName,
        lineNum,
        lineNum,
        0,
        0,
        { qualifiedName: `${componentName}::${propName}` }
      );
      nodes.push(propertyNode);
      edges.push({ source: classNode.id, target: propertyNode.id, kind: EdgeKind.Contains });
    }

    // Извлекаем cfproperty теги
    const cfPropRegex = /<cfproperty\b[^>]*\bname\s*=\s*"([^"]*)"/gi;
    let cfPropMatch;
    while ((cfPropMatch = cfPropRegex.exec(content)) !== null) {
      const propName = cfPropMatch[1];
      const pos = cfPropMatch.index;
      const lineNum = content.substring(0, pos).split('\n').length;

      const typeMatch = cfPropMatch[0].match(/\btype\s*=\s*"([^"]*)"/i);
      if (typeMatch?.[1]) {
        unresolvedRefs.push({
          fromNodeId: classNode.id,
          referenceName: typeMatch[1],
          referenceKind: 'type_of',
          line: lineNum,
          column: 0,
          filePath,
          language: lang,
        });
      }

      const propertyNode = this.createNode(
        filePath,
        NodeKind.Property,
        propName,
        lineNum,
        lineNum,
        0,
        0,
        { qualifiedName: `${componentName}::${propName}` }
      );
      nodes.push(propertyNode);
      edges.push({ source: classNode.id, target: propertyNode.id, kind: EdgeKind.Contains });
    }
  }

  /** Извлекает структуру tag-based CFML. */
  private extractTagBasedCfml(
    content: string,
    filePath: string,
    componentName: string,
    nodes: INode[],
    edges: IEdge[],
    unresolvedRefs: IUnresolvedReference[],
    fileNode: INode
  ): void {
    // Извлекаем cffunction теги
    const funcRegex = /<cffunction\b[^>]*\bname\s*=\s*"([^"]*)"/gi;
    let funcMatch;
    while ((funcMatch = funcRegex.exec(content)) !== null) {
      const funcName = funcMatch[1];
      const pos = funcMatch.index;
      const lineNum = content.substring(0, pos).split('\n').length;

      const returnTypeMatch = funcMatch[0].match(/\baccess\s*=\s*"([^"]*)"/i);

      const funcNode = this.createNode(
        filePath,
        NodeKind.Function,
        funcName,
        lineNum,
        lineNum,
        0,
        0,
        {
          qualifiedName: `${componentName}::${funcName}`,
          metadata: { access: returnTypeMatch?.[1] }
        }
      );
      nodes.push(funcNode);
      edges.push({ source: fileNode.id, target: funcNode.id, kind: EdgeKind.Contains });
    }

    // Извлекаем cfcomponent extends/implements
    const compRegex = /<cfcomponent\b[^>]*>/gi;
    let compMatch;
    while ((compMatch = compRegex.exec(content)) !== null) {
      const tag = compMatch[0];
      const pos = compMatch.index;
      const lineNum = content.substring(0, pos).split('\n').length;

      const extendsM = tag.match(/\bextends\s*=\s*"([^"]*)"/i);
      if (extendsM?.[1]) {
        unresolvedRefs.push({
          fromNodeId: fileNode.id,
          referenceName: extendsM[1],
          referenceKind: 'extends',
          line: lineNum,
          column: 0,
          filePath,
          language: 'cfml',
        });
      }

      const implementsM = tag.match(/\bimplements\s*=\s*"([^"]*)"/i);
      if (implementsM?.[1]) {
        const implTypes = implementsM[1].split(',').map(s => s.trim()).filter(Boolean);
        for (const implType of implTypes) {
          unresolvedRefs.push({
            fromNodeId: fileNode.id,
            referenceName: implType,
            referenceKind: 'implements',
            line: lineNum,
            column: 0,
            filePath,
            language: 'cfml',
          });
        }
      }
    }
  }
}
