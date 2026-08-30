import type { IBackend } from "../core/IBackend"
import type { IToolRegistry } from "../tools/ToolRegistry"
import type { ISkillManager } from "../skills/SkillManager"
import type { IContextProviderRegistry } from "../core/providers/context/Registry"
import type { IContextManager } from "../core/ContextManager"
import type { IGitService } from "../services/git/GitService"
import type { IPermissionManager } from "../services/permission/PermissionManager"
import type { IMCPManager } from "../mcp/MCPManager"
import type { IAppConfig } from "../core/Config"
import type { IFileIndex } from "../repo/FileIndex"
import type { ISnapshotService } from "../services/snapshot/SnapshotTypes"
import type { TodoStore } from "./TodoStore"

/**
 * Фабрика для создания экземпляров AgentOrchestrator.
 * Используется SubagentRunner для создания субагентов без
 * прямой зависимости от AgentOrchestrator.
 */
export type AgentSpawnFactory = (
  deps: IAgentFullDependencies,
  backend: IBackend,
  toolRegistry: IToolRegistry,
  skillManager: ISkillManager,
  todoStore: TodoStore,
) => import("./AgentOrchestrator").AgentOrchestrator

/**
 * AgentDependencies — обязательные зависимости агента.
 *
 * Все поля обязательны. Компоненты, которые работают только
 * с базовым контекстом, зависят только от этого интерфейса
 * (принцип ISP).
 */
export interface IAgentDependencies {
  /** Функция получения рабочей директории (может меняться). */
  getWorkDir: () => string | null

  /** Конфигурация приложения. */
  readonly config: IAppConfig

  /** Реестр провайдеров контекста. */
  readonly contextProviderRegistry: IContextProviderRegistry

  /** Менеджер контекста. */
  readonly contextManager: IContextManager

  /** Файловый индекс. */
  readonly fileIndex: IFileIndex

  /** Колбэк статуса для UI (например, «Создаю план…»). Пустой текст сбрасывает статус. */
  onAgentStatus?: (text: string) => void
}

/**
 * Опциональные зависимости агента.
 *
 * Поля могут быть null, если соответствующий компонент
 * не доступен или не настроен. Вынесены в отдельный
 * интерфейс для соблюдения ISP: потребитель, который не
 * использует эти зависимости, не должен о них знать.
 */
export interface IAgentOptionalDependencies {
  /** Сервис git (null если не доступен). */
  readonly gitService: IGitService | null

  /** Менеджер разрешений (null если не настроен). */
  readonly permissionManager: IPermissionManager | null

  /** Менеджер MCP (null если не подключен). */
  readonly mcpManager: IMCPManager | null

  /** Сервис снапшотов (null если недоступен: не-git, git не установлен, выключено). */
  readonly snapshotService: ISnapshotService | null
}

/**
 * Полный набор зависимостей агента (обязательные + опциональные).
 *
 * Используется в местах, где создаётся или передаётся полный
 * контекст агента (AgentOrchestrator, AgentCore, Container).
 */
export type IAgentFullDependencies = IAgentDependencies & IAgentOptionalDependencies
