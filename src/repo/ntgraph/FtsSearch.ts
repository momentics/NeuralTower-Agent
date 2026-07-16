/**
 * FTS5-поиск с трёхуровневым fallback.
 *
 * FTS5 → LIKE → Fuzzy, BM25 с весами, over-fetch x5, rescoring,
 * exact-match supplement, экранирование спецсимволов.
 */

import { SqliteDatabase } from './Adapter';
import {
  NodeKind,
  Language,
  INode,
  ISearchResult,
} from './Types';
import {
  rowToNode,
  kindBonus,
  nameMatchBonus,
  scorePathRelevance,
  boundedEditDistance,
} from './Utils';
import { isGeneratedFile } from '../extraction/GeneratedDetection';
import {
  FTS_OVER_FETCH_MULTIPLIER,
  FTS_LIMIT_MIN,
  EXACT_MATCH_SUPPLEMENT_LIMIT,
  FUZZY_MAX_DIST_SHORT,
  FUZZY_MAX_DIST_DEFAULT,
} from './Types';

/** Разрешённые значения kind: (из NodeKind). */
const KIND_VALUES: ReadonlySet<string> = new Set<string>(Object.values(NodeKind));

/** Разрешённые значения lang:/language: (из Language). */
const LANGUAGE_VALUES: ReadonlySet<string> = new Set<string>(Language.map(l => l.toLowerCase()));

/**
 * Результат парсинга запроса с полевыми фильтрами.
 */
interface ParsedQuery {
  text: string;
  kinds: NodeKind[];
  languages: Language[];
  pathFilters: string[];
  nameFilters: string[];
}

/**
 * Парсит сырой запрос вида `kind:function name:auth path:src/api authenticate`
 * в структурированные фильтры + свободный текст для FTS.
 */
function parseQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = {
    text: '',
    kinds: [],
    languages: [],
    pathFilters: [],
    nameFilters: [],
  };

  // Токенизация с учётом кавычек
  const tokens: string[] = [];
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && /\s/.test(raw[i]!)) i++;
    if (i >= raw.length) break;
    const start = i;
    while (i < raw.length && !/\s/.test(raw[i]!)) {
      if (raw[i] === '"') {
        const end = raw.indexOf('"', i + 1);
        if (end === -1) {
          i = raw.length;
          break;
        }
        i = end + 1;
        continue;
      }
      i++;
    }
    tokens.push(raw.slice(start, i));
  }

  const textParts: string[] = [];
  for (const tok of tokens) {
    const colon = tok.indexOf(':');
    if (colon <= 0 || colon === tok.length - 1) {
      textParts.push(tok);
      continue;
    }
    const key = tok.slice(0, colon).toLowerCase();
    const valueRaw = unquote(tok.slice(colon + 1));
    if (!valueRaw) {
      textParts.push(tok);
      continue;
    }
    switch (key) {
      case 'kind': {
        if (KIND_VALUES.has(valueRaw)) {
          out.kinds.push(valueRaw as NodeKind);
        } else {
          textParts.push(tok);
        }
        break;
      }
      case 'lang':
      case 'language': {
        const lower = valueRaw.toLowerCase();
        if (LANGUAGE_VALUES.has(lower)) {
          out.languages.push(lower as Language);
        } else {
          textParts.push(tok);
        }
        break;
      }
      case 'path':
        out.pathFilters.push(valueRaw);
        break;
      case 'name':
        out.nameFilters.push(valueRaw);
        break;
      default:
        textParts.push(tok);
    }
  }

  out.text = textParts.join(' ').trim();
  return out;
}

