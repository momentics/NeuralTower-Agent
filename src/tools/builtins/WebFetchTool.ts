import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import { fetchUrl } from "../../network/UrlFetcher"

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
      timeout: { type: "number", description: "Тайм-аут в секундах", default: 30 },
    },
    required: ["url"],
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const url = String(args.url ?? "")
    if (!url) return { output: "Не указан URL", success: false }

    const timeoutSec = Number(args.timeout ?? 30) || 30

    const result = await fetchUrl(url, {
      timeout: timeoutSec * 1000,
      maxLength: 8000,
    })

    if (!result.ok) {
      if (result.status === 0) {
        return { output: result.text, success: false }
      }
      return { output: `HTTP ${result.status}`, success: false }
    }

    return { output: result.text, success: true }
  }
}
