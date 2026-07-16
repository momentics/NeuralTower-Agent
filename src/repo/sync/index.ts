/**
 * Модуль синхронизации
 *
 * Предоставляет функциональность синхронизации для поддержания
 * актуальности графа кода с изменениями файловой системы.
 *
 * Компоненты:
 * - FileWatcher: Дебаунсированный fs.watch, который автоматически запускает
 *   синхронизацию при изменениях файлов
 * - Политика наблюдения: решает, когда наблюдатель должен быть отключён
 *   (например, WSL2 /mnt)
 * - Git-хуки синхронизации: опциональные хуки commit/merge/checkout,
 *   когда наблюдение отключено
 * - Хэширование содержимого для обнаружения изменений (в модуле экстракции)
 * - Инкрементальная переиндексация (в модуле экстракции)
 */

export { FileWatcher, WatchOptions, PendingFile, LockUnavailableError } from './Watcher';
export { watchDisabledReason, detectWsl } from './WatchPolicy';
export {
  installGitSyncHook,
  removeGitSyncHook,
  isSyncHookInstalled,
  isGitRepo,
  DEFAULT_SYNC_HOOKS,
  type GitHookName,
  type GitHookResult,
} from './GitHooks';
