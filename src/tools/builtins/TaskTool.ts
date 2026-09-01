import type { IToolSchema } from "../ITool"
import type { IToolResult } from "../../agent/AgentTypes"
import type { AgentModeName } from "../../agent/AgentMode"
import { str } from "../ToolArgs"
import { BaseTool } from "./BaseTool"
import type { ISubagentLauncher } from "../../agent/TaskLauncher"

/**
 * Запустить субагента для отдельной задачи.
 *
 * Субагент работает автономно в изолированном разговоре и возвращает
 * финальный ответ. Типы: explore — только чтение и поиск;
 * general — полное выполнение задачи.
 */
export class TaskTool extends BaseTool {
  name = "task"
  description =
    "Запустить субагента для отдельной задачи. Субагент работает автономно " +
    "и возвращает финальный ответ. Типы: explore — чтение и поиск по кодовой " +
    "базе; general — выполнение задачи (включая изменения файлов)."
  category = "agent"
  isSafe = false

  schema: IToolSchema = {
    name: "task",
    description: "Запустить субагента",
    parameters: {
      description: { type: "string", description: "Краткое название задачи (3-10 слов)" },
      prompt: { type: "string", description: "Полная задача для субагента" },
      subagent_type: {
        type: "string",
        enum: ["explore", "general"],
        description: "Тип субагента",
        default: "general",
      },
    },
    required: ["description", "prompt"],
  }

  constructor(
    private readonly launcher: ISubagentLauncher,
    private readonly getWorkDir: () => string | null,
  ) {
    super()
  }

  protected async doExecute(args: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult> {
    const description = str(args, "description")
    const prompt = str(args, "prompt")
    if (!description || !prompt) {
      return { output: "Не указаны название и содержание задачи", success: false }
    }
    const type = str(args, "subagent_type") || "general"
    if (type !== "explore" && type !== "general") {
      return { output: `Неизвестный тип субагента: ${type}`, success: false }
    }
    const workDir = this.getWorkDir()
    if (!workDir) {
      return { output: "Рабочая директория не установлена", success: false }
    }
    const mode: AgentModeName = type === "explore" ? "explore" : "build"

    const result = await this.launcher.launch({ name: description, task: prompt, mode, workDir }, signal)
    if (!result.ok) {
      return { output: `Субагент не выполнен: ${result.error ?? "неизвестная ошибка"}`, success: false }
    }
    return { output: result.output, success: true }
  }
}
