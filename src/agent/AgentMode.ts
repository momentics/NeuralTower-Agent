import type { PermissionLevel } from "../shared/PermissionTypes"

/**
 * Обработчик события смены режима.
 */
export type ModeChangeHandler = (mode: AgentModeName) => void

/**
 * Режим агента определяет набор разрешений и системный промпт
 * для конкретного типа работы.
 *
 * Каждый режим — это набор правил разрешений для инструментов
 * и специфичный системный промпт.
 */

/**
 * Доступные режимы агента.
 */
export type AgentModeName = "build" | "plan" | "explore"

/**
 * Правило разрешения для инструмента.
 */
export interface IToolRule {
  /** Паттерн имени инструмента (поддерживает * как wildcard). */
  tool: string

  /** Уровень разрешения. */
  level: PermissionLevel
}

/**
 * Определение режима агента.
 */
export interface IAgentMode {
  /** Имя режима. */
  readonly name: AgentModeName

  /** Отображаемое имя. */
  readonly displayName: string

  /** Описание режима. */
  readonly description: string

  /** Правила разрешений для инструментов. */
  readonly toolRules: IToolRule[]

  /** Допустимые переходы в другие режимы. */
  readonly transitions: AgentModeName[]

  /** Системный промпт для режима (добавляется к базовому). */
  readonly systemPromptAddon: string

  /** Приоритет (для выбора режима по умолчанию). */
  readonly priority: number
}

/**
 * Проверить, соответствует ли имя инструмента правилу с wildcard.
 */
export function toolMatchesRule(toolName: string, rule: IToolRule): boolean {
  if (rule.tool === "*") return true
  if (rule.tool === toolName) return true

  const pattern = rule.tool
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^]*")

  return new RegExp(`^${pattern}$`).test(toolName)
}

/**
 * Найти правило разрешения для инструмента в режиме.
 * Правила проверяются в порядке объявления; первое совпадение — итоговое.
 */
export function resolveToolPermission(
  mode: IAgentMode,
  toolName: string,
): PermissionLevel {
  for (const rule of mode.toolRules) {
    if (toolMatchesRule(toolName, rule)) {
      return rule.level
    }
  }
  return "ask"
}

/**
 * Встроенные режимы агента.
 */
export const BUILT_IN_MODES: Record<AgentModeName, IAgentMode> = {
  build: {
    name: "build",
    displayName: "Построение",
    description: "Основной режим: выполнение задач, редактирование файлов, запуск команд",
    priority: 10,
    transitions: ["plan", "explore"],
    toolRules: [
      { tool: "read_file", level: "allow" },
      { tool: "glob", level: "allow" },
      { tool: "grep", level: "allow" },
      { tool: "web_fetch", level: "allow" },
      { tool: "lsp", level: "allow" },
      { tool: "codebase_search", level: "allow" },
      { tool: "todowrite", level: "allow" },
      { tool: "ntgraph_*", level: "allow" },
      { tool: "question", level: "allow" },
      { tool: "edit_file", level: "ask" },
      { tool: "write_file", level: "ask" },
      { tool: "bash", level: "ask" },
      // git: read-only операции проходят без запроса (isSafeForArgs),
      // изменяющие и опасные — с подтверждением
      { tool: "git", level: "ask" },
      { tool: "delete_file", level: "ask" },
      { tool: "move_file", level: "ask" },
      { tool: "create_dir", level: "ask" },
      { tool: "*", level: "ask" },
    ],
    systemPromptAddon: `# Режим: Построение

Вы работаете в режиме выполнения задач. Ваша цель — реализовать запрошенные изменения.

Правила:
- Разбивайте сложные задачи на шаги с помощью todowrite
- Перед изменением файла всегда читайте его содержимое
- После изменений проверяйте результат
- Фиксируйте изменения только по явной просьбе пользователя`,
  },

  plan: {
    name: "plan",
    displayName: "Планирование",
    description: "Режим планирования: анализ, исследование, создание плана без изменений",
    priority: 5,
    transitions: ["build"],
    toolRules: [
      { tool: "read_file", level: "allow" },
      { tool: "glob", level: "allow" },
      { tool: "grep", level: "allow" },
      { tool: "web_fetch", level: "allow" },
      { tool: "lsp", level: "allow" },
      { tool: "codebase_search", level: "allow" },
      { tool: "todowrite", level: "allow" },
      { tool: "ntgraph_*", level: "allow" },
      { tool: "question", level: "allow" },
      // git: чтение состояния (status/diff/log) без запроса, изменения — с подтверждением
      { tool: "git", level: "ask" },
      { tool: "edit_file", level: "deny" },
      { tool: "write_file", level: "deny" },
      { tool: "bash", level: "deny" },
      { tool: "delete_file", level: "deny" },
      { tool: "move_file", level: "deny" },
      { tool: "create_dir", level: "deny" },
      { tool: "*", level: "deny" },
    ],
    systemPromptAddon: `# Режим: Планирование

Вы работаете в режиме планирования. Ваша задача — проанализировать запрос,
изучить кодовую базу и создать подробный план действий.

Правила:
- НЕ изменяйте файлы. У вас нет прав на edit_file, write_file и bash.
- Используйте read_file, glob и grep для изучения кодовой базы.
- Создайте пошаговый план с конкретными действиями.
- Укажите предлагаемые инструменты для каждого шага.
- После завершения плана используйте плановый выход для перехода в режим Build.`,
  },

  explore: {
    name: "explore",
    displayName: "Исследование",
    description: "Режим исследования: чтение и поиск без изменений",
    priority: 3,
    transitions: ["build", "plan"],
    toolRules: [
      { tool: "read_file", level: "allow" },
      { tool: "glob", level: "allow" },
      { tool: "grep", level: "allow" },
      { tool: "web_fetch", level: "allow" },
      { tool: "lsp", level: "allow" },
      { tool: "codebase_search", level: "allow" },
      { tool: "question", level: "allow" },
      { tool: "ntgraph_*", level: "allow" },
      // git: чтение состояния (status/diff/log) без запроса, изменения — с подтверждением
      { tool: "git", level: "ask" },
      { tool: "edit_file", level: "deny" },
      { tool: "write_file", level: "deny" },
      { tool: "bash", level: "deny" },
      { tool: "delete_file", level: "deny" },
      { tool: "move_file", level: "deny" },
      { tool: "create_dir", level: "deny" },
      { tool: "todowrite", level: "deny" },
      { tool: "*", level: "deny" },
    ],
    systemPromptAddon: `# Режим: Исследование

Вы работаете в режиме исследования. Ваша задача — изучить кодовую базу,
найти релевантные файлы и ответить на вопросы пользователя.

Правила:
- НЕ изменяйте файлы. У вас нет прав на edit_file, write_file и bash.
- Используйте read_file, glob и grep для навигации по коду.
- Отвечайте конкретно, со ссылками на файлы и строки.
- Если задача требует изменений, предложите перейти в режим Build.`,
  },
}

