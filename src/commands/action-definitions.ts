/**
 * Составные определения действий — объединение схем (данные) и промптов (логика).
 */
import { EDITOR_ACTION_SCHEMAS, type ActionSchema } from "./action-schemas"
import { ACTION_PROMPT_TEMPLATES, type ActionPromptTemplates } from "./action-prompts"

export interface ActionDefinition extends ActionSchema, ActionPromptTemplates {}

/**
 * Соединяет схемы действий с шаблонами промптов.
 */
export const EDITOR_ACTIONS: ActionDefinition[] = EDITOR_ACTION_SCHEMAS.map(
  (schema) => ({
    ...schema,
    ...ACTION_PROMPT_TEMPLATES[schema.name],
  }),
)