/** Удаляет внешние двойные кавычки. */
function unquote(s: string): string {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

interface NodeRow {
  id: string;
  kind: string;
  name: string;
  qualified_name: string;
  file_path: string;
  language: string;
  start_line: number;
  end_line: number;
  start_column: number;
  end_column: number;
  docstring: string | null;
  signature: string | null;
  visibility: string | null;
  is_exported: number;
  is_async: number;
  is_static: number;
  is_abstract: number;
  decorators: string | null;
  type_parameters: string | null;
  return_type: string | null;
  updated_at: number;
}

interface IFtsSearchOptions {
  kinds?: NodeKind[];
  languages?: string[];
  limit?: number;
  offset?: number;
  pathFilters?: string[];
  nameFilters?: string[];
}

/**
 * Трёхуровневый FTS-поиск.
 * Уровень 1: FTS5 с BM25.
 * Уровень 2: LIKE (если текст >= 2 символа).
 * Уровень 3: Fuzzy (если текст >= 3 символа).
 */
export class FtsSearch {
  private db: SqliteDatabase;
  private projectNameTokens: Set<string> = new Set();

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  setProjectNameTokens(tokens: Set<string>): void {
    this.projectNameTokens = tokens;
  }

  /**
   * Полный поиск с fallback.
   */
  search(query: string, options: IFtsSearchOptions = {}): ISearchResult[] {
    // Парсим поле-квалифицированные фильтры из запроса (kind:, lang:, path:, name:)
    const parsed = parseQuery(query);

    // Объединяем фильтры из запроса и из options (options имеют приоритет)
    const kinds = options.kinds ?? (parsed.kinds.length ? parsed.kinds : undefined);
    const languages = options.languages ?? (parsed.languages.length ? parsed.languages : undefined);
    const pathFilters = options.pathFilters ?? (parsed.pathFilters.length ? parsed.pathFilters : undefined);
    const nameFilters = options.nameFilters ?? (parsed.nameFilters.length ? parsed.nameFilters : undefined);
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    // Свободный текст для FTS (может быть пустым, если запрос состоит только из фильтров)
    const searchText = parsed.text;

    // Если есть текст для поиска — используем FTS с fallback
    if (searchText) {
      // Уровень 1: FTS5
      let results = this.searchFTS(searchText, { kinds, languages, limit, offset });

      // Уровень 2: LIKE
      if (results.length === 0 && searchText.length >= 2) {
        results = this.searchLike(searchText, { kinds, languages, limit, offset });
      }

      // Уровень 3: Fuzzy
      if (results.length === 0 && searchText.length >= 3) {
        results = this.searchFuzzy(searchText, { kinds, languages, limit });
      }

      // Точное дополнение по имени
      if (results.length > 0 && searchText) {
        results = this.supplementExactMatches(searchText, results, kinds, languages);
      }

      // Rescoring
      if (results.length > 0) {
        results = this.rescore(results, searchText);
        results.sort((a, b) => b.score - a.score);

        // Path filter
        if (pathFilters && pathFilters.length > 0) {
          const pfLower = pathFilters.map(f => f.toLowerCase());
          results = results.filter(r => pfLower.some(f => r.node.filePath.toLowerCase().includes(f)));
        }

        // Name filter
        if (nameFilters && nameFilters.length > 0) {
          const nfLower = nameFilters.map(f => f.toLowerCase());
          results = results.filter(r => nfLower.some(f => r.node.name.toLowerCase().includes(f)));
        }

        if (results.length > limit) {
          results = results.slice(0, limit);
        }
      }

      return results;
    }

    // Только фильтры без текста — используем searchAllByFilters из QueryBuilder
    if (kinds || languages || pathFilters || nameFilters) {
      return this.searchByFiltersOnly({ kinds, languages, pathFilters, nameFilters, limit });
    }

    return [];
  }

  /**
   * Поиск только по фильтрам (без текстового поиска).
   */
  private searchByFiltersOnly(options: {
    kinds?: NodeKind[];
    languages?: string[];
    pathFilters?: string[];
    nameFilters?: string[];
    limit?: number;
  }): ISearchResult[] {
    const { kinds, languages, pathFilters, nameFilters, limit = 100 } = options;
    const fts = this;

    let sql = 'SELECT * FROM nodes WHERE 1=1';
    const params: (string | number)[] = [];

    if (kinds && kinds.length > 0) {
      sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
      params.push(...kinds);
    }

    if (languages && languages.length > 0) {
      sql += ` AND language IN (${languages.map(() => '?').join(',')})`;
      params.push(...languages);
    }

    sql += ' LIMIT ?';
    params.push(limit * 5);

    try {
      const rows = fts.db.prepare(sql).all(...params) as NodeRow[];
      const results: ISearchResult[] = rows.map(row => ({ node: rowToNode(row), score: 0.5 }));

      // Path filter
      if (pathFilters && pathFilters.length > 0) {
        const pfLower = pathFilters.map(f => f.toLowerCase());
        results.filter(r => pfLower.some(f => r.node.filePath.toLowerCase().includes(f)));
      }

      // Name filter
      if (nameFilters && nameFilters.length > 0) {
        const nfLower = nameFilters.map(f => f.toLowerCase());
        results.filter(r => nfLower.some(f => r.node.name.toLowerCase().includes(f)));
      }

      return results.slice(0, limit);
    } catch {
      return [];
    }
  }

  /**
   * FTS5-поиск с BM25 и весами.
   * Весовая схема: id=0, name=20, qualified_name=5, docstring=1, signature=2.
   * Over-fetch x5 для пост-пересчёта.
   */
  searchFTS(query: string, options: IFtsSearchOptions): ISearchResult[] {
    const { kinds, languages, limit = 100, offset = 0 } = options;

    const ftsQuery = this.buildFtsQuery(query);
    if (!ftsQuery) return [];

    const ftsLimit = Math.max(limit * FTS_OVER_FETCH_MULTIPLIER, FTS_LIMIT_MIN);

    let sql = `
      SELECT nodes.*, bm25(nodes_fts, 0, 20, 5, 1, 2) as score
      FROM nodes_fts
      JOIN nodes ON nodes_fts.id = nodes.id
      WHERE nodes_fts MATCH ?
    `;

    const params: (string | number)[] = [ftsQuery];

    if (kinds && kinds.length > 0) {
      sql += ` AND nodes.kind IN (${kinds.map(() => '?').join(',')})`;
      params.push(...kinds);
    }

    if (languages && languages.length > 0) {
      sql += ` AND nodes.language IN (${languages.map(() => '?').join(',')})`;
      params.push(...languages);
    }

    sql += ' ORDER BY score LIMIT ? OFFSET ?';
    params.push(ftsLimit, offset);

    try {
      const rows = this.db.prepare(sql).all(...params) as (NodeRow & { score: number })[];
      return rows.map((row) => ({
        node: rowToNode(row),
        score: Math.abs(row.score),
      }));
    } catch {
      return [];
    }
  }

 /**
    * LIKE-фоллбэк.
    */
  searchLike(query: string, options: IFtsSearchOptions = {}): ISearchResult[] {
    const { kinds, languages, limit = 100, offset = 0 } = options;

    let sql = `
      SELECT nodes.*,
        CASE
          WHEN name = ? THEN 1.0
          WHEN name LIKE ? THEN 0.9
          WHEN name LIKE ? THEN 0.8
          WHEN qualified_name LIKE ? THEN 0.7
          ELSE 0.5
        END as score
      FROM nodes
      WHERE (
        name LIKE ? OR
        qualified_name LIKE ? OR
        name LIKE ?
      )
    `;

    const exactMatch = query;
    const startsWith = `${query}%`;
    const contains = `%${query}%`;

    const params: (string | number)[] = [
      exactMatch, startsWith, contains, contains,
      contains, contains, startsWith,
    ];

    if (kinds && kinds.length > 0) {
      sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
      params.push(...kinds);
    }

    if (languages && languages.length > 0) {
      sql += ` AND language IN (${languages.map(() => '?').join(',')})`;
      params.push(...languages);
    }

    sql += ' ORDER BY score DESC, length(name) ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as (NodeRow & { score: number })[];
    return rows.map((row) => ({
      node: rowToNode(row),
      score: row.score,
    }));
  }

  /**
   * Fuzzy-фоллбэк через bounded edit distance.
   */
  searchFuzzy(
    text: string,
    options: { kinds?: NodeKind[]; languages?: string[]; limit?: number } = {}
  ): ISearchResult[] {
    const { kinds, languages, limit = 100 } = options;
    const lowered = text.toLowerCase();
    const maxDist = lowered.length <= 4 ? FUZZY_MAX_DIST_SHORT : FUZZY_MAX_DIST_DEFAULT;

    const allNames = this.getAllNodeNames();
    const candidates: Array<{ name: string; dist: number }> = [];
    for (const name of allNames) {
      const dist = boundedEditDistance(name.toLowerCase(), lowered, maxDist);
      if (dist <= maxDist) candidates.push({ name, dist });
    }
    candidates.sort((a, b) => a.dist - b.dist);

    const FUZZY_FOLLOWUP_CAP = Math.max(limit * 2, 50);
    const cappedCandidates = candidates.slice(0, FUZZY_FOLLOWUP_CAP);

    const results: ISearchResult[] = [];
    const seen = new Set<string>();
    for (const c of cappedCandidates) {
      if (results.length >= limit) break;
      let sql = 'SELECT * FROM nodes WHERE name = ?';
      const params: (string | number)[] = [c.name];
      if (kinds && kinds.length > 0) {
        sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
        params.push(...kinds);
      }
      if (languages && languages.length > 0) {
        sql += ` AND language IN (${languages.map(() => '?').join(',')})`;
        params.push(...languages);
      }
      sql += ' LIMIT 5';
      const rows = this.db.prepare(sql).all(...params) as NodeRow[];
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        results.push({ node: rowToNode(row), score: 1 / (1 + c.dist) });
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  /**
   * Точное дополнение по имени — предотвращает погребение коротких имён BM25.
   */
  private supplementExactMatches(
    query: string,
    results: ISearchResult[],
    kinds?: NodeKind[],
    languages?: string[]
  ): ISearchResult[] {
    const existingIds = new Set(results.map(r => r.node.id));
    const maxFtsScore = Math.max(...results.map(r => r.score));
    const terms = query.split(/\s+/).filter(t => t.length >= 2);

    for (const term of terms) {
      let sql = 'SELECT * FROM nodes WHERE name = ? COLLATE NOCASE';
      const params: (string | number)[] = [term];
      if (kinds && kinds.length > 0) {
        sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`;
        params.push(...kinds);
      }
      if (languages && languages.length > 0) {
        sql += ` AND language IN (${languages.map(() => '?').join(',')})`;
        params.push(...languages);
      }
      sql += ' LIMIT ?';
      params.push(EXACT_MATCH_SUPPLEMENT_LIMIT);

      const rows = this.db.prepare(sql).all(...params) as NodeRow[];
      for (const row of rows) {
        if (!existingIds.has(row.id)) {
          results.push({ node: rowToNode(row), score: maxFtsScore });
          existingIds.add(row.id);
        }
      }
    }

    return results;
  }

/**
    * Rescoring с multi-signal бонусами.
    */
  private rescoring(results: ISearchResult[], query: string): ISearchResult[] {
    return results.map(r => {
      let s = r.score
        + kindBonus(r.node.kind)
        + scorePathRelevance(r.node.filePath, query, this.projectNameTokens)
        + nameMatchBonus(query, r.node.name);

      // Понижение ранга для сгенерированных файлов
      if (isGeneratedFile(r.node.filePath)) {
        s *= 0.1;
      }

      return { ...r, score: s };
    });
  }

  /** Rescoring (алиас для публичного API). */
  private rescore(results: ISearchResult[], query: string): ISearchResult[] {
    return this.rescoring(results, query);
  }

  /**
   * Построение FTS5-запроса с экранированием спецсимволов.
   */
  buildFtsQuery(query: string): string | null {
    const ftsQuery = query
      .replace(/::/g, ' ')
      .replace(/['"*():^]/g, '')
      .split(/\s+/)
      .filter(term => term.length > 0)
      .filter(term => !/^(AND|OR|NOT|NEAR)$/i.test(term))
      .map(term => `"${term}"*`)
      .join(' OR ');

    return ftsQuery || null;
  }

  /** Все имена узлов (для fuzzy-поиска). */
  private getAllNodeNames(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT name FROM nodes').all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }
}
