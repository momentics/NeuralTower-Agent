/**
 * Экстрактор для DFM (.dfm — Delphi Form).
 *
 * Извлекает компоненты форм и их свойства из файлов
 * визуальных форм Delphi/Lazarus.
 */

import {
  INode,
  IEdge,
  IExtractionResult,
  IExtractionError,
  NodeKind,
  EdgeKind,
  Language,
} from '../../ntgraph/Types';
import { ExtractorBase } from '../ExtractorBase';

export class DfmExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'pascal';
  }

  public getSupportedExtensions(): string[] {
    return ['.dfm'];
  }

  public extract(
    content: string,
    filePath: string,
    _frameworkNames?: string[]
  ): IExtractionResult {
    const start = Date.now();

    // Обрабатываем только .dfm файлы
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    if (ext !== 'dfm') {
      return { nodes: [], edges: [], unresolvedReferences: [], errors: [], durationMs: Date.now() - start };
    }

    const nodes: INode[] = [];
    const edges: IEdge[] = [];
    const errors: IExtractionError[] = [];

    const lines = content.split('\n');
    const totalLines = lines.length;

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

    // Извлекаем главный компонент формы (первая секция)
    const formMatch = content.match(/^\s*(\w+)\s*=/m);
    const formName = formMatch?.[1] ?? filePath.split('/').pop()?.replace('.dfm', '') ?? 'Form';

    const formNode = this.createNode(
      filePath,
      NodeKind.Component,
      formName,
      1,
      totalLines,
      0,
      0,
      { qualifiedName: formName }
    );
    nodes.push(formNode);
    edges.push({ source: fileNode.id, target: formNode.id, kind: EdgeKind.Contains });

    // Извлекаем вложенные компоненты
    const componentRegex = /^\s*\{*\s*(\w+)\s*=/gm;
    let compMatch;
    let depth = 0;
    while ((compMatch = componentRegex.exec(content)) !== null) {
      const compName = compMatch[1];
      if (compName === formName) continue;

      const pos = compMatch.index;
      const lineNum = content.substring(0, pos).split('\n').length;

      // Определяем вид компонента по имени класса
      const kind = this.detectComponentKind(compName);

      const compNode = this.createNode(
        filePath,
        kind,
        compName,
        lineNum,
        lineNum,
        0,
        0,
        { qualifiedName: `${formName}.${compName}` }
      );
      nodes.push(compNode);
      edges.push({ source: formNode.id, target: compNode.id, kind: EdgeKind.Contains });
      depth++;
    }

    // Извлекаем свойства компонентов
    const propertyRegex = /^\s*(\w+)\s*=\s*(.+)$/gm;
    let propMatch;
    let currentComponent = formName;
    while ((propMatch = propertyRegex.exec(content)) !== null) {
      const propName = propMatch[1];
      const propValue = propMatch[2].trim();

      // Пропускаем строки, которые выглядят как начало компонента
      if (propValue.startsWith('{') || propValue.startsWith('(')) {
        currentComponent = propName;
        continue;
      }

      // Пропускаем ключевые слова DFM
      if (['object', 'stored', 'end', 'noname'].includes(propName.toLowerCase())) continue;

      const pos = propMatch.index;
      const lineNum = content.substring(0, pos).split('\n').length;

      const propNode = this.createNode(
        filePath,
        NodeKind.Property,
        propName,
        lineNum,
        lineNum,
        0,
        0,
        { qualifiedName: `${currentComponent}.${propName}`, metadata: { value: propValue } }
      );
      nodes.push(propNode);

      // Находим родительский компонент
      const parentComp = nodes.find(n =>
        n.name === currentComponent && n.kind !== 'property' && n.kind !== 'file'
      );
      if (parentComp) {
        edges.push({ source: parentComp.id, target: propNode.id, kind: EdgeKind.Contains });
      }
    }

    const durationMs = Date.now() - start;
    return { nodes, edges, unresolvedReferences: [], errors, durationMs };
  }

  /** Определяет вид узла по имени компонента. */
  private detectComponentKind(name: string): NodeKind {
    const lower = name.toLowerCase();
    if (lower.includes('button') || lower.includes('edit') || lower.includes('label') || lower.includes('grid')) {
      return NodeKind.Component;
    }
    if (lower.includes('form') || lower.includes('dialog')) {
      return NodeKind.Class;
    }
    return NodeKind.Component;
  }
}
