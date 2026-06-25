import * as fs from 'fs/promises';
import * as path from 'path';
import {
  EMBEDDED_REPO_SEARCH_DEPTH,
  EMBEDDED_REPO_SEARCH_ENTRIES,
  DEFAULT_IGNORE_DIRS,
} from '../ntgraph/Types';

/** Маркеры, по которым определяется репозиторий. */
const REPO_MARKERS = [
  '.git',
  'package.json',
  'go.mod',
  'Cargo.toml',
  'build.gradle',
  'pom.xml',
];

/**
 * Проверяет, содержит ли директория маркеры репозитория.
 */
async function isRepo(dir: string): Promise<boolean> {
  for (const marker of REPO_MARKERS) {
    const markerPath = path.join(dir, marker);
    try {
      const stat = await fs.stat(markerPath);
      if (marker === '.git') {
        if (stat.isDirectory()) return true;
      } else {
        if (stat.isFile()) return true;
      }
    } catch {
      // Маркер не найден — продолжаем проверку остальных.
    }
  }
  return false;
}

/**
 * Рекурсивно ищет вложенные репозитории в директории.
 *
 * @param currentDir — текущая директория обхода
 * @param depth — текущая глубина (0 = корень)
 * @param results — накопленный массив путей к найденным репозиториям
 */
async function scanDir(
  currentDir: string,
  depth: number,
  results: string[],
): Promise<void> {
  if (depth > EMBEDDED_REPO_SEARCH_DEPTH) return;

  try {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    const dirs: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const name = entry.name;

      if (DEFAULT_IGNORE_DIRS.has(name)) continue;

      const fullPath = path.join(currentDir, name);

      if (await isRepo(fullPath)) {
        results.push(fullPath);
      }

      dirs.push(fullPath);
    }

    if (dirs.length > EMBEDDED_REPO_SEARCH_ENTRIES) {
      dirs.length = EMBEDDED_REPO_SEARCH_ENTRIES;
    }

    for (const dir of dirs) {
      await scanDir(dir, depth + 1, results);
    }
  } catch {
    // Ошибка чтения директории — пропускаем.
  }
}

/**
 * Обнаруживает вложенные репозитории в проекте.
 *
 * Обход выполняется до EMBEDDED_REPO_SEARCH_DEPTH уровней,
 * не более EMBEDDED_REPO_SEARCH_ENTRIES записей на каждом уровне.
 * Директории из DEFAULT_IGNORE_DIRS исключаются из обхода.
 *
 * @param projectRoot — корневая директория проекта
 * @returns массив абсолютных путей к обнаруженным вложенным репозиториям
 */
export async function discoverEmbeddedRepos(
  projectRoot: string,
): Promise<string[]> {
  const results: string[] = [];

  await scanDir(projectRoot, 0, results);

  return results;
}
