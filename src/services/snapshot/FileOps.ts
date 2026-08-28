import * as fs from "fs/promises"
import { createDomainLogger } from "../../core/Logger"

const log = createDomainLogger("FileOps")

const RETRYABLE_CODES = new Set(["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"])
const REMOVE_ATTEMPTS = 3
const REMOVE_DELAY_MS = 300

/**
 * Удалить файл с повторными попытками при ошибках блокировки (Windows).
 * Остальные ошибки пробрасываются сразу.
 */
export async function removeFileWithRetry(absPath: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rm(absPath, { force: true })
      return
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt >= REMOVE_ATTEMPTS || !RETRYABLE_CODES.has(code ?? "")) throw err
      log.warn(`Файл занят (${code}), попытка ${attempt} из ${REMOVE_ATTEMPTS}: ${absPath}`)
      await new Promise((r) => setTimeout(r, REMOVE_DELAY_MS))
    }
  }
}
