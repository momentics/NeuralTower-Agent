// Карта соответствия расширений файлов языкам программирования
export const EXTENSION_TO_LANGUAGE: Readonly<Record<string, string>> = Object.freeze({
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'typescript',
  '.jsx': 'typescript',
  '.mjs': 'typescript',
  '.cjs': 'typescript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.c++': 'cpp',
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.h++': 'cpp',
  '.c': 'cpp',
  '.cs': 'csharp',
});

/**
 * Определяет язык программирования файла по расширению и содержимому.
 * @param filePath - Путь к файлу для определения языка.
 * @param content - Опциональное содержимое файла для проверки shebang.
 * @returns Название языка программирования.
 */
export function detectLanguage(filePath: string, content?: string): string {
  // Извлекаем расширение файла
  const ext = filePath.includes('.')
    ? filePath.slice(filePath.lastIndexOf('.'))
    : '';

  // Проверяем карту расширений
  const langFromExt = EXTENSION_TO_LANGUAGE[ext];

  if (langFromExt) {
    return langFromExt;
  }

  // Если содержимое предоставлено, проверяем shebang на наличие Python
  if (content) {
    const shebang = content.split('\n')[0];
    if (shebang.startsWith('#!') && shebang.includes('python')) {
      return 'python';
    }
  }

  // Язык не определён
  return 'unknown';
}
