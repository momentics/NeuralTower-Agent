import type { IToolSchema } from "../ITool"
import type { IToolResult } from "../../agent/AgentTypes"
import { fetchUrl, htmlToText } from "../../network/UrlFetcher"
import { BaseTool } from "./BaseTool"
import { str, strOpt, num, clamp } from "../ToolArgs"

const FETCH_DEFAULT_TIMEOUT_S = 30
const FETCH_MAX_LENGTH = 8000
const FETCH_MIN_TIMEOUT_S = 1
const FETCH_MAX_TIMEOUT_S = 120

/**
 * Получить содержимое URL и вернуть в формате Markdown или текста.
 */
export class WebFetchTool extends BaseTool {
  name = "web_fetch"
  description = "Получить содержимое по URL. Форматы ответа: markdown, text, html."
  category = "network"
  isSafe = true

  schema: IToolSchema = {
    name: "web_fetch",
    description: "Получить содержимое веб-страницы",
    parameters: {
      url: { type: "string", description: "URL для загрузки" },
      format: { type: "string", description: "Формат вывода", enum: ["markdown", "text", "html"], default: "markdown" },
      timeout: { type: "number", description: "Тайм-аут в секундах", default: FETCH_DEFAULT_TIMEOUT_S },
    },
    required: ["url"],
  }

  protected async doExecute(args: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult> {
    const url = str(args, "url")
    if (!url) return { output: "Не указан URL", success: false }

    const format = strOpt(args, "format") ?? "markdown"
    const rawTimeout = num(args, "timeout", FETCH_DEFAULT_TIMEOUT_S)
    const timeoutSec = clamp(rawTimeout, FETCH_MIN_TIMEOUT_S, FETCH_MAX_TIMEOUT_S)

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
