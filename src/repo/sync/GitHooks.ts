/**
 * Git-хуки синхронизации
 *
 * Когда живой файловый наблюдатель отключён (например, на WSL2 /mnt/* дисках,
 * см. WatchPolicy.ts), индекс NtGraph в противном случае устареет, пока
 * пользователь вручную не запустит `ntgraph sync`. В качестве опциональной
 * альтернативы мы можем установить git-хуки, которые обновляют индекс после
 * операций, изменяющих файлы на диске: commit, merge (покрывает `git pull`),
 * и checkout.
 *
 * Хуки запускают `ntgraph sync` в фоновом режиме, чтобы никогда не блокировать
 * git, и защищены проверкой `command -v ntgraph`, чтобы безопасно
 * пропускаться, когда CLI нет в PATH. Наш фрагмент ограничен маркерными
 * комментариями, чтобы установка была идемпотентной, а удаление сохраняло
 * любой пользовательский контент хука.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const MARKER_BEGIN = '# >>> ntgraph sync hook >>>';
const MARKER_END = '# <<< ntgraph sync hook <<<';

export type GitHookName = 'post-commit' | 'post-merge' | 'post-checkout';

/** Хуки, устанавливаемые по умолчанию: commit, merge (git pull), и checkout. */
export const DEFAULT_SYNC_HOOKS: GitHookName[] = ['post-commit', 'post-merge', 'post-checkout'];

export interface GitHookResult {
  /** Имена хуков, которые были созданы или обновлены. */
  installed: GitHookName[];
  /** Разрешённая директория хуков, или null, если не git-репозиторий. */
  hooksDir: string | null;
  /** Причина, почему ничего не произошло (например, не git-репозиторий). */
  skipped?: string;
}

/**
 * Указывает, находится ли `projectRoot` внутри рабочей области git.
 * Возвращает false, если git не установлен или путь не является репозиторием.
 */
export function isGitRepo(projectRoot: string): boolean {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 5000,
    }).trim();
    return out === 'true';
  } catch {
    return false;
  }
}

/**
 * Разрешает директорию git-хуков для проекта, учитывая `core.hooksPath`
 * и git worktrees. Возвращает абсолютный путь, или null, если не репозиторий.
 */
function gitHooksDir(projectRoot: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 5000,
    }).trim();
    if (!out) return null;
    return path.isAbsolute(out) ? out : path.resolve(projectRoot, out);
  } catch {
    return null;
  }
}

/** Шелл-фрагмент (между маркерами), внедряемый в каждый хук. */
function markerBlock(): string {
  return [
    MARKER_BEGIN,
    '# Поддерживает актуальность индекса NtGraph, когда живой файловый наблюдатель отключён',
    '# (например, WSL2 /mnt диски). Запускается в фоновом режиме, чтобы никогда не блокировать git.',
    '# Управляется ntgraph; удалите с помощью `ntgraph uninit` или удалите этот блок.',
    'if command -v ntgraph >/dev/null 2>&1; then',
    '  ( ntgraph sync >/dev/null 2>&1 & ) >/dev/null 2>&1',
    'fi',
    MARKER_END,
  ].join('\n');
}

/** Удаляет наш маркерный блок (и маркерные строки) из содержимого хука. */
function stripMarkerBlock(content: string): string {
  const lines = content.split('\n');
  const kept: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === MARKER_BEGIN) { inBlock = true; continue; }
    if (trimmed === MARKER_END) { inBlock = false; continue; }
    if (!inBlock) kept.push(line);
  }
  return kept.join('\n');
}

/** Указывает, является ли тело хука просто shebang / пустыми строками. */
function isEffectivelyEmpty(content: string): boolean {
  return content
    .split('\n')
    .map((l) => l.trim())
    .every((l) => l.length === 0 || l.startsWith('#!'));
}

function chmodExecutable(file: string): void {
  try {
    fs.chmodSync(file, 0o755);
  } catch {
    /* chmod не работает / не поддерживается на некоторых платформах (например, Windows) */
  }
}

/**
 * Устанавливает (или обновляет) хуки синхронизации NtGraph в git-репозитории.
 * Идемпотентно: повторный запуск заменяет наш маркерный блок, а не дублирует
 * его, и любой пользовательский контент хука сохраняется.
 */
export function installGitSyncHook(
  projectRoot: string,
  hooks: GitHookName[] = DEFAULT_SYNC_HOOKS,
): GitHookResult {
  const hooksDir = gitHooksDir(projectRoot);
  if (!hooksDir) {
    return { installed: [], hooksDir: null, skipped: 'не является git-репозиторием' };
  }

  try {
    fs.mkdirSync(hooksDir, { recursive: true });
  } catch {
    return { installed: [], hooksDir, skipped: 'не удалось получить доступ к директории git-хуков' };
  }

  const block = markerBlock();
  const installed: GitHookName[] = [];

  for (const hook of hooks) {
    const file = path.join(hooksDir, hook);
    let content: string;

    if (fs.existsSync(file)) {
      // Удаляем любой предыдущий блок, затем повторно добавляем текущий.
      const base = stripMarkerBlock(fs.readFileSync(file, 'utf8')).replace(/\s*$/, '');
      content = base.length > 0
        ? `${base}\n\n${block}\n`
        : `#!/bin/sh\n${block}\n`;
    } else {
      content = `#!/bin/sh\n${block}\n`;
    }

    fs.writeFileSync(file, content);
    chmodExecutable(file);
    installed.push(hook);
  }

  return { installed, hooksDir };
}

/**
 * Удаляет хуки синхронизации NtGraph. Удаляет только наш маркерный блок;
 * удаляет файл хука полностью, когда остался только shebang, в противном
 * случае перезаписывает пользовательский контент без изменений.
 */
export function removeGitSyncHook(
  projectRoot: string,
  hooks: GitHookName[] = DEFAULT_SYNC_HOOKS,
): GitHookResult {
  const hooksDir = gitHooksDir(projectRoot);
  if (!hooksDir) {
    return { installed: [], hooksDir: null, skipped: 'не является git-репозиторием' };
  }

  const removed: GitHookName[] = [];

  for (const hook of hooks) {
    const file = path.join(hooksDir, hook);
    if (!fs.existsSync(file)) continue;

    const original = fs.readFileSync(file, 'utf8');
    if (!original.includes(MARKER_BEGIN)) continue;

    const stripped = stripMarkerBlock(original);
    if (isEffectivelyEmpty(stripped)) {
      fs.unlinkSync(file);
    } else {
      fs.writeFileSync(file, `${stripped.replace(/\s*$/, '')}\n`);
      chmodExecutable(file);
    }
    removed.push(hook);
  }

  return { installed: removed, hooksDir };
}

/** Указывает, установлен ли какой-либо хук синхронизации NtGraph. */
export function isSyncHookInstalled(
  projectRoot: string,
  hooks: GitHookName[] = DEFAULT_SYNC_HOOKS,
): boolean {
  const hooksDir = gitHooksDir(projectRoot);
  if (!hooksDir) return false;
  return hooks.some((hook) => {
    const file = path.join(hooksDir, hook);
    return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(MARKER_BEGIN);
  });
}
