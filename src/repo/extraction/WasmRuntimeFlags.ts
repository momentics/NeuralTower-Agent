/**
 * WASM-флаги времени выполнения — обход OOM в V8 turboshaft.
 *
 * Грамматики tree-sitter — большие WebAssembly-модули. На Node >= 22
 * оптимизирующий WASM-компилятор V8 "turboshaft" может исчерпать
 * свою зону при компиляции этих грамматик, аварийно завершая процесс
 * с `Fatal process out of memory: Zone`.
 *
 * `--liftoff-only` заставляет каждый WASM-модуль использовать
 * базовый компилятор Liftoff, что устраняет краш.
 */

import { spawnSync } from 'child_process';

/**
 * Флаги V8, которые держат компиляцию грамматик tree-sitter
 * за пределами оптимизирующего уровня turboshaft.
 */
export const WASM_RUNTIME_FLAGS: readonly string[] = ['--liftoff-only'];

/**
 * Опции CLI Node, передаваемые вместе с WASM-флагами при каждом запуске.
 */
export function nodeRuntimeFlagsFor(nodeVersion: string): readonly string[] {
  const [major = 0, minor = 0] = nodeVersion.split('.').map(Number);
  const supported = major > 21 || (major === 21 && minor >= 3) || (major === 20 && minor >= 11);
  return supported ? ['--disable-warning=ExperimentalWarning'] : [];
}

export const NODE_RUNTIME_FLAGS: readonly string[] = nodeRuntimeFlagsFor(process.versions.node);

/** Переменная окружения для защиты от бесконечного цикла перезапуска. */
const RELAUNCH_GUARD_ENV = 'CODEGRAPH_WASM_RELAUNCHED';

/** Переменная окружения с PID хоста через перезапуск. */
export const HOST_PPID_ENV = 'CODEGRAPH_HOST_PPID';

/** Истина, когда все требуемые WASM-флаги уже присутствуют в execArgv. */
export function processHasWasmRuntimeFlags(
  execArgv: readonly string[] = process.execArgv
): boolean {
  return WASM_RUNTIME_FLAGS.every((flag) => execArgv.includes(flag));
}

/**
 * Построение argv для перезапуска node с WASM-флагами.
 */
export function buildRelaunchArgv(
  scriptPath: string,
  scriptArgs: readonly string[],
  execArgv: readonly string[] = process.execArgv
): string[] {
  const preserved = execArgv.filter(
    (arg) => !WASM_RUNTIME_FLAGS.includes(arg) && !NODE_RUNTIME_FLAGS.includes(arg)
  );
  return [...NODE_RUNTIME_FLAGS, ...WASM_RUNTIME_FLAGS, ...preserved, scriptPath, ...scriptArgs];
}

/**
 * Если текущий процесс не имеет WASM-флагов, перезапускает его один раз
 * с ними и завершается со статусом дочернего процесса.
 */
export function relaunchWithWasmRuntimeFlagsIfNeeded(scriptPath: string): void {
  if (processHasWasmRuntimeFlags()) return;
  if (process.env[RELAUNCH_GUARD_ENV]) return;
  if (process.env.CODEGRAPH_NO_RELAUNCH) return;

  const argv = buildRelaunchArgv(scriptPath, process.argv.slice(2));
  const result = spawnSync(process.execPath, argv, {
    stdio: 'inherit',
    env: { ...process.env, [RELAUNCH_GUARD_ENV]: '1', [HOST_PPID_ENV]: String(process.ppid) },
    windowsHide: true,
  });

  if (result.error) {
    return;
  }
  process.exit(result.status ?? (result.signal ? 1 : 0));
}
