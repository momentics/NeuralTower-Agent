import type { IContextProviderRegistry } from "../core/providers/context/registry"
import type { IContextManager } from "../core/ContextManager"
import type { IGitService } from "../services/git/GitService"
import type { IPermissionManager } from "../services/permission/PermissionManager"
import type { IMCPManager } from "../mcp/MCPManager"
import type { AppConfig } from "../core/config"
import type { IFileIndex } from "../repo/FileIndex"

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
  public readonly contextProviderRegistry: IContextProviderRegistry

  /** Менеджер контекста. */
  public readonly contextManager: IContextManager

  /** Файловый индекс. */
  public readonly fileIndex: IFileIndex

  /** Сервис git (опционально, может быть установлен позже). */
  public gitService: IGitService | null

  /** Менеджер разрешений (опционально, может быть установлен позже). */
  public permissionManager: IPermissionManager | null

  /** Менеджер MCP (опционально, может быть установлен позже). */
  public mcpManager: IMCPManager | null

  constructor(
    workDir: string,
    config: AppConfig,
    contextProviderRegistry: IContextProviderRegistry,
    contextManager: IContextManager,
    fileIndex: IFileIndex,
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
