import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"

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

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), (Number(args.timeout ?? 30) || 30) * 1000)
      const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer))

      if (!res.ok) {
        return { output: `HTTP ${res.status}`, success: false }
      }

      const text = await res.text()
      return { output: text.slice(0, 8000), success: true }
    } catch (err) {
      return {
        output: `Загрузка не выполнена: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      }
    }
  }
}
