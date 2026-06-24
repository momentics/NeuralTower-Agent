/**
 * FTS5-поиск с трёхуровневым fallback.
 *
 * FTS5 → LIKE → Fuzzy, BM25 с весами, over-fetch x5, rescoring,
 * exact-match supplement, экранирование спецсимволов.
 */

import { SqliteDatabase } from './Adapter';
import {
  NodeKind,
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
import {
  FTS_OVER_FETCH_MULTIPLIER,
  FTS_LIMIT_MIN,
  EXACT_MATCH_SUPPLEMENT_LIMIT,
  FUZZY_MAX_DIST_SHORT,
  FUZZY_MAX_DIST_DEFAULT,
} from './Types';

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
    const { kinds, languages, limit = 100, offset = 0 } = options;

    // Уровень 1: FTS5
    let results = this.searchFTS(query, { kinds, languages, limit, offset });

    // Уровень 2: LIKE
    if (results.length === 0 && query.length >= 2) {
      results = this.searchLIKE(query, { kinds, languages, limit, offset });
    }

    // Уровень 3: Fuzzy
    if (results.length === 0 && query.length >= 3) {
      results = this.searchFuzzy(query, { kinds, languages, limit });
    }

    // Точное дополнение по имени
    if (results.length > 0 && query) {
      results = this.supplementExactMatches(query, results, kinds, languages);
    }

    // Rescoring
    if (results.length > 0) {
      results = this.rescore(results, query);
      results.sort((a, b) => b.score - a.score);
      if (results.length > limit) {
        results = results.slice(0, limit);
      }
    }

    return results;
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
  searchLIKE(query: string, options: IFtsSearchOptions): ISearchResult[] {
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
    options: { kinds?: NodeKind[]; languages?: string[]; limit: number }
  ): ISearchResult[] {
    const { kinds, languages, limit } = options;
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
    return results.map(r => ({
      ...r,
      score: r.score
        + kindBonus(r.node.kind)
        + scorePathRelevance(r.node.filePath, query, this.projectNameTokens)
        + nameMatchBonus(r.node.name, query),
    }));
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
