/**
 * Политика наблюдения
 *
 * Определяет, следует ли запускать файловый наблюдатель для данного проекта.
 *
 * Нативный рекурсивный `fs.watch` на WSL2 /mnt/* дисках работает
 * катастрофически медленно: установка рекурсивного наблюдения обходит
 * дерево директорий, и каждый readdir/stat пересекает границу Windows.
 * Внутри MCP-сервера это блокирует цикл событий на время запуска, что
 * приводит к превышению таймаутов рукопожатия (30с для opencode), из-за
 * чего инструменты не появляются. См. issue #199.
 *
 * Этот модуль централизует решение вкл/выкл, чтобы наблюдатель, MCP-сервер
 * (для диагностики) и установщик были согласованы.
 */

import * as fs from 'fs';
import { normalizePath } from '../ntgraph/Utils';

let wslChecked = false;
let wslValue = false;

/**
 * Определяет, работает ли текущий процесс под WSL (Windows
 * Subsystem for Linux). Результат кэшируется после первого вызова.
 *
 * Сначала проверяет WSL-специфичные переменные окружения (без I/O),
 * затем обращается к `/proc/version`, который содержит "microsoft"
 * на WSL-ядрах.
 */
export function detectWsl(): boolean {
  if (wslChecked) return wslValue;
  wslChecked = true;

  if (process.platform !== 'linux') {
    wslValue = false;
    return wslValue;
  }
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
    wslValue = true;
    return wslValue;
  }
  try {
    const version = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
    wslValue = version.includes('microsoft') || version.includes('wsl');
  } catch {
    wslValue = false;
  }
  return wslValue;
}

/**
 * Верно для WSL-монтированных дисков Windows, таких как `/mnt/c` или `/mnt/d/project`.
 * Намеренно совпадает только с однобуквенными дисками, чтобы настоящие
 * быстрые Linux-монтирования вроде `/mnt/wsl/...` не помечались.
 */
function isWindowsDriveMount(projectRoot: string): boolean {
  return /^\/mnt\/[a-z](\/|$)/i.test(normalizePath(projectRoot));
}

/**
 * Входы, которые можно переопределить в тестах, чтобы решение было
 * детерминированным без изменения реальных переменных окружения
 * или `/proc/version`.
 */
export interface WatchProbe {
  /** По умолчанию `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** По умолчанию `detectWsl()`. */
  isWsl?: boolean;
}

/**
 * Определяет, следует ли отключить файловый наблюдатель для проекта, и почему.
 *
 * Возвращает короткую читаемую причину, когда наблюдение нужно пропустить, или
 * `null`, когда оно должно работать нормально.
 *
 * Приоритет (первое совпадение побеждает):
 *  1. `NTGRAPH_NO_WATCH=1`    → выкл (явный отказ всегда побеждает)
 *  2. `NTGRAPH_FORCE_WATCH=1` → вкл  (переопределяет автоопределение)
 *  3. WSL2 + `/mnt/*` диск    → выкл (рекурсивный fs.watch слишком медленный; #199)
 */
export function watchDisabledReason(projectRoot: string, probe: WatchProbe = {}): string | null {
  const env = probe.env ?? process.env;

  if (env.NTGRAPH_NO_WATCH === '1') {
    return 'Установлен NTGRAPH_NO_WATCH=1';
  }
  if (env.NTGRAPH_FORCE_WATCH === '1') {
    return null;
  }

  const isWsl = probe.isWsl ?? detectWsl();
  if (isWsl && isWindowsDriveMount(projectRoot)) {
    return 'проект находится на диске WSL2 /mnt/, где рекурсивный fs.watch слишком медленный для надёжной работы';
  }

  return null;
}

/** Только для тестов: сброс кэша определения WSL. */
export function __resetWslCacheForTests(): void {
  wslChecked = false;
  wslValue = false;
}
