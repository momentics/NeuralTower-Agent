/**
 * Экстрактор для MyBatis (.xml mapper).
 *
 * Извлекает SQL-запросы как узлы и создаёт связи
 * с Java-методами через namespace и id.
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

export class MybatisExtractor extends ExtractorBase {
  public getLanguage(): Language {
    return 'xml';
  }

  public getSupportedExtensions(): string[] {
    return ['.xml'];
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

    // Проверяем, является ли файл MyBatis mapper
    if (!content.includes('mapper') && !content.includes('namespace')) {
      return { nodes: [], edges, unresolvedReferences: [], errors, durationMs: Date.now() - start };
    }

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

    // Извлекаем namespace
    const namespaceMatch = content.match(/namespace\s*=\s*"([^"]+)"/);
    const namespace = namespaceMatch?.[1] ?? '';

    // Извлекаем SQL-операции: select, insert, update, delete
    const statementRegex = /<(select|insert|update|delete)\s+id\s*=\s*"([^"]+)"([^>]*)>/g;
    let stmtMatch;
    while ((stmtMatch = statementRegex.exec(content)) !== null) {
      const stmtType = stmtMatch[1];
      const stmtId = stmtMatch[2];
      const attrs = stmtMatch[3] ?? '';

      const pos = stmtMatch.index;
      const lineNum = content.substring(0, pos).split('\n').length;

      // Находим конец тега
      const closeTag = `</${stmtType}>`;
      const closeIndex = content.indexOf(closeTag, pos);
      const endLine = closeIndex >= 0 ? content.substring(0, closeIndex).split('\n').length : lineNum;

      // Извлекаем параметры и результат
      const paramTypeMatch = attrs.match(/parameterType\s*=\s*"([^"]+)"/);
      const resultTypeMatch = attrs.match(/resultType\s*=\s*"([^"]+)"/);
      const resultMapMatch = attrs.match(/resultMap\s*=\s*"([^"]+)"/);

      const qualifiedName = namespace ? `${namespace}.${stmtId}` : stmtId;

      // Создаём узел функции для SQL-операции
      const stmtNode = this.createNode(
        filePath,
        NodeKind.Function,
        stmtId,
        lineNum,
        endLine,
        0,
        0,
        {
          qualifiedName,
          signature: `${stmtType} ${stmtId}`,
          returnType: resultTypeMatch?.[1] ?? resultMapMatch?.[1],
          metadata: {
            statementType: stmtType,
            parameterType: paramTypeMatch?.[1],
            resultType: resultTypeMatch?.[1],
            resultMap: resultMapMatch?.[1],
            namespace,
          },
        }
      );
      nodes.push(stmtNode);
      edges.push({ source: fileNode.id, target: stmtNode.id, kind: EdgeKind.Contains });

      // Создаём неразрешённую ссылку на Java-метод
      if (namespace) {
        unresolvedRefs.push({
          fromNodeId: stmtNode.id,
          referenceName: namespace,
          referenceKind: 'references',
          line: lineNum,
          column: 0,
          filePath,
          language: 'xml',
        });

        // Если есть resultType — ссылка на тип результата
        if (resultTypeMatch?.[1]) {
          unresolvedRefs.push({
            fromNodeId: stmtNode.id,
            referenceName: resultTypeMatch[1],
            referenceKind: 'type_of',
            line: lineNum,
            column: 0,
            filePath,
            language: 'xml',
          });
        }
      }
    }

    // Извлекаем resultMap определения
    const resultMapRegex = /<resultMap\s+id\s*=\s*"([^"]+)"\s+type\s*=\s*"([^"]+)"/g;
    let rmMatch;
    while ((rmMatch = resultMapRegex.exec(content)) !== null) {
      const rmId = rmMatch[1];
      const rmType = rmMatch[2];

      const pos = rmMatch.index;
      const lineNum = content.substring(0, pos).split('\n').length;

      const rmNode = this.createNode(
        filePath,
        NodeKind.TypeAlias,
        rmId,
        lineNum,
        lineNum,
        0,
        0,
        {
          qualifiedName: `${namespace}.${rmId}`,
          metadata: { mappedType: rmType },
        }
      );
      nodes.push(rmNode);
      edges.push({ source: fileNode.id, target: rmNode.id, kind: EdgeKind.Contains });

      unresolvedRefs.push({
        fromNodeId: rmNode.id,
        referenceName: rmType,
        referenceKind: 'type_of',
        line: lineNum,
        column: 0,
        filePath,
        language: 'xml',
      });
    }

    // Извлекаем <sql> фрагменты (переиспользуемые блоки)
    const sqlFragmentRegex = /<sql\s+id\s*=\s*"([^"]+)"/g;
    let sqlMatch;
    while ((sqlMatch = sqlFragmentRegex.exec(content)) !== null) {
      const sqlId = sqlMatch[1];

      const pos = sqlMatch.index;
      const lineNum = content.substring(0, pos).split('\n').length;

      const sqlNode = this.createNode(
        filePath,
        NodeKind.Constant,
        sqlId,
        lineNum,
        lineNum,
        0,
        0,
        {
          qualifiedName: `${namespace}.${sqlId}`,
          metadata: { isSqlFragment: true },
        }
      );
      nodes.push(sqlNode);
      edges.push({ source: fileNode.id, target: sqlNode.id, kind: EdgeKind.Contains });
    }

    const durationMs = Date.now() - start;
    return { nodes, edges, unresolvedReferences: unresolvedRefs, errors, durationMs };
  }
}
