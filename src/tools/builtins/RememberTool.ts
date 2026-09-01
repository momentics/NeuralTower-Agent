import type { IToolSchema } from "../ITool"
import type { IToolResult } from "../../agent/AgentTypes"
import { BaseTool } from "./BaseTool"
import { str, strOpt } from "../ToolArgs"
import type { MemoryStore } from "../../services/memory/MemoryStore"

/** Лимит заметок в памяти проекта. */
const MAX_NOTES = 50
/** Лимит конвенций в памяти проекта. */
const MAX_CONVENTIONS = 30

/**
 * Сохранить факт о проекте в долговременную память.
 *
 * Память пишется в глобальное хранилище расширения (не в проект),
 * поэтому инструмент разрешён во всех режимах, включая read-only.
 */
export class RememberTool extends BaseTool {
  name = "remember"
  description =
    "Сохранить факт о проекте в долговременную память: команду (build/test), " +
    "заметку о проекте или конвенцию. Память подгружается в контекст " +
    "в следующих сессиях."
  category = "memory"
  isSafe = true

  schema: IToolSchema = {
    name: "remember",
    description: "Сохранить факт в память проекта",
    parameters: {
      fact: { type: "string", description: "Факт для сохранения" },
      kind: {
        type: "string",
        description: "Тип факта: command (команда), note (заметка), convention (конвенция)",
        enum: ["command", "note", "convention"],
        default: "note",
      },
      name: { type: "string", description: "Имя команды (для kind=command, например test)" },
    },
    required: ["fact"],
  }

  constructor(private readonly store: MemoryStore) {
    super()
  }

  protected async doExecute(args: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult> {
    const fact = str(args, "fact").trim()
    if (!fact) return { output: "Не указан факт для сохранения", success: false }
    const kind = strOpt(args, "kind") ?? "note"
    const name = strOpt(args, "name")?.trim()

    if (kind === "command" && !name) {
      return { output: "Для kind=command укажите имя команды (например test)", success: false }
    }

    await this.store.update((data) => {
      if (kind === "command" && name) {
        data.commands[name] = fact
      } else if (kind === "convention") {
        if (!data.conventions.includes(fact)) data.conventions.push(fact)
        if (data.conventions.length > MAX_CONVENTIONS) {
          data.conventions.splice(0, data.conventions.length - MAX_CONVENTIONS)
        }
      } else {
        if (!data.notes.includes(fact)) data.notes.push(fact)
        if (data.notes.length > MAX_NOTES) {
          data.notes.splice(0, data.notes.length - MAX_NOTES)
        }
      }
    })

    return { output: `Факт сохранён в память проекта (${kind})`, success: true }
  }
}
