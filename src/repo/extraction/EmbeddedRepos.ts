import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
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
      const stat = await fsPromises.stat(markerPath);
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
    const entries = await fsPromises.readdir(currentDir, { withFileTypes: true });

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
export async function discoverEmbeddedRepoRoots(
  projectRoot: string,
): Promise<string[]> {
  const results: string[] = [];

  await scanDir(projectRoot, 0, results);

  return results;
}

/**
 * Классификация .git директории.
 * Возвращает 'worktree' если это git worktree (gitdir указывает наружу),
 * 'embedded' для обычного вложенного репозитория, 'none' если это не git.
 */
export function classifyGitDir(absDir: string): 'embedded' | 'worktree' | 'none' {
  try {
    const gitPath = path.join(absDir, '.git');
    const stat = fs.statSync(gitPath);

    if (stat.isDirectory()) {
      // Обычная .git директория — проверяем на worktree
      const gitdirPath = path.join(gitPath, 'gitdir');
      try {
        const gitdirContent = fs.readFileSync(gitdirPath, 'utf-8').trim();
        const gitdirResolved = path.resolve(path.dirname(gitdirPath), gitdirContent);
        const absDirResolved = path.resolve(absDir);

        // Если gitdir указывает на директорию вне текущего .git, это worktree
        if (!gitdirResolved.startsWith(path.join(gitPath, path.sep)) && gitdirResolved !== gitPath) {
          return 'worktree';
        }
      } catch {
        // gitdir не найден — обычный embedded репозиторий
      }
      return 'embedded';
    }

    if (stat.isFile()) {
      // .git — файл (bare repo или worktree)
      const content = fs.readFileSync(gitPath, 'utf-8').trim();
      if (content.startsWith('gitdir:')) {
        const gitdirTarget = content.slice(7).trim();
        const gitdirResolved = path.resolve(path.dirname(gitPath), gitdirTarget);
        const absDirResolved = path.resolve(absDir);

        if (!gitdirResolved.startsWith(absDirResolved)) {
          return 'worktree';
        }
        return 'embedded';
      }
      return 'embedded';
    }

    return 'none';
  } catch {
    return 'none';
  }
}

/**
 * BFS-поиск вложенных git репозиториев.
 * Ограничен по глубине (EMBEDDED_REPO_SEARCH_DEPTH = 4) и числу записей (EMBEDDED_REPO_SEARCH_ENTRIES = 2000).
 * Пропускает директории из DEFAULT_IGNORE_DIRS.
 * Возвращает массив относительных путей к обнаруженным вложенным git репозиториям.
 */
export function findNestedGitRepos(absDir: string, relPrefix: string): string[] {
  const results: string[] = [];
  const queue: Array<{ dir: string; rel: string; depth: number }> = [];
  let entriesScanned = 0;

  queue.push({ dir: absDir, rel: relPrefix, depth: 0 });

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.depth > EMBEDDED_REPO_SEARCH_DEPTH) continue;

    if (entriesScanned > EMBEDDED_REPO_SEARCH_ENTRIES) break;

    try {
      const entries = fs.readdirSync(current.dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        entriesScanned++;

        if (DEFAULT_IGNORE_DIRS.has(entry.name)) continue;

        if (entry.name === '.git') continue;

        const fullPath = path.join(current.dir, entry.name);
        const fullRel = current.rel ? `${current.rel}/${entry.name}` : entry.name;

        // Проверяем, есть ли .git в этой директории
        const gitPath = path.join(fullPath, '.git');
        try {
          const gitStat = fs.statSync(gitPath);
          if (gitStat.isDirectory() || gitStat.isFile()) {
            const classification = classifyGitDir(fullPath);
            if (classification === 'embedded') {
              results.push(fullRel);
            }
          }
        } catch {
          // .git не найден
        }

        if (entriesScanned <= EMBEDDED_REPO_SEARCH_ENTRIES) {
          queue.push({ dir: fullPath, rel: fullRel, depth: current.depth + 1 });
        }
      }
    } catch {
      // Ошибка чтения директории — пропускаем
    }
  }

  return results;
}

/**
 * Поиск вложенных репозиториев в gitignored директориях.
 * Например, vendor/ в Go проектах содержит внешние зависимости с собственными .git.
 * Возвращает массив путей к обнаруженным репозиториям.
 */
export function findIgnoredEmbeddedRepos(repoDir: string): string[] {
  const results: string[] = [];
  const ignoredDirs = new Set(DEFAULT_IGNORE_DIRS);

  try {
    const entries = fs.readdirSync(repoDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      if (!ignoredDirs.has(entry.name)) continue;

      const fullPath = path.join(repoDir, entry.name);

      // Проверяем, есть ли .git в этой директории
      const gitPath = path.join(fullPath, '.git');
      try {
        const gitStat = fs.statSync(gitPath);
        if (gitStat.isDirectory() || gitStat.isFile()) {
          const classification = classifyGitDir(fullPath);
          if (classification === 'embedded') {
            results.push(`${entry.name}`);
          }
        }
      } catch {
        // .git не найден
      }

      // Рекурсивный поиск в поддиректориях игнорируемой директории
      const nested = findNestedGitRepos(fullPath, "");
      for (const nestedRel of nested) {
        results.push(`${entry.name}/${nestedRel}`);
      }
    }
  } catch {
    // Ошибка чтения директории — пропускаем
  }

  return results;
}
