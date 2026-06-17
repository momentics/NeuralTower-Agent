import type { ContextProviderRegistry } from "../core/providers/context/registry"
import type { ContextManager } from "../core/ContextManager"
import type { GitService } from "../services/git/GitService"
import type { PermissionManager } from "../services/permission/PermissionManager"
import type { MCPManager } from "../mcp/MCPManager"
import type { AppConfig } from "../core/config"
import type { FileIndex } from "../repo/FileIndex"

/**
 * AgentEnvironment — контейнер внешних зависимостей агента.
 *
 * Содержит только ссылки на сервисы, которые могут меняться
 * в ходе жизненного цикла (например, GitService, MCPManager).
 * Неподвижные зависимости (backend, toolRegistry, skillManager)
 * передаются через конструктор AgentCore.
 */
export class AgentEnvironment {
  /** Рабочая директория проекта. */
  public workDir: string

  /** Конфигурация приложения. */
  public config: AppConfig

  /** Реестр провайдеров контекста. */
  public readonly contextProviderRegistry: ContextProviderRegistry

  /** Менеджер контекста. */
  public readonly contextManager: ContextManager

  /** Файловый индекс. */
  public readonly fileIndex: FileIndex

  /** Сервис git (опционально, может быть установлен позже). */
  public gitService: GitService | null

  /** Менеджер разрешений (опционально, может быть установлен позже). */
  public permissionManager: PermissionManager | null

  /** Менеджер MCP (опционально, может быть установлен позже). */
  public mcpManager: MCPManager | null

  constructor(
    workDir: string,
    config: AppConfig,
    contextProviderRegistry: ContextProviderRegistry,
    contextManager: ContextManager,
    fileIndex: FileIndex,
  ) {
    this.workDir = workDir
    this.config = config
    this.contextProviderRegistry = contextProviderRegistry
    this.contextManager = contextManager
    this.fileIndex = fileIndex
    this.gitService = null
    this.permissionManager = null
    this.mcpManager = null
  }

  /**
   * Разрешить провайдер контекста по имени и запросу.
   */
  async resolveContextProvider(name: string, query: string): Promise<import("../core/providers/context/types").ContextItem[]> {
    const provider = this.contextProviderRegistry.get(name)
    if (!provider) return []
    return provider.resolve(query)
  }
}
