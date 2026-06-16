import type { ContextProvider, ContextItem } from "./types"

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return m ? m[1].trim() : null
}

function htmlToText(html: string): string {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, "")
  t = t.replace(/<style[\s\S]*?<\/style>/gi, "")
  t = t.replace(/<br\s*\/?>/gi, "\n")
  t = t.replace(/<\/?(p|div|li|tr|h[1-6])[^>]*>/gi, "\n")
  t = t.replace(/<[^>]+>/g, "")
  t = t.replace(/&nbsp;/g, " ")
  t = t.replace(/&amp;/g, "&")
  t = t.replace(/&lt;/g, "<")
  t = t.replace(/&gt;/g, ">")
  t = t.replace(/&quot;/g, '"')
  t = t.replace(/\u00a0/g, " ")
  t = t.replace(/\n{3,}/g, "\n\n")
  return t.trim()
}

export function makeUrlProvider(): ContextProvider {
  return {
    description: {
      name: "url",
      displayTitle: "URL",
      description: "Содержимое веб-страницы по URL",
      type: "query",
    },
    async resolve(query: string): Promise<ContextItem[]> {
      const trimmed = query.trim()
      if (!trimmed) return []

      let url: URL
      try {
        url = new URL(trimmed)
      } catch {
        try {
          url = new URL(`https://${trimmed}`)
        } catch {
          return [{ content: `Некорректный URL: ${trimmed}`, name: "url", description: "error" }]
        }
      }

      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 15000)
        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { "User-Agent": "NeuralTower-Agent/0.1" },
        })
        clearTimeout(timer)

        if (!response.ok) {
          return [{ content: `HTTP ${response.status}: ${response.statusText}`, name: url.hostname, description: "error" }]
        }

        const html = await response.text()
        const text = htmlToText(html)
        const title = extractTitle(html) ?? url.pathname

        return [{
          content: `Источник: ${url.toString()}\n\n${text.slice(0, 12000)}`,
          name: title,
          description: url.toString(),
        }]
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return [{ content: `Ошибка загрузки: ${msg}`, name: url.hostname, description: "error" }]
      }
    },
  }
}
