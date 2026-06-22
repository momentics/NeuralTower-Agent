/**
 * Интерфейс логгера для структурированного вывода сообщений.
 *
 * Заменяет рассеянные console.error/console.warn на единый
 * механизм, который можно перенаправить в канал вывода VS Code,
 * телеметрию или любой другой приёмник.
 */
export interface ILogger {
  /** Сообщения об ошибках. */
  error(domain: string, message: string, context?: unknown): void

  /** Предупреждения. */
  warn(domain: string, message: string, context?: unknown): void

  /** Информационные сообщения. */
  info(domain: string, message: string, context?: unknown): void
}

/**
 * Логгер по умолчанию — выводит в console.error / console.warn / console.log.
 * Используется до инициализации реального логгера.
 */
class DefaultLogger implements ILogger {
  error(domain: string, message: string, context?: unknown): void {
    const ctx = context !== undefined ? ` — ${JSON.stringify(context)}` : ""
    console.error(`[${domain}] ОШИБКА: ${message}${ctx}`)
  }

  warn(domain: string, message: string, context?: unknown): void {
    const ctx = context !== undefined ? ` — ${JSON.stringify(context)}` : ""
    console.warn(`[${domain}] ПРЕДУПРЕЖДЕНИЕ: ${message}${ctx}`)
  }

  info(domain: string, message: string, context?: unknown): void {
    const ctx = context !== undefined ? ` — ${JSON.stringify(context)}` : ""
    console.log(`[${domain}] ${message}${ctx}`)
  }
}

/**
 * Глобальный экземпляр логгера. Инициализируется при старте
 * расширения и переназначается на реализацию с выводом в VS Code.
 */
let globalLogger: ILogger = new DefaultLogger()

/**
 * Вернуть текущий логгер.
 */
export function getLogger(): ILogger {
  return globalLogger
}

/**
 * Заместить логгер (вызывается один раз при инициализации).
 */
export function setLogger(logger: ILogger): void {
  globalLogger = logger
}

/**
 * Создать логгер, привязанный к домену (например, "MCP", "Git").
 * Удобно передавать в конструкторы вместо явного указания домена.
 */
export function createDomainLogger(domain: string): Omit<ILogger, "error" | "warn" | "info"> & {
  error: (message: string, context?: unknown) => void
  warn: (message: string, context?: unknown) => void
  info: (message: string, context?: unknown) => void
} {
  const logger = getLogger()
  return {
    error: (message: string, context?: unknown) => logger.error(domain, message, context),
    warn: (message: string, context?: unknown) => logger.warn(domain, message, context),
    info: (message: string, context?: unknown) => logger.info(domain, message, context),
  }
}
