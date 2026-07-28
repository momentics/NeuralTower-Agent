/**
 * Экстрактор для MyBatis (.xml mapper).
 *
 * Извлекает SQL-запросы как узлы и создаёт связи
 * с Java-методами через namespace и id. Поддерживает
 * MyBatis 3 и iBatis 2 (<sqlMap>), удаляет XML-комментарии,
 * обрабатывает <include refid> как ссылки.
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

  /** Удаляет XML-комментарии, сохраняя номера строк. */
  private static stripXmlComments(source: string): string {
    const out = source.split('');
    const n = source.length;
    let i = 0;
    while (i < n) {
      if (source.startsWith('<![CDATA[', i)) {
        const end = source.indexOf(']]>', i + 9);
        i = end >= 0 ? end + 3 : n;
        continue;
      }
      if (source.startsWith('<!--', i)) {
        const end = source.indexOf('-->', i + 4);
        const stop = end >= 0 ? end + 3 : n;
        for (let j = i; j < stop; j++) {
          if (source.charCodeAt(j) !== 10) out[j] = ' ';
        }
        i = stop;
        continue;
      }
      i++;
    }
    return out.join('');
  }

  /** Вычисляет массив позиций начала строк для бинарного поиска. */
  private static buildLineStarts(source: string): number[] {
    const starts: number[] = [0];
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10) {
        starts.push(i + 1);
      }
    }
    return starts;
  }

  /** Находит номер строки по позиции с помощью бинарного поиска. */
  private static lineAt(pos: number, lineStarts: number[]): number {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  /** Находит корневой элемент mapper (sqlMap или mapper) и возвращает диапазон тела. */
  private static findMapperRoot(cleaned: string, isIbatis2: boolean): { bodyStart: number; bodyEnd: number } {
    if (isIbatis2) {
      const m = cleaned.match(/<sqlMap[^>]*>/i);
      if (m) {
        const close = cleaned.indexOf('</sqlMap', m.index! + m[0].length);
        return { bodyStart: m.index! + m[0].length, bodyEnd: close >= 0 ? close : cleaned.length };
      }
    } else {
      const m = cleaned.match(/<mapper[^>]*>/i);
      if (m) {
        const close = cleaned.indexOf('</mapper', m.index! + m[0].length);
        return { bodyStart: m.index! + m[0].length, bodyEnd: close >= 0 ? close : cleaned.length };
      }
    }
    return { bodyStart: 0, bodyEnd: cleaned.length };
  }

  /** Для iBatis 2 без namespace: квалифицирует имя вида "Map.statement" → "Map::statement". */
  private static qualifyStatement(stmtId: string, namespace: string): string {
    if (namespace) return `${namespace}::${stmtId}`;
    if (stmtId.includes('.')) {
      const [type, name] = stmtId.split('.');
      return `${type}::${name}`;
    }
    return stmtId;
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

    // Проверяем, является ли файл MyBatis/iBatis mapper
    if (!content.includes('mapper') && !content.includes('namespace') && !content.includes('sqlMap')) {
      return { nodes: [], edges, unresolvedReferences: [], errors, durationMs: Date.now() - start };
    }

    // Предобработка: удаление XML-комментариев
    const cleaned = MybatisExtractor.stripXmlComments(content);
    const lineStarts = MybatisExtractor.buildLineStarts(cleaned);
    const totalLines = lineStarts.length;

    // Создаём узел файла
    const fileNode = this.createNode(
      filePath,
      NodeKind.File,
      filePath.split('/').pop() ?? filePath,
      1,
      totalLines,
      0,
      0,
      { qualifiedName: filePath }
    );
    nodes.push(fileNode);

    // Извлекаем namespace (MyBatis 3)
    const namespaceMatch = cleaned.match(/namespace\s*=\s*"([^"]+)"/);
    const namespace = namespaceMatch?.[1] ?? '';

    // Проверяем iBatis 2 (<sqlMap>)
    const isIbatis2 = /<sqlMap\s*[^>]*>/i.test(cleaned) && !namespace;

    // Определяем тело mapper для ограничения области парсинга
    const mapperRoot = MybatisExtractor.findMapperRoot(cleaned, isIbatis2);

    // Извлекаем SQL-операции: select, insert, update, delete (+ statement, procedure для iBatis 2)
    const verbs = isIbatis2
      ? 'select|insert|update|delete|statement|procedure'
      : 'select|insert|update|delete';
    const statementRegex = new RegExp(`<(${verbs})\\s+id\\s*=\\s*["']([^"']+)["']([^>]*)>`, 'g');
    let stmtMatch;
    while ((stmtMatch = statementRegex.exec(cleaned)) !== null) {
      const stmtType = stmtMatch[1];
      const stmtId = stmtMatch[2];
      const attrs = stmtMatch[3] ?? '';

      const pos = stmtMatch.index;
      const lineNum = MybatisExtractor.lineAt(pos, lineStarts);

      // Находим конец тега
      const closeTag = `</${stmtType}>`;
      const closeIndex = cleaned.indexOf(closeTag, pos);
      const endLine = closeIndex >= 0 ? MybatisExtractor.lineAt(closeIndex, lineStarts) : lineNum;

      // Извлекаем параметры и результат
      const paramTypeMatch = attrs.match(/parameterType\s*=\s*"([^"]+)"/);
      const resultTypeMatch = attrs.match(/resultType\s*=\s*"([^"]+)"/);
      const resultMapMatch = attrs.match(/resultMap\s*=\s*"([^"]+)"/);
      const databaseIdMatch = attrs.match(/databaseId\s*=\s*"([^"]+)"/);

      // databaseId splitting — разные方言 создают разные узлы
      const dbSuffix = databaseIdMatch ? `_${databaseIdMatch[1]}` : '';
      const qualifiedName = MybatisExtractor.qualifyStatement(stmtId, namespace) + dbSuffix;

      // Создаём узел функции для SQL-операции
      const stmtNode = this.createNode(
        filePath,
        NodeKind.Function,
        dbSuffix ? `${stmtId}${dbSuffix}` : stmtId,
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
            databaseId: databaseIdMatch?.[1],
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
      }

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

      // <include refid> cross-fragment ссылки
      const includeRegex = /<include\b[^>]*\brefid\s*=\s*(["'])([^"']+)\1/g;
      let incMatch;
      const stmtBody = closeIndex >= 0 ? cleaned.substring(pos, closeIndex) : '';
      while ((incMatch = includeRegex.exec(stmtBody)) !== null) {
        let refid = incMatch[2];
        if (refid.includes('.')) {
          refid = refid.replace('.', '::');
        } else if (namespace) {
          refid = `${namespace}::${refid}`;
        }
        unresolvedRefs.push({
          fromNodeId: stmtNode.id,
          referenceName: refid,
          referenceKind: 'references',
          line: lineNum,
          column: 0,
          filePath,
          language: 'xml',
        });
      }
    }

    // Извлекаем resultMap определения
    const resultMapRegex = /<resultMap\s+id\s*=\s*"([^"]+)"\s+type\s*=\s*"([^"]+)"/g;
    let rmMatch;
    while ((rmMatch = resultMapRegex.exec(cleaned)) !== null) {
      const rmId = rmMatch[1];
      const rmType = rmMatch[2];

      const pos = rmMatch.index;
      const lineNum = MybatisExtractor.lineAt(pos, lineStarts);

      const rmNode = this.createNode(
        filePath,
        NodeKind.TypeAlias,
        rmId,
        lineNum,
        lineNum,
        0,
        0,
        {
          qualifiedName: namespace ? `${namespace}::${rmId}` : rmId,
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
    while ((sqlMatch = sqlFragmentRegex.exec(cleaned)) !== null) {
      const sqlId = sqlMatch[1];

      const pos = sqlMatch.index;
      const lineNum = MybatisExtractor.lineAt(pos, lineStarts);

      const sqlNode = this.createNode(
        filePath,
        NodeKind.Constant,
        sqlId,
        lineNum,
        lineNum,
        0,
        0,
        {
          qualifiedName: namespace ? `${namespace}::${sqlId}` : sqlId,
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
