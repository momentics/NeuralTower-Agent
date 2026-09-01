import type { IToolSchema } from "../ITool"
import type { IToolResult } from "../../agent/AgentTypes"
import type { ISkillManager } from "../../skills/SkillManager"
import { str } from "../ToolArgs"
import { BaseTool } from "./BaseTool"

/**
 * Загрузить инструкции навыка по имени.
 */
export class SkillTool extends BaseTool {
  name = "skill"
  description =
    "Загрузить инструкции навыка по имени. Используйте, когда задача " +
    "соответствует описанию доступного навыка."
  category = "knowledge"
  isSafe = true

  schema: IToolSchema = {
    name: "skill",
    description: "Загрузить навык",
    parameters: {
      name: { type: "string", description: "Имя навыка" },
    },
    required: ["name"],
  }

  constructor(private readonly manager: ISkillManager) {
    super()
  }

  protected async doExecute(args: Record<string, unknown>): Promise<IToolResult> {
    const name = str(args, "name")
    if (!name) return { output: "Не указано имя навыка", success: false }
    const skill = this.manager.list().find((s) => s.name.toLowerCase() === name.toLowerCase())
    if (!skill) {
      const available = this.manager.list().map((s) => s.name).join(", ")
      return { output: `Навык "${name}" не найден. Доступные: ${available}`, success: false }
    }
    return { output: `# ${skill.name}\n\n${skill.instructions}`, success: true }
  }
}
