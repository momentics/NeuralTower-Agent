/**
 * Память агента: хранит историю разговора и знания о проекте.
 *
 * Поддерживает:
 * - Краткосрочная память: контекст текущего разговора
 * - Долгосрочная память: факты о проекте, полученные в разных сессиях
 * - Управление контекстным окном: отсечение при превышении лимита
 */

import type { IChatMessage } from "../core/IBackend"
import { TOKENS_PER_CHAR } from "../core/TokenUtils"
import { loadDefaultAgentConfig } from "../core/Config"

export interface IMemoryEntry {
  message: IChatMessage
  tokenCount: number
  pinned: boolean // закреплённые записи сохраняются при отсечении
}

export interface IProjectMemory {
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
  private shortTerm: IMemoryEntry[] = []
  private project: IProjectMemory = {
    repo: "",
    languages: [],
    commands: {},
    notes: [],
  }

  private readonly maxTokens: number

  constructor(maxTokens = loadDefaultAgentConfig().maxTokens) {
    this.maxTokens = maxTokens
  }

  /** Добавить сообщение в краткосрочную память. */
  add(message: IChatMessage): void {
    this.shortTerm.push({
      message,
      tokenCount: Math.ceil(message.content.length * TOKENS_PER_CHAR),
      pinned: false,
    })
    this.trim()
  }

  /**
   * Вернуть последние сообщения в пределах лимита токенов.
   * Закреплённые сообщения всегда включаются.
   */
  getRecent(maxTokens?: number): IChatMessage[] {
    const budget = maxTokens ?? this.maxTokens
    let used = 0

    // Всегда включать закреплённые
    const result: IChatMessage[] = []
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
  setProject(mem: Partial<IProjectMemory>): void {
    if (mem.repo !== undefined) this.project.repo = mem.repo
    if (mem.languages) this.project.languages = mem.languages
    if (mem.commands) Object.assign(this.project.commands, mem.commands)
    if (mem.notes) this.project.notes.push(...mem.notes)
  }

  /** Вернуть память о проекте. */
  getProject(): IProjectMemory {
    return { ...this.project }
  }

  /** Сформировать фрагмент системного промпта из памяти о проекте. */
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

  /** Восстановить память из истории сообщений. */
  restoreFromMessages(messages: IChatMessage[]): void {
    this.shortTerm = messages.map((m) => ({
      message: m,
      tokenCount: Math.ceil(m.content.length * TOKENS_PER_CHAR),
      pinned: false,
    }))
    this.trim()
  }

  /** Очистить всю память. */
  clear(): void {
    this.shortTerm = []
    this.project = { repo: "", languages: [], commands: {}, notes: [] }
  }
}
