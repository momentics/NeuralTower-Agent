import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { fetchUrl, htmlToText } from "../../network/UrlFetcher"

const FETCH_DEFAULT_TIMEOUT_S = 30
const FETCH_MAX_LENGTH = 8000

/**
 * Получить содержимое URL и вернуть в формате Markdown или текста.
 */
export class WebFetchTool implements ITool {
  name = "web_fetch"
  description = "Получить содержимое по URL. Форматы ответа: markdown, text, html."
  category = "network"
  isSafe = true

  schema: ToolSchema = {
    name: "web_fetch",
    description: "Получить содержимое веб-страницы",
    parameters: {
      url: { type: "string", description: "URL для загрузки" },
      format: { type: "string", description: "Формат вывода", enum: ["markdown", "text", "html"], default: "markdown" },
      timeout: { type: "number", description: "Тайм-аут в секундах", default: FETCH_DEFAULT_TIMEOUT_S },
    },
    required: ["url"],
  }

  async execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) return { output: "Операция отменена", success: false }
    const url = String(args.url ?? "")
    if (!url) return { output: "Не указан URL", success: false }

    const format = (args.format as string | undefined) ?? "markdown"
    const timeoutSec = Number(args.timeout ?? FETCH_DEFAULT_TIMEOUT_S) || FETCH_DEFAULT_TIMEOUT_S

    const result = await fetchUrl(url, {
      timeout: timeoutSec * 1000,
      maxLength: FETCH_MAX_LENGTH,
      signal,
    })

    if (!result.ok) {
      if (result.status === 0) {
        return { output: result.text, success: false }
      }
      return { output: `HTTP ${result.status}`, success: false }
    }

    let output = result.text
    if (format === "text") {
      output = htmlToText(result.text)
    }

    return { output, success: true }
  }
}
