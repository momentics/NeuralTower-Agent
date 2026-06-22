/**
 * Составные определения действий — объединение схем (данные) и промптов (логика).
 */
import { EDITOR_ACTION_SCHEMAS, type IActionSchema } from "./ActionSchemas"
import { ACTION_PROMPT_TEMPLATES, type IActionPromptTemplates } from "./ActionPrompts"

export interface IActionDefinition extends IActionSchema, IActionPromptTemplates {}

/**
 * Соединяет схемы действий с шаблонами промптов.
 */
export const EDITOR_ACTIONS: IActionDefinition[] = EDITOR_ACTION_SCHEMAS.map(
  (schema) => ({
    ...schema,
    ...ACTION_PROMPT_TEMPLATES[schema.name],
  }),
)
