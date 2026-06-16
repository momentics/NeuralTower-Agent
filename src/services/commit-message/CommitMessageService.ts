import type { IBackend } from "../../core/IBackend"
import type { GitService } from "../../services/git/GitService"
import type { Plugin } from "../../shared/types"

export class CommitMessageService implements Plugin {
  name = "commit-message"
  version = "0.1.0"

  private readonly systemPrompt = `Ты — генератор сообщений коммитов. 
По git diff создай краткое и точное сообщение коммита.

Правила:
- Используй Conventional Commits: feat:, fix:, docs:, refactor:, test:, chore:
- Первая строка — не более 50 символов
- Описание на русском языке, если код содержит русские комментарии
- Боди опционально, для сложных изменений
- Пример: "feat: добавить обработку разрешений инструментов"`

  constructor(
    private readonly backend: IBackend,
    private readonly gitService: GitService,
  ) {}

  async init(): Promise<void> {}

  async generate(dir: string): Promise<string> {
    const diff = await this.gitService.getCachedDiff(dir)
    if (!diff || !diff.trim()) return ""

    const messages = [
      { role: "system" as const, content: this.systemPrompt, timestamp: Date.now() },
      { role: "user" as const, content: diff, timestamp: Date.now() },
    ]

    try {
      const result = await this.backend.chat(messages, () => {})
      return this.clean(result.content)
    } catch {
      return this.fallbackMessage(diff)
    }
  }

  dispose(): void {}

  private clean(content: string): string {
    let msg = content.trim()
    msg = msg.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "")
    msg = msg.replace(/^["']|["']$/g, "")
    return msg.trim()
  }

  private fallbackMessage(diff: string): string {
    const lines = diff.split("\n").filter(Boolean)
    const files = lines
      .filter((l) => l.startsWith("diff --git"))
      .map((l) => l.replace(/diff --git a\/.*? b\//, ""))
    const count = files.length
    return count > 0 ? `chore: изменить ${count} файл${count > 1 ? (count < 5 ? 'а' : 'ов') : ''}` : "chore: обновления"
  }
}
