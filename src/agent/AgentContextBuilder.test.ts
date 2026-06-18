import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { AgentContextBuilder } from "./AgentContextBuilder"
import { ToolRegistry } from "../tools/ToolRegistry"
import type { SkillManager } from "../skills/SkillManager"
import type { ISkill } from "../skills/ISkill"
import type { IGitService } from "../services/git/GitService"
import type { IFileIndex } from "../repo/FileIndex"
import type { IContextManager } from "../core/ContextManager"
import { ContextManager } from "../core/ContextManager"
import { AgentMemory } from "./AgentMemory"

const createMockSkillManager = (buildContextReturn = ""): SkillManager => ({
  match: vi.fn(() => []),
  buildContext: vi.fn(() => buildContextReturn),
  register: vi.fn(),
  list: vi.fn(() => []),
} as unknown as SkillManager)

const createMockGitService = (): IGitService => ({
  getBranchInfo: vi.fn(async () => ({ name: "main", ahead: 0, behind: 0 })),
  getDiffContext: vi.fn(async () => "## Изменения Git (не добавленные)\n```diff\n+added line\n```"),
})

const createMockFileIndex = (totalFiles = 0, languages = 0): IFileIndex => ({
  stats: vi.fn(() => ({ totalFiles, languages, totalSize: 0 })),
})

describe("AgentContextBuilder", () => {
  let toolRegistry: ToolRegistry
  let skillManager: SkillManager
  let memory: AgentMemory
  let fileIndex: IFileIndex
  let gitService: IGitService
  let configMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    toolRegistry = new ToolRegistry()
    skillManager = createMockSkillManager()
    memory = new AgentMemory()
    fileIndex = createMockFileIndex()
    gitService = createMockGitService()

    configMock = vi.fn().mockReturnValue({
      get: vi.fn().mockImplementation((_key: string, fallback: any) => fallback),
    })
    ;(vscode.workspace.getConfiguration as any) = configMock
  })

  it("creates instance with all dependencies", () => {
    const builder = new AgentContextBuilder(
      toolRegistry,
      skillManager,
      memory,
      fileIndex,
      gitService,
      () => "/test/dir",
    )
    expect(builder).toBeDefined()
  })

  it("buildSystemPrompt includes base system prompt text", async () => {
    const builder = new AgentContextBuilder(
      toolRegistry,
      skillManager,
      memory,
      fileIndex,
      gitService,
      () => "/test/dir",
    )
    const prompt = await builder.buildSystemPrompt([])
    expect(prompt).toContain("Вы — агент Neural Tower")
    expect(prompt).toContain("Ваша цель — выполнить задачу пользователя")
  })

  it("buildSystemPrompt includes tool schema list", async () => {
    const builder = new AgentContextBuilder(
      toolRegistry,
      skillManager,
      memory,
      fileIndex,
      gitService,
      () => "/test/dir",
    )
    const prompt = await builder.buildSystemPrompt([])
    expect(prompt).toContain("Инструменты недоступны.")
  })

  it("buildSystemPrompt includes project context from memory", async () => {
    memory.setProject({ repo: "my-repo", languages: ["ts", "js"] })
    const builder = new AgentContextBuilder(
      toolRegistry,
      skillManager,
      memory,
      fileIndex,
      gitService,
      () => "/test/dir",
    )
    const prompt = await builder.buildSystemPrompt([])
    expect(prompt).toContain("Контекст проекта")
    expect(prompt).toContain("Проект: my-repo")
    expect(prompt).toContain("Языки: ts, js")
  })

  it("buildSystemPrompt includes file index info when files exist", async () => {
    fileIndex = createMockFileIndex(42, 3)
    const builder = new AgentContextBuilder(
      toolRegistry,
      skillManager,
      memory,
      fileIndex,
      gitService,
      () => "/test/dir",
    )
    const prompt = await builder.buildSystemPrompt([])
    expect(prompt).toContain("Индекс файлов: 42 файлов, 3 языков")
  })

  it("buildSystemPrompt includes git diff context when gitService is set and config allows", async () => {
    const builder = new AgentContextBuilder(
      toolRegistry,
      skillManager,
      memory,
      fileIndex,
      gitService,
      () => "/test/dir",
      true,
    )
    const prompt = await builder.buildSystemPrompt([])
    expect(prompt).toContain("Изменения Git")
    expect(gitService.getDiffContext).toHaveBeenCalledWith("/test/dir")
  })

  it("buildSystemPrompt omits git diff context when gitService is null", async () => {
    const builder = new AgentContextBuilder(
      toolRegistry,
      skillManager,
      memory,
      fileIndex,
      null,
      () => "/test/dir",
    )
    const prompt = await builder.buildSystemPrompt([])
    expect(prompt).not.toContain("Изменения Git")
  })

  it("buildSystemPrompt includes skill context when skills are active", async () => {
    const skillManagerWithCtx = createMockSkillManager("## Навык: testing\nИнструкции для тестирования")
    const skill: ISkill = {
      name: "testing",
      description: "Testing skill",
      triggers: ["test"],
      instructions: "Инструкции для тестирования",
    }
    const builder = new AgentContextBuilder(
      toolRegistry,
      skillManagerWithCtx,
      memory,
      fileIndex,
      gitService,
      () => "/test/dir",
    )
    const prompt = await builder.buildSystemPrompt([skill])
    expect(prompt).toContain("Навык: testing")
    expect(skillManagerWithCtx.buildContext).toHaveBeenCalledWith([skill])
  })

  it("buildSystemPrompt includes contextManager content when set", async () => {
    const contextManager = new ContextManager()
    const builder = new AgentContextBuilder(
      toolRegistry,
      skillManager,
      memory,
      fileIndex,
      gitService,
      () => "/test/dir",
      false,
      contextManager,
    )
    const prompt = await builder.buildSystemPrompt([])
    expect(prompt).toContain("Вы — агент Neural Tower")
  })

  it("buildSystemPrompt handles contextManager error gracefully", async () => {
    const contextManager = new ContextManager()
    vi.spyOn(contextManager, "prepare").mockRejectedValue(new Error("ContextManager error"))
    const builder = new AgentContextBuilder(
      toolRegistry,
      skillManager,
      memory,
      fileIndex,
      gitService,
      () => "/test/dir",
      false,
      contextManager,
    )
    const prompt = await builder.buildSystemPrompt([])
    expect(prompt).toContain("Вы — агент Neural Tower")
  })

  it("buildSystemPrompt contains baseSystemPrompt in normal execution path", async () => {
    const builder = new AgentContextBuilder(
      toolRegistry,
      skillManager,
      memory,
      fileIndex,
      gitService,
      () => "/test/dir",
    )
    const prompt = await builder.buildSystemPrompt([])
    expect(prompt).toContain("Вы — агент Neural Tower")
    expect(prompt).toContain("Ваша цель — выполнить задачу пользователя")
    expect(prompt).toContain("НЕ начинайте ответы с")
    expect(prompt).toContain("НИКОГДА не заканчивайте ответ вопросом")
    expect(prompt).toContain("Минимизируйте токены вывода")
    expect(prompt).toContain("Когда нужно вызвать инструмент")
    expect(prompt).toContain("НЕ добавляйте комментарии")
    expect(prompt).toContain("Никогда не коммитьте изменения")
  })
})