/**
 * Менеджер режимов агента: управляет текущим режимом,
 * разрешениями и переходами.
 */
export class AgentModeManager {
  private currentMode: AgentModeName = "build"
  private overrides: Map<AgentModeName, IAgentMode> = new Map()
  private modeListeners: Set<ModeChangeHandler> = new Set()

  /**
   * Вернуть текущий режим.
   */
  getMode(): IAgentMode {
    return this.overrides.get(this.currentMode) ?? BUILT_IN_MODES[this.currentMode]
  }

  /**
   * Вернуть имя текущего режима.
   */
  getModeName(): AgentModeName {
    return this.currentMode
  }

  /**
   * Переключить режим. Возвращает true, если переход допустим
   * (или режим уже текущий — no-op).
   */
  switchMode(newMode: AgentModeName): boolean {
    if (newMode === this.currentMode) {
      return true
    }
    const current = this.getMode()
    if (!current.transitions.includes(newMode)) {
      return false
    }
    this.currentMode = newMode
    this.emitModeChanged()
    return true
  }

  /**
   * Проверить разрешение для инструмента в текущем режиме.
   */
  checkToolPermission(toolName: string): PermissionLevel {
    const mode = this.getMode()
    return resolveToolPermission(mode, toolName)
  }

  /**
   * Вернуть системный промпт для текущего режима.
   */
  getSystemPromptAddon(): string {
    return this.getMode().systemPromptAddon
  }

  /**
   * Вернуть все доступные режимы.
   */
  listModes(): IAgentMode[] {
    const modes: IAgentMode[] = []
    for (const [name] of Object.entries(BUILT_IN_MODES)) {
      const mode = this.overrides.get(name as AgentModeName) ?? BUILT_IN_MODES[name as AgentModeName]
      modes.push(mode)
    }
    return modes.sort((a, b) => b.priority - a.priority)
  }

  /**
   * Зарегистрировать пользовательский режим (переопределяет встроенный).
   */
  registerMode(mode: IAgentMode): void {
    this.overrides.set(mode.name, mode)
  }

  /**
   * Подписаться на события смены режима.
   * Событие fires при успешном switchMode и при resetMode.
   * Возвращает объект с dispose() для отписки.
   */
  onModeChanged(handler: ModeChangeHandler): { dispose(): void } {
    this.modeListeners.add(handler)
    return {
      dispose: () => {
        this.modeListeners.delete(handler)
      },
    }
  }

  /**
   * Сбросить режим на дефолтный ("build").
   * Вызывается при новом чате / сбросе сессии.
   */
  resetMode(): void {
    if (this.currentMode === "build") {
      return
    }
    this.currentMode = "build"
    this.emitModeChanged()
  }

  private emitModeChanged(): void {
    const mode = this.currentMode
    for (const handler of [...this.modeListeners]) {
      handler(mode)
    }
  }

}
