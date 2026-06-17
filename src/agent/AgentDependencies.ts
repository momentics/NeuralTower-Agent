import type { IBackend } from "../core/IBackend"
import type { ToolRegistry } from "../tools/ToolRegistry"
import type { SkillManager } from "../skills/SkillManager"
import type { ContextProviderRegistry } from "../core/providers/context/registry"
import type { ContextManager } from "../core/ContextManager"
import type { GitService } from "../services/git/GitService"
import type { PermissionManager } from "../services/permission/PermissionManager"
import type { MCPManager } from "../mcp/MCPManager"
import type { AppConfig } from "../core/config"
import type { FileIndex } from "../repo/FileIndex"

/**
 * Фабрика для создания экземпляров AgentOrchestrator.
 * Используется SubagentRunner для создания субагентов без
 * прямой зависимости от AgentOrchestrator.
 */
export type AgentSpawnFactory = (
  deps: AgentDependencies,
  backend: IBackend,
  toolRegistry: ToolRegistry,
  skillManager: SkillManager,
) => import("./AgentOrchestrator").AgentOrchestrator

/**
 * AgentDependencies — иммутабельный набор внешних зависимостей агента.
 *
 * Все зависимости передаются через конструктор и не могут быть
 * изменены после создания. Это гарантирует, что AgentCore
 * всегда работает с полным и консистентным окружением.
 *
 * Опциональные зависимости (gitService, permissionManager, mcpManager)
 * могут быть null, если компонент это документирует.
 */
export interface AgentDependencies {
  /** Функция получения рабочей директории (может меняться). */
  getWorkDir: () => string

  /** Конфигурация приложения. */
  readonly config: AppConfig

  /** Реестр провайдеров контекста. */
  readonly contextProviderRegistry: ContextProviderRegistry

  /** Менеджер контекста. */
  readonly contextManager: ContextManager

  /** Файловый индекс. */
  readonly fileIndex: FileIndex

  /** Сервис git (null если не доступен). */
  readonly gitService: GitService | null

  /** Менеджер разрешений (null если не настроен). */
  readonly permissionManager: PermissionManager | null

  /** Менеджер MCP (null если не подключен). */
  readonly mcpManager: MCPManager | null
}
