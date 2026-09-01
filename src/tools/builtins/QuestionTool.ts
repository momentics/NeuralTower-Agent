import type { IToolSchema } from "../ITool"
import type { IToolResult } from "../../agent/AgentTypes"
import { str, arr } from "../ToolArgs"
import { BaseTool } from "./BaseTool"
import type { IQuestionService } from "../../services/question/QuestionService"

/**
 * Задать пользователю уточняющий вопрос и дождаться ответа.
 */
export class QuestionTool extends BaseTool {
  name = "question"
  description =
    "Задать пользователю уточняющий вопрос и дождаться ответа. " +
    "Используйте, когда задача неоднозначна и неверная интерпретация дорога."
  category = "interaction"
  isSafe = true

  schema: IToolSchema = {
    name: "question",
    description: "Задать вопрос пользователю",
    parameters: {
      question: { type: "string", description: "Вопрос пользователю" },
      options: {
        type: "array",
        items: { type: "string" },
        description: "Необязательный список вариантов ответа",
      },
    },
    required: ["question"],
  }

  constructor(private readonly questionService: IQuestionService) {
    super()
  }

  protected async doExecute(args: Record<string, unknown>, signal?: AbortSignal): Promise<IToolResult> {
    const question = str(args, "question")
    if (!question) return { output: "Не указан вопрос", success: false }
    const options = arr<string>(args, "options").filter((o) => typeof o === "string" && o.length > 0)

    const answer = await this.questionService.ask(question, options, signal)
    if (answer === null) {
      return { output: "Пользователь не ответил вовремя.", success: false }
    }
    return { output: `Ответ пользователя: ${answer}`, success: true }
  }
}
