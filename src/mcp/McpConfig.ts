import * as fs from "fs/promises"
import * as path from "path"
import type { IMCPServerConfig } from "./MCPManager"
import { createDomainLogger } from "../core/Logger"

const log = createDomainLogger("MCP")

/** Запись MCP-сервера в конфигурации. */
export interface IMcpServerEntry {
  /** Команда запуска (stdio-транспорт). */
  command: string
  /** Аргументы команды. */
  args?: string[]
  /** Переменные окружения процесса. */
  env?: Record<string, string>
}

/**
 * Загрузить конфигурацию внешних MCP-серверов.
 *
 * Источники (по приоритету, проект переопределяет глобальный по имени):
 * 1. файл `.mcp.json` в корне проекта: { "mcpServers": { имя: запись } };
 * 2. настройка VS Code `neuralTowerAgent.mcpServers`.
 *
 * Поддерживается только stdio-транспорт (запуск локального процесса).
 */
export async function loadMcpServers(
  vsServers: Record<string, IMcpServerEntry>,
  workspaceRoot: string | null,
): Promise<IMCPServerConfig[]> {
  const merged: Record<string, IMcpServerEntry> = { ...vsServers }

  if (workspaceRoot) {
    const file = path.join(workspaceRoot, ".mcp.json")
    try {
      const raw = await fs.readFile(file, "utf-8")
      const data = JSON.parse(raw) as { mcpServers?: Record<string, IMcpServerEntry> }
      if (data.mcpServers && typeof data.mcpServers === "object") {
        for (const [name, entry] of Object.entries(data.mcpServers)) {
          merged[name] = entry
        }
      }
    } catch {
      // Файла нет или он повреждён — используем только настройки VS Code
    }
  }

  const servers: IMCPServerConfig[] = []
  for (const [name, entry] of Object.entries(merged)) {
    if (!entry || typeof entry.command !== "string" || !entry.command.trim()) {
      log.warn(`MCP-сервер "${name}": не указана команда — пропущен`)
      continue
    }
    servers.push({
      name,
      transport: "stdio",
      command: entry.command,
      args: Array.isArray(entry.args) ? entry.args.map(String) : undefined,
      env: entry.env && typeof entry.env === "object" ? entry.env : undefined,
    })
  }
  return servers
}
