/**
 * Шаблоны промптов для действий — логика без данных (SRP).
 */
export interface IActionPromptTemplates {
  editorPromptTemplate: (text: string, lang: string, filePath: string) => string
  codeActionPromptTemplate: (text: string, lang: string, filePath: string) => string
  codeActionWithDiagnosticsPromptTemplate?: (text: string, lang: string, filePath: string, diagnostics: string) => string
}

/**
 * Реестр шаблонов промптов по имени действия.
 */
export const ACTION_PROMPT_TEMPLATES: Record<string, IActionPromptTemplates> = {
  explainCode: {
    editorPromptTemplate: (text, lang) => `Объясни этот код:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
    codeActionPromptTemplate: (text, lang) => `Объясни этот код:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
  },
  fixCode: {
    editorPromptTemplate: (text, lang) => `Исправь ошибки и проблемы в этом коде:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
    codeActionPromptTemplate: (text, lang) => `Исправь ошибки и проблемы в этом коде:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
    codeActionWithDiagnosticsPromptTemplate: (text, lang, _filePath, diagnostics) =>
      `Исправь следующие проблемы в этом коде:\n\nДиагностика:\n${diagnostics}\n\nКод:\n\`\`\`${lang}\n${text}\n\`\`\``,
  },
  improveCode: {
    editorPromptTemplate: (text, lang) => `Улучши этот код по читаемости, производительности и лучшим практикам:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
    codeActionPromptTemplate: (text, lang) => `Улучши этот код по читаемости, производительности и лучшим практикам:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
  },
  addToContext: {
    editorPromptTemplate: (text, lang, filePath) => `Вот контекст из файла ${filePath}:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
    codeActionPromptTemplate: (text, lang, filePath) => `Вот контекст из файла ${filePath}:\n\n\`\`\`${lang}\n${text}\n\`\`\``,
  },
}
