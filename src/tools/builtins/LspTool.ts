import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import {
  executeDocumentSymbol,
  executeWorkspaceSymbol,
  executeGoToDefinition,
  executeGoToTypeDefinition,
  executeGoToImplementation,
  executeFindReferences,
  executeHover,
  executeSignatureHelp,
  MAX_SYMBOL_RESULTS,
} from "../../lsp/LspClient"
import { errorMessage } from "../../core/errors"

const OPERATIONS = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "signatureHelp",
  "goToTypeDefinition",
] as const

type LspOperation = (typeof OPERATIONS)[number]

/** Инструмент для семантического анализа кода через LSP: определение, ссылки, символы, hover и т.д. */
export class LspTool implements ITool {
  name = "lsp"
  description = "LSP-операции для семантического анализа кода: переход к определению, поиск ссылок, символы документа/workspace, всплывающая подсказка, реализация, сигнатура, тип"
  category = "lsp"
  isSafe = true

  schema: ToolSchema = {
    name: "lsp",
    description: "LSP-операции для семантического анализа кода",
    parameters: {
      operation: {
        type: "string",
        description: `Операция: ${OPERATIONS.join(", ")}`,
        enum: [...OPERATIONS],
      },
      filePath: {
        type: "string",
        description: "Абсолютный или относительный путь к файлу",
      },
      line: {
        type: "number",
        description: "Номер строки (с 1, как в редакторе). Не требуется для documentSymbol и workspaceSymbol.",
      },
      character: {
        type: "number",
        description: "Позиция символа (с 1, как в редакторе). Не требуется для documentSymbol и workspaceSymbol.",
      },
      query: {
        type: "string",
        description: "Поисковый запрос для workspaceSymbol. Пустая строка запрашивает все символы.",
      },
    },
    required: ["operation"],
  }

  constructor(private readonly getWorkDir = () => process.cwd()) {}

  async execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const operation = args.operation as LspOperation | undefined
    const filePathRaw = args.filePath as string | undefined

    if (!operation) {
      return { output: "Не указана операция", success: false }
    }

    if (!OPERATIONS.includes(operation)) {
      return { output: `Неподдерживаемая операция: ${operation}. Доступно: ${OPERATIONS.join(", ")}`, success: false }
    }

    if (!filePathRaw && operation !== "workspaceSymbol") {
      return { output: "Не указан путь к файлу (требуется для всех операций кроме workspaceSymbol)", success: false }
    }

    const line = args.line ? Number(args.line) : undefined
    const character = args.character ? Number(args.character) : undefined
    const query = args.query ? String(args.query) : undefined

    try {
      switch (operation) {
        case "documentSymbol":
          return await executeDocumentSymbol(filePathRaw!, this.getWorkDir, signal)
        case "workspaceSymbol":
          return await executeWorkspaceSymbol(query ?? "", this.getWorkDir, MAX_SYMBOL_RESULTS, signal)
        case "goToDefinition":
          return await executeGoToDefinition(filePathRaw!, line, character, this.getWorkDir, signal)
        case "findReferences":
          return await executeFindReferences(filePathRaw!, line, character, this.getWorkDir, signal)
        case "hover":
          return await executeHover(filePathRaw!, line, character, this.getWorkDir, signal)
        case "goToImplementation":
          return await executeGoToImplementation(filePathRaw!, line, character, this.getWorkDir, signal)
        case "signatureHelp":
          return await executeSignatureHelp(filePathRaw!, line, character, this.getWorkDir, signal)
        case "goToTypeDefinition":
          return await executeGoToTypeDefinition(filePathRaw!, line, character, this.getWorkDir, signal)
      }
    } catch (err: unknown) {
      return {
        output: `LSP-ошибка: ${errorMessage(err)}`,
        success: false,
      }
    }
  }
}
