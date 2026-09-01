import type { ISkill } from "./ISkill"

/**
 * Интерфейс менеджера навыков.
 */
export interface ISkillManager {
  register(skill: ISkill): void
  registerMany(skills: ISkill[]): void
  match(query: string): ISkill[]
  buildContext(skills: ISkill[]): string
  list(): ISkill[]
  clear(): void
}

/**
 * Управление поиском, подбором и формированием контекста навыков.
 *
 * Подбор: по пользовательскому запросу находит подходящие навыки
 * по совпадению ключевых слов.
 * Формирование контекста: объединяет инструкции активных навыков
 * в системный запрос.
 */
export class SkillManager implements ISkillManager {
  private skills: ISkill[] = []

  /** Зарегистрировать навык. Навык с тем же именем заменяет существующий. */
  register(skill: ISkill): void {
    this.skills = this.skills.filter((s) => s.name !== skill.name)
    this.skills.push(skill)
  }

  /** Зарегистрировать несколько навыков. */
  registerMany(skills: ISkill[]): void {
    this.skills.push(...skills)
  }

  /**
   * Найти навыки, подходящие к запросу.
   * Сравнивает триггеры (без учёта регистра) с текстом запроса.
   * Возвращает навыки, отсортированные по приоритету (по убыванию).
   */
  match(query: string): ISkill[] {
    const lower = query.toLowerCase()
    const matched = this.skills.filter((s) =>
      s.triggers.some((t) => lower.includes(t.toLowerCase())),
    )
    matched.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    return matched.slice(0, 5) // ограничить, чтобы не перегружать контекст
  }

  /**
   * Сформировать блок контекста из подобранных навыков.
   * Возвращает строку, готовую к вставке в системный запрос.
   */
  buildContext(skills: ISkill[]): string {
    if (skills.length === 0) return ""
    const blocks = skills
      .map((s) => `## ${s.name}\n${s.instructions}`)
      .join("\n\n")
    return `\n## Активные навыки\n${blocks}\n`
  }

  /** Вернуть список всех зарегистрированных навыков. */
  list(): ISkill[] {
    return [...this.skills]
  }

  /** Очистить все навыки. */
  clear(): void {
    this.skills = []
  }
}
