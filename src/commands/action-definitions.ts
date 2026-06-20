/**
 * Общие определения действий агента для редактора и code actions.
 */
export interface ActionDefinition {
  /** Имя действия. */
  name: string
  /** ID команды редактора. */
  editorCommandId: string
  /** ID команды code action. */
  codeActionCommandId: string
  /** Сообщение при отсутствии выделения (для редактора). */
  noSelectionMessage: string
  /** Требует ли выделения. */
  requireSelection: boolean
  /** Шаблон промпта для редактора. */
  editorPromptTemplate: (text: string, lang: string, filePath: string) => string
  /** Шаблон промпта для code action (без диагностики). */
  codeActionPromptTemplate: (text: string, lang: string, filePath: string) => string
  /** Шаблон промпта для code action с диагностикой (для fix). */
  codeActionWithDiagnosticsPromptTemplate?: (text: string, lang: string, filePath: string, diagnostics: string) => string
}

export const EDITOR_ACTIONS: ActionDefinition[] = [
  {
    name: "explainCode",
    editorCommandId: "neuralTowerAgent.explainCode",
    codeActionCommandId: "neuralTowerAgent.codeAction.explain",
    noSelectionMessage: "Выберите код для объяснения",
    requireSelection: true,
    editorPromptTemplate: (text, lang) => `Объясни этот код:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
    codeActionPromptTemplate: (text, lang) => `Объясни этот код:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
  },
  {
    name: "fixCode",
    editorCommandId: "neuralTowerAgent.fixCode",
    codeActionCommandId: "neuralTowerAgent.codeAction.fix",
    noSelectionMessage: "Выберите код для исправления",
    requireSelection: true,
    editorPromptTemplate: (text, lang) => `Исправь ошибки и проблемы в этом коде:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
    codeActionPromptTemplate: (text, lang) => `Исправь ошибки и проблемы в этом коде:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
    codeActionWithDiagnosticsPromptTemplate: (text, lang, _filePath, diagnostics) =>
      `Исправь следующие проблемы в этом коде:\n\nДиагностика:\n${diagnostics}\n\nКод:\n\`\`\`${lang}\n${text}\n\`\`\``,
  },
  {
    name: "improveCode",
    editorCommandId: "neuralTowerAgent.improveCode",
    codeActionCommandId: "neuralTowerAgent.codeAction.improve",
    noSelectionMessage: "Выберите код для улучшения",
    requireSelection: true,
    editorPromptTemplate: (text, lang) => `Улучши этот код по читаемости, производительности и лучшим практикам:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
    codeActionPromptTemplate: (text, lang) => `Улучши этот код по читаемости, производительности и лучшим практикам:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
  },
  {
    name: "addToContext",
    editorCommandId: "neuralTowerAgent.addToContext",
    codeActionCommandId: "neuralTowerAgent.codeAction.addToContext",
    noSelectionMessage: "",
    requireSelection: false,
    editorPromptTemplate: (text, lang, filePath) => `Вот контекст из файла ${filePath}:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
    codeActionPromptTemplate: (text, lang, filePath) => `Вот контекст из файла ${filePath}:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
  },
]
