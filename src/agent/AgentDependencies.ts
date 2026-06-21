import type { IBackend } from "../core/IBackend"
import type { IToolRegistry } from "../tools/ToolRegistry"
import type { ISkillManager } from "../skills/SkillManager"
import type { IContextProviderRegistry } from "../core/providers/context/registry"
import type { IContextManager } from "../core/ContextManager"
import type { IGitService } from "../services/git/GitService"
import type { IPermissionManager } from "../services/permission/PermissionManager"
import type { IMCPManager } from "../mcp/MCPManager"
import type { AppConfig } from "../core/config"
import type { IFileIndex } from "../repo/FileIndex"
import type { TodoStore } from "./TodoStore"

/**
 * Фабрика для создания экземпляров AgentOrchestrator.
 * Используется SubagentRunner для создания субагентов без
 * прямой зависимости от AgentOrchestrator.
 */
export type AgentSpawnFactory = (
  deps: AgentDependencies,
  backend: IBackend,
  toolRegistry: IToolRegistry,
  skillManager: ISkillManager,
  todoStore: TodoStore,
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
  getWorkDir: () => string | null

  /** Конфигурация приложения. */
  readonly config: AppConfig

  /** Реестр провайдеров контекста. */
  readonly contextProviderRegistry: IContextProviderRegistry

  /** Менеджер контекста. */
  readonly contextManager: IContextManager

  /** Файловый индекс. */
  readonly fileIndex: IFileIndex

  /** Сервис git (null если не доступен). */
  readonly gitService: IGitService | null

  /** Менеджер разрешений (null если не настроен). */
  readonly permissionManager: IPermissionManager | null

  /** Менеджер MCP (null если не подключен). */
  readonly mcpManager: IMCPManager | null
}
