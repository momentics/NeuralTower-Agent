/**
 * Экстрактор для CFML (.cfm, .cfc).
 *
 * Извлекает компоненты (class), методы, свойства и функции
 * из файлов ColdFusion Markup Language.
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

export class CfmlExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'cfml';
  }

  public getSupportedExtensions(): string[] {
    return ['.cfm', '.cfc'];
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
    const lang: Language = ext === 'cfc' ? 'cfml' : 'cfml';

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

    // Парсим компонент CFC
    if (ext === 'cfc') {
      const componentMatch = content.match(/component\s+[^=]*=\s*"([^"]*)"/i);
      const componentName = componentMatch?.[1] ?? filePath.split('/').pop()?.replace('.cfc', '') ?? 'UnknownComponent';

      const classNode = this.createNode(
        filePath,
        NodeKind.Class,
        componentName,
        1,
        totalLines,
        0,
        0,
        { qualifiedName: componentName, isExported: true }
      );
      nodes.push(classNode);
      edges.push({ source: fileNode.id, target: classNode.id, kind: EdgeKind.Contains });

      // Извлекаем методы
      const methodRegex = /function\s+(\w+)\s*\(/g;
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

        const methodNode = this.createNode(
          filePath,
          NodeKind.Method,
          methodName,
          lineNum,
          endLine,
          0,
          0,
          { qualifiedName: `${componentName}.${methodName}` }
        );
        nodes.push(methodNode);
        edges.push({ source: classNode.id, target: methodNode.id, kind: EdgeKind.Contains });
      }

      // Извлекаем свойства
      const propertyRegex = /property\s+name\s*=\s*"([^"]*)"/gi;
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
          { qualifiedName: `${componentName}.${propName}` }
        );
        nodes.push(propertyNode);
        edges.push({ source: classNode.id, target: propertyNode.id, kind: EdgeKind.Contains });
      }
    }

    // Извлекаем функции из .cfm файлов
    if (ext === 'cfm') {
      const funcRegex = /function\s+(\w+)\s*\(/g;
      let funcMatch;
      while ((funcMatch = funcRegex.exec(content)) !== null) {
        const funcName = funcMatch[1];
        const pos = funcMatch.index;
        const lineNum = content.substring(0, pos).split('\n').length;

        let braceCount = 0;
        let inFunc = false;
        let endPos = pos;
        for (let i = pos; i < content.length; i++) {
          if (content[i] === '{') { braceCount++; inFunc = true; }
          if (content[i] === '}') { braceCount--; if (inFunc && braceCount === 0) { endPos = i; break; } }
        }
        const endLine = content.substring(0, endPos).split('\n').length;

        const funcNode = this.createNode(
          filePath,
          NodeKind.Function,
          funcName,
          lineNum,
          endLine,
          0,
          0,
          { qualifiedName: funcName }
        );
        nodes.push(funcNode);
        edges.push({ source: fileNode.id, target: funcNode.id, kind: EdgeKind.Contains });
      }
    }

    const durationMs = Date.now() - start;
    return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs };
  }
}
