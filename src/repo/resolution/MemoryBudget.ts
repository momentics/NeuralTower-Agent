/**
 * Запас памяти для определения размера пула рабочих — cgroup-честный на Linux,
 * reclaim-честный на macOS.
 *
 * `os.freemem()` читает /proc/meminfo, который внутри контейнера сообщает
 * память ХОСТА (или ВМ), а не cgroup — та же слепота, что и у os.cpus()
 * для cpusets. Пул резолверов, размер которого определяется только по ядрам,
 * убивал индекс ядра в контейнере с лимитом 7 ГБ (oom_kill=5, шесть рабочих
 * по ~1 ГБ при реальной 8-ядерной конкурентности), поэтому определение
 * размера пула сочетает CPU-член с запасом памяти, который сообщает этот модуль.
 *
 * На macOS `os.freemem()` имеет ПРОТИВОПОЛОЖНУЮ ошибку: считает только
 * `free_count` страницы, а macOS намеренно держит RAM полную reclaimable
 * кэша — на в основном простоявшем 64 ГБ компьютере читается ~1 ГБ «свободно»,
 * так что memory-член ограничивал пул резолверов 2 рабочими, где CPU-член
 * позволял 6. `darwinMemoryAvailable` сообщает то, что Activity Monitor
 * называет доступным — свободные + неактивные + спекулятивные + purgeable
 * страницы — та же reclaimable-inclusive конвенция, которую использует
 * Linux-ветвь, crediting `inactive_file` обратно.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

/** Парсит файл значения cgroup: число байт, или null при отсутствии/'max'. */
function readCgroupBytes(path: string): number | null {
  try {
    const raw = fs.readFileSync(path, 'utf8').trim();
    if (raw === 'max') return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/** `inactive_file` из файла memory.stat cgroup — reclaimable page cache. */
function readInactiveFile(statPath: string): number {
  try {
    const m = /^inactive_file (\d+)$/m.exec(fs.readFileSync(statPath, 'utf8'));
    return m ? Number.parseInt(m[1]!, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Доступный запас под лимитом памяти cgroup (v2 затем v1), или null
 * при отсутствии ограничений (нет лимита, не-Linux, или невозможно прочитать).
 * Никогда не выбрасывает исключение.
 *
 * Reclaimable page cache (`inactive_file`) crediting обратно: `memory.current`
 * считает его как использование, но ядро reclaim его по требованию — после
 * массового парсинга кэш забит страницами собственной БД, и наивное
 * `max − current` читало 57 МБ запаса на 6 ГБ контейнере и молча отключало
 * пул резолверов. Это та же working-set конвенция, которую использует
 * `docker stats`.
 */
export function cgroupMemoryAvailable(): number | null {
  if (process.platform !== 'linux') return null;
  // v2 unified hierarchy
  const v2Max = readCgroupBytes('/sys/fs/cgroup/memory.max');
  if (v2Max !== null) {
    const current = readCgroupBytes('/sys/fs/cgroup/memory.current') ?? 0;
    const reclaimable = readInactiveFile('/sys/fs/cgroup/memory.stat');
    return Math.max(0, v2Max - Math.max(0, current - reclaimable));
  }
  // v1
  const v1Limit = readCgroupBytes('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  // v1 сообщает «нет лимита» как огромное sentinel (~PAGE_COUNTER_MAX);
  // считаем всё на уровне или выше половины адресного пространства как неограниченное.
  if (v1Limit !== null && v1Limit < 2 ** 60) {
    const usage = readCgroupBytes('/sys/fs/cgroup/memory/memory.usage_in_bytes') ?? 0;
    const reclaimable = readInactiveFile('/sys/fs/cgroup/memory/memory.stat');
    return Math.max(0, v1Limit - Math.max(0, usage - reclaimable));
  }
  return null;
}

/**
 * Reclaimable-inclusive доступная память на macOS, или null в другом месте /
 * при любой ошибке парсинга (→ вызывающие коды fallback на `os.freemem()`).
 * Читает `/usr/bin/vm_stat` — стабильный публичный интерфейс над host_statistics64 —
 * один раз за вызов (определение размера пула запускает его один раз при инициализации;
 * несколько мс). Никогда не выбрасывает исключение.
 */
export function darwinMemoryAvailable(): number | null {
  if (process.platform !== 'darwin') return null;
  try {
    const out = execFileSync('/usr/bin/vm_stat', { encoding: 'utf8', timeout: 2000 });
    const pageMatch = /page size of (\d+) bytes/.exec(out);
    const pageSize = pageMatch ? Number.parseInt(pageMatch[1]!, 10) : 16384;
    const count = (label: string): number => {
      const m = new RegExp(`^${label}:\\s+(\\d+)`, 'm').exec(out);
      return m ? Number.parseInt(m[1]!, 10) : 0;
    };
    const pages =
      count('Pages free') +
      count('Pages inactive') +
      count('Pages speculative') +
      count('Pages purgeable');
    const bytes = pages * pageSize;
    return bytes > 0 && Number.isFinite(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Бюджет: меньший из свободной памяти системы и запаса cgroup (при наличии
 * ограничений), с reclaimable-inclusive чтением macOS вместо слишком малого
 * darwin `freemem`. Консервативный по конструкции — каждое число уменьшается
 * по мере роста самого процесса.
 */
export function memoryBudgetBytes(): number {
  const free = os.freemem();
  const cgroup = cgroupMemoryAvailable();
  if (cgroup !== null) return Math.min(free, cgroup);
  // darwinAvailable ⊇ free по конструкции (сумма включает свободные страницы);
  // max() защищает от гипотетического недоучёта парсинга.
  const darwin = darwinMemoryAvailable();
  return darwin === null ? free : Math.max(free, darwin);
}
