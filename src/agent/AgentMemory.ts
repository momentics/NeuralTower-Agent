/**
 * Память агента: хранит историю разговора и знания о проекте.
 *
 * Поддерживает:
 * - Краткосрочная память: контекст текущего разговора
 * - Долгосрочная память: факты о проекте, полученные в разных сессиях
 * - Управление контекстным окном: отсечение при превышении лимита
 */

import type { ChatMessage } from "../core/IBackend"

export interface MemoryEntry {
  message: ChatMessage
  tokenCount: number
  pinned: boolean // закреплённые записи сохраняются при отсечении
}

export interface ProjectMemory {
  /** Название репозитория. */
  repo: string
  /** Языки, определённые в проекте. */
  languages: string[]
  /** Команды сборки и тестирования. */
  commands: Record<string, string>
  /** Архитектурные заметки, полученные в ходе сессий. */
  notes: string[]
}

export class AgentMemory {
  private shortTerm: MemoryEntry[] = []
  private project: ProjectMemory = {
    repo: "",
    languages: [],
    commands: {},
    notes: [],
  }

  /** Примерное число токенов на сообщение. Используется для расчёта лимита контекста. */
  private static readonly TOKENS_PER_CHAR = 0.25
  private readonly maxTokens: number

  constructor(maxTokens = 60_000) {
    this.maxTokens = maxTokens
  }

  /** Добавить сообщение в краткосрочную память. */
  add(message: ChatMessage): void {
    this.shortTerm.push({
      message,
      tokenCount: Math.ceil((message.content.length * AgentMemory.TOKENS_PER_CHAR)),
      pinned: false,
    })
    this.trim()
  }

  /**
   * Вернуть последние сообщения в пределах лимита токенов.
   * Закреплённые сообщения всегда включаются.
   */
  getRecent(maxTokens?: number): ChatMessage[] {
    const budget = maxTokens ?? this.maxTokens
    let used = 0

    // Всегда включать закреплённые
    const result: ChatMessage[] = []
    for (const entry of this.shortTerm) {
      if (entry.pinned) {
        result.push(entry.message)
        used += entry.tokenCount
      }
    }

    // Заполнить остаток бюджета с самых последних
    for (let i = this.shortTerm.length - 1; i >= 0; i--) {
      const entry = this.shortTerm[i]
      if (entry.pinned) continue
      if (used + entry.tokenCount > budget) break
      result.unshift(entry.message)
      used += entry.tokenCount
    }

    return result
  }

  /** Отсечь самые старые незакреплённые записи при превышении лимита. */
  private trim(): void {
    let total = this.shortTerm.reduce((sum, e) => sum + e.tokenCount, 0)
    while (total > this.maxTokens) {
      const idx = this.shortTerm.findIndex((e) => !e.pinned)
      if (idx === -1) break
      total -= this.shortTerm[idx].tokenCount
      this.shortTerm.splice(idx, 1)
    }
  }

  /** Установить память о проекте. */
  setProject(mem: Partial<ProjectMemory>): void {
    if (mem.repo !== undefined) this.project.repo = mem.repo
    if (mem.languages) this.project.languages = mem.languages
    if (mem.commands) Object.assign(this.project.commands, mem.commands)
    if (mem.notes) this.project.notes.push(...mem.notes)
  }

  /** Вернуть память о проекте. */
  getProject(): ProjectMemory {
    return { ...this.project }
  }

  /*  * Сформировать фрагмент системного промпта из памяти о проекте. */
  projectContext(): string {
    const parts: string[] = []
    if (this.project.repo) parts.push(`Проект: ${this.project.repo}`)
    if (this.project.languages.length) parts.push(`Языки: ${this.project.languages.join(", ")}`)
    if (Object.keys(this.project.commands).length) {
      parts.push(`Команды:\n${Object.entries(this.project.commands).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`)
    }
    if (this.project.notes.length) {
      parts.push(`Заметки:\n${this.project.notes.map((n) => `  - ${n}`).join("\n")}`)
    }
    return parts.length > 0 ? `\n## Контекст проекта\n${parts.join("\n")}` : ""
  }

  /** Очистить всю память. */
  clear(): void {
    this.shortTerm = []
    this.project = { repo: "", languages: [], commands: {}, notes: [] }
  }
}
