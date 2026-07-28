/**
 * Экстрактор для DFM (.dfm — Delphi Form).
 *
 * Извлекает компоненты форм, их свойства и event handler-ссылки
 * из файлов визуальных форм Delphi/Lazarus.
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
    const unresolvedRefs: IUnresolvedReference[] = [];
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

    // Паттерн для event handler-ссылок
    const eventPattern = /^\s*(On\w+)\s*=\s*(\w+)\s*$/;
    // Паттерн для вложенных компонентов (object/inherited/inline)
    const objectPattern = /^\s*(object|inherited|inline)\s+(\w+)\s*:\s*(\w+)/;
    // Паттерн для начала multi-line свойств
    const multiLineStart = /=\s*\(\s*$/;
    const multiLineItemStart = /=\s*<\s*$/;

    // Стек компонентов для отслеживания вложенности
    const componentStack: Array<{ name: string; id: string }> = [{ name: formName, id: formNode.id }];
    let inMultiLine = false;
    let multiLineDepth = 0;

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx]!;
      const lineNum = idx + 1;

      // Обработка multi-line свойств
      if (inMultiLine) {
        multiLineDepth += (line.indexOf('(') >= 0 ? 1 : 0) + (line.indexOf('<') >= 0 ? 1 : 0);
        multiLineDepth -= (line.indexOf(')') >= 0 ? 1 : 0) + (line.indexOf('>') >= 0 ? 1 : 0);
        if (multiLineDepth <= 0) {
          inMultiLine = false;
          multiLineDepth = 0;
        }
        continue;
      }

      // Проверка на end (выход из вложенного компонента)
      if (/^\s*end\s*;/.test(line)) {
        if (componentStack.length > 1) {
          componentStack.pop();
        }
        continue;
      }

      const currentComponent = componentStack[componentStack.length - 1];

      // Проверка на event handler
      const eventMatch = line.match(eventPattern);
      if (eventMatch) {
        unresolvedRefs.push({
          fromNodeId: currentComponent!.id,
          referenceName: eventMatch[2],
          referenceKind: 'references',
          line: lineNum,
          column: 0,
          filePath,
          language: 'pascal',
        });
        continue;
      }

      // Проверка на вложенный компонент (object/inherited/inline)
      const objMatch = line.match(objectPattern);
      if (objMatch) {
        const compName = objMatch[2];
        const kind = this.detectComponentKind(compName);
        const compNode = this.createNode(
          filePath,
          kind,
          compName,
          lineNum,
          lineNum,
          0,
          0,
          { qualifiedName: `${currentComponent!.name}.${compName}` }
        );
        nodes.push(compNode);
        edges.push({ source: currentComponent!.id, target: compNode.id, kind: EdgeKind.Contains });
        componentStack.push({ name: compName, id: compNode.id });
        continue;
      }

      // Проверка на старый формат компонента {*Name =
      const oldCompMatch = line.match(/^\s*\{?\s*(\w+)\s*=/);
      if (oldCompMatch) {
        const compName = oldCompMatch[1];
        if (compName === formName) continue;
        const kind = this.detectComponentKind(compName);
        const compNode = this.createNode(
          filePath,
          kind,
          compName,
          lineNum,
          lineNum,
          0,
          0,
          { qualifiedName: `${currentComponent!.name}.${compName}` }
        );
        nodes.push(compNode);
        edges.push({ source: currentComponent!.id, target: compNode.id, kind: EdgeKind.Contains });
        componentStack.push({ name: compName, id: compNode.id });
        continue;
      }

      // Проверка на multi-line свойство
      const propMatch = line.match(/^\s*(\w+)\s*=\s*(.*)$/);
      if (propMatch) {
        const propName = propMatch[1];
        const propValue = propMatch[2].trim();

        // Пропускаем ключевые слова DFM
        if (['object', 'stored', 'end', 'noname', 'inherited', 'inline'].includes(propName.toLowerCase())) continue;

        // Начало multi-line
        if (multiLineStart.test(propValue) || multiLineItemStart.test(propValue)) {
          inMultiLine = true;
          multiLineDepth = 1;
          continue;
        }

        const propNode = this.createNode(
          filePath,
          NodeKind.Property,
          propName,
          lineNum,
          lineNum,
          0,
          0,
          { qualifiedName: `${currentComponent!.name}.${propName}`, metadata: { value: propValue } }
        );
        nodes.push(propNode);
        edges.push({ source: currentComponent!.id, target: propNode.id, kind: EdgeKind.Contains });
      }
    }

    const durationMs = Date.now() - start;
    return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs };
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
