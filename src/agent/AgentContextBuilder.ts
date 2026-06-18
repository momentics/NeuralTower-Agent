import type { ISkill } from "../skills/ISkill"
import type { ToolRegistry } from "../tools/ToolRegistry"
import type { SkillManager } from "../skills/SkillManager"
import type { IGitService } from "../services/git/GitService"
import type { IContextManager } from "../core/ContextManager"
import type { IFileIndex } from "../repo/FileIndex"
import { AgentMemory } from "./AgentMemory"

export class AgentContextBuilder {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly skillManager: SkillManager,
    private readonly memory: AgentMemory,
    private readonly fileIndex: IFileIndex,
    private readonly gitService: IGitService | null,
    private readonly getWorkDir: () => string,
    private readonly injectDiffContext: boolean,
    private readonly contextManager: IContextManager | null = null,
  ) {}

  async buildSystemPrompt(skills: ISkill[]): Promise<string> {
    const base = this.baseSystemPrompt()
    const skillCtx = this.skillManager.buildContext(skills)
    const projectCtx = this.memory.projectContext()
    const indexStats = this.fileIndex.stats()
    const indexInfo =
      indexStats.totalFiles > 0
        ? `\nИндекс файлов: ${indexStats.totalFiles} файлов, ${indexStats.languages} языков`
        : ""

    let gitContext = ""
    if (this.gitService && this.injectDiffContext) {
      gitContext = await this.gitService.getDiffContext(this.getWorkDir())
    }

    let contextManagerContent = ""
    if (this.contextManager) {
      try {
        const prepared = await this.contextManager.prepare()
        if (prepared.systemPrompt) {
          contextManagerContent = prepared.systemPrompt
        }
      } catch {
        // ContextManager недоступен — пропускаем
      }
    }

    const parts = [contextManagerContent, base, projectCtx, skillCtx, indexInfo, gitContext].filter(Boolean)
    return parts.join("\n\n")
  }

  private baseSystemPrompt(): string {
    return `Вы — агент Neural Tower, высококвалифицированный ИИ-помощник для разработки программного обеспечения.

# Личность

- Ваша цель — выполнить задачу пользователя, а не вести беседу.
- Вы выполняете задачи итеративно, разбивая их на чёткие шаги.
- Не запрашивайте лишнюю информацию. Используйте доступные инструменты эффективно.
- НЕ начинайте ответы с "Отлично", "Конечно", "Хорошо". Будьте прямолинейны и технически точны.
- НИКОГДА не заканчивайте ответ вопросом или предложением дальнейшей помощи.
- Минимизируйте токены вывода. Отвечайте кратко: 1-3 строки, если пользователь не просит подробности.

# Стиль кода

- При изменении кода сначала изучите conventions файла.
- НЕ добавляйте комментарии, если пользователь не попросил явно.
- Следуйте best practices безопасности. Не логируйте секреты.

# Выполнение задач

- Используйте инструменты поиска для понимания кодовой базы.
- Реализуйте решение с использованием всех доступных инструментов.
- Никогда не коммитьте изменения, если пользователь не попросил явно.`
  }
}
