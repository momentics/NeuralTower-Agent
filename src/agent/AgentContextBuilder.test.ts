import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { AgentContextBuilder } from "./AgentContextBuilder"
import type { IBackend } from "../core/IBackend"
import { ToolRegistry } from "../tools/ToolRegistry"
import type { SkillManager } from "../skills/SkillManager"
import type { ISkill } from "../skills/ISkill"
import type { GitService } from "../services/git/GitService"
import { AgentMemory } from "./AgentMemory"
import { FileIndex } from "../repo/FileIndex"

const createMockBackend = (): IBackend => ({
  chat: vi.fn(async () => ({ role: "assistant", content: "Test response", timestamp: Date.now() })),
  chatJson: vi.fn(async () => ({})),
  getConfig: vi.fn(async () => ({ url: "http://localhost:30000", model: "test-model", maxRetries: 3, timeoutMs: 60000 })),
  updateConfig: vi.fn(async () => {}),
  listModels: vi.fn(async () => ["test-model"]),
  healthCheck: vi.fn(async () => true),
})

const createMockSkillManager = (buildContextReturn = ""): SkillManager => ({
  match: vi.fn(() => []),
  buildContext: vi.fn(() => buildContextReturn),
  register: vi.fn(),
  list: vi.fn(() => []),
} as unknown as SkillManager)

const createMockGitService = (): GitService => ({
  getBranchInfo: vi.fn(async () => ({ name: "main", ahead: 0, behind: 0 })),
  getDiffContext: vi.fn(async () => "## Изменения Git (не добавленные)\n```diff\n+added line\n```"),
  getDiff: vi.fn(async () => ({ changed: [], additions: 0, deletions: 0 })),
  getStatus: vi.fn(async () => ({ staged: [], unstaged: [], untracked: [] })),
  findRoot: vi.fn(async () => "/test/dir"),
  generateCommitMessage: vi.fn(async () => ""),
  getCachedDiff: vi.fn(async () => ""),
  init: vi.fn(async () => {}),
  dispose: vi.fn(),
  name: "git",
  version: "0.1.0",
} as unknown as GitService)

const createMockFileIndex = (totalFiles = 0, languages = 0): FileIndex => ({
  stats: vi.fn(() => ({ totalFiles, languages, totalSize: 0 })),
  build: vi.fn(async () => {}),
  findByPattern: vi.fn(() => []),
  findByLanguage: vi.fn(() => []),
  findByName: vi.fn(() => []),
  clear: vi.fn(),
} as unknown as FileIndex)

describe("AgentContextBuilder", () => {
  let backend: IBackend
  let toolRegistry: ToolRegistry
  let skillManager: SkillManager
  let memory: AgentMemory
  let fileIndex: FileIndex
  let gitService: GitService
  let configMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    backend = createMockBackend()
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
      backend,
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
      backend,
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

  it("buildSystemPrompt includes environment block with model info", async () => {
    const builder = new AgentContextBuilder(
      backend,
      toolRegistry,
      skillManager,
      memory,
      fileIndex,
      gitService,
      () => "/test/dir",
    )
    const prompt = await builder.buildSystemPrompt([])
    expect(prompt).toContain("<env>")
    expect(prompt).toContain("Модель: test-model")
    expect(prompt).toContain("Рабочая директория: /test/dir")
    expect(prompt).toContain("Платформа: win32")
    expect(prompt).toContain("Ветка: main")
    expect(prompt).toContain("</env>")
  })

  it("buildSystemPrompt includes tool schema list", async () => {
    const builder = new AgentContextBuilder(
      backend,
      toolRegistry,
      skillManager,
      memory,
      fileIndex,
      gitService,
      () => "/test/dir",
    )
    const prompt = await builder.buildSystemPrompt([])
    expect(prompt).toContain("Инструменты не доступны.")
  })

  it("buildSystemPrompt includes project context from memory", async () => {
    memory.setProject({ repo: "my-repo", languages: ["ts", "js"] })
    const builder = new AgentContextBuilder(
      backend,
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
      backend,
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
      backend,
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
      backend,
      toolRegistry,
      skillManager,
      memory,
      fileIndex,
      null,
      () => "/test/dir",
    )
    const prompt = await builder.buildSystemPrompt([])
    expect(prompt).not.toContain("Изменения Git")
    expect(prompt).toContain("Ветка: неизвестно")
  })

  it("buildEnvironmentBlock falls back gracefully when backend fails", async () => {
    vi.mocked(backend.getConfig).mockRejectedValueOnce(new Error("Backend error"))
    const builder = new AgentContextBuilder(
      backend,
      toolRegistry,
      skillManager,
      memory,
      fileIndex,
      null,
      () => "/test/dir",
    )
    const prompt = await builder.buildSystemPrompt([])
    expect(prompt).toContain("<env>")
    expect(prompt).toContain("Рабочая директория: /test/dir")
    expect(prompt).toContain("Платформа: win32")
    expect(prompt).not.toContain("Модель:")
    expect(prompt).toContain("</env>")
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
      backend,
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
})
