import type { ContextProvider, ContextItem, SubmenuItem } from "./types"

export type MCPToolListFn = () => Promise<
  Array<{ server: string; tool: { name: string; description: string; schema: Record<string, unknown> } }>
>

export function makeMCPProvider(
  listMCPTools: MCPToolListFn,
): ContextProvider {
  return {
    description: {
      name: "mcp",
      displayTitle: "MCP",
      description: "MCP-инструменты как контекст",
      type: "submenu",
    },
    async resolve(query: string): Promise<ContextItem[]> {
      const trimmed = query.trim()
      const allTools = await listMCPTools()

      if (allTools.length === 0) {
        return [{ content: "MCP-серверы не подключены", name: "mcp", description: "empty" }]
      }

      const filtered = trimmed
        ? allTools.filter(
            (t) =>
              t.tool.name.toLowerCase().includes(trimmed.toLowerCase()) ||
              t.tool.description.toLowerCase().includes(trimmed.toLowerCase()) ||
              t.server.toLowerCase().includes(trimmed.toLowerCase()),
          )
        : allTools

      if (filtered.length === 0) {
        return [{ content: `MCP-инструменты для "${trimmed}" не найдены`, name: "mcp", description: "not found" }]
      }

      const grouped = new Map<string, typeof filtered>()
      for (const t of filtered) {
        const arr = grouped.get(t.server) ?? []
        arr.push(t)
        grouped.set(t.server, arr)
      }

      const lines: string[] = []
      for (const [server, tools] of grouped) {
        lines.push(`Сервер: ${server}`)
        for (const t of tools) {
          lines.push(`  ${t.tool.name}: ${t.tool.description}`)
        }
        lines.push("")
      }

      return [{
        content: `Доступные MCP-инструменты:\n\n${lines.join("\n")}`,
        name: "MCP Tools",
        description: `${filtered.length} инструментов`,
      }]
    },
    async loadSubmenuItems(): Promise<SubmenuItem[]> {
      const allTools = await listMCPTools()
      return allTools.map((t) => ({
        id: `${t.server}:${t.tool.name}`,
        label: t.tool.name,
        description: `[${t.server}] ${t.tool.description}`,
      }))
    },
  }
}
