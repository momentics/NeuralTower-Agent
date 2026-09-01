import * as fs from "fs/promises"
import * as path from "path"
import { createDomainLogger } from "../core/Logger"
import { errorMessage } from "../core/Errors"

const log = createDomainLogger("Truncate")

/** Число символов, сохраняемых в начале обрезанного вывода. */
export const TRUNCATE_KEEP_HEAD = 24_000
/** Число символов, сохраняемых в конце обрезанного вывода. */
export const TRUNCATE_KEEP_TAIL = 3_000
/** Маркер строки с путём к полному выводу (используется компактизацией). */
export const FULL_OUTPUT_MARKER = "Полный вывод:"

/**
 * Обрезатель вывода инструментов.
 *
 * Если длина вывода не превышает лимит — возвращается как есть.
 * Более длинный вывод обрезается (начало + конец), а полный текст
 * сохраняется в файл в директории выводов: модель может перечитать
 * его инструментом read_file по указанному пути.
 */
export class ToolOutputTruncator {
  constructor(
    private readonly getOutputDir: () => string | null,
    private readonly getLimit: () => number,
  ) {}

  /**
   * Обрезать вывод при необходимости.
   * @param output полный вывод инструмента
   * @param callId идентификатор вызова (используется для имени файла)
   */
  async truncate(output: string, callId: string): Promise<string> {
    const limit = this.getLimit()
    if (output.length <= limit) return output

    const head = output.slice(0, TRUNCATE_KEEP_HEAD)
    const tail = output.slice(-TRUNCATE_KEEP_TAIL)

    const dir = this.getOutputDir()
    if (dir) {
      try {
        await fs.mkdir(dir, { recursive: true })
        const file = path.join(dir, `${sanitizeCallId(callId)}.txt`)
        await fs.writeFile(file, output, "utf-8")
        return (
          head +
          `\n\n… [вывод обрезан: показано ${TRUNCATE_KEEP_HEAD + TRUNCATE_KEEP_TAIL} из ${output.length} символов] …\n\n` +
          `${FULL_OUTPUT_MARKER} ${file}\n` +
          tail
        )
      } catch (err: unknown) {
        log.warn(`Полный вывод не сохранён в файл: ${errorMessage(err)}`)
      }
    }

    return head + `\n\n… [вывод обрезан: всего ${output.length} символов] …\n\n` + tail
  }
}

/** Сделать id вызова безопасным для имени файла. */
function sanitizeCallId(id: string): string {
  const s = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)
  return s || "output"
}
