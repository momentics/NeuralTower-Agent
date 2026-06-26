/**
 * Детекция фреймворков по списку файлов.
 *
 * Анализирует имена и пути файлов для обнаружения фреймворков.
 * Работает синхронно, не читает содержимое файлов.
 */

/** Индикатор фреймворка: паттерн и имя фреймворка. */
interface FrameworkIndicator {
  pattern: (file: string) => boolean;
  name: string;
}

/** Карта индикаторов фреймворков. */
const FRAMEWORK_INDICATORS: FrameworkIndicator[] = [
  // --- JavaScript/TypeScript фреймворки ---

  // React: зависимость react в package.json или наличие JSX/TSX файлов
  { pattern: (f) => f.endsWith('.jsx') || f.endsWith('.tsx'), name: 'React' },

  // Поиск JSX/TSX файлов для React (если package.json не найден)

  // Next.js: наличие next.config.js, next.config.mjs или директории pages/
  { pattern: (f) => f === 'next.config.js' || f === 'next.config.mjs' || /^pages\//.test(f), name: 'Next.js' },

  // Angular: наличие angular.json
  { pattern: (f) => f === 'angular.json', name: 'Angular' },

  // Vue: зависимость vue в package.json
  // Vue: наличие vue.config.js (если не определено через package.json)
  { pattern: (f) => f === 'vue.config.js', name: 'Vue' },

  // Svelte: наличие svelte.config.js
  { pattern: (f) => f === 'svelte.config.js', name: 'Svelte' },

  // Express: зависимость express в package.json
  { pattern: (f) => f === 'server.js' || f === 'server.ts' || f === 'bin/www', name: 'Express' },

  // NestJS: зависимость @nestjs/core в package.json
  { pattern: (f) => f === 'nest-cli.json', name: 'NestJS' },

  // --- Python фреймворки ---

  // Django: наличие manage.py и settings.py
  { pattern: (f) => f === 'manage.py' || f.endsWith('/settings.py') || f === 'settings.py', name: 'Django' },

  // Flask: app.py с импортом Flask или requirements.txt с flask
  { pattern: (f) => f === 'requirements.txt', name: 'Flask' },

  // FastAPI: main.py с импортом FastAPI
  { pattern: (f) => f === 'main.py', name: 'FastAPI' },

  // --- Java фреймворки ---

  // Spring Boot: pom.xml с spring-boot или application.properties
  { pattern: (f) => f === 'application.properties' || f === 'application.yml', name: 'Spring Boot' },

  // --- Go фреймворки ---

  // Gin: go.mod с gin-gonic/gin

  // --- Rust фреймворки ---

  // Actix-web, Axum: Cargo.toml с соответствующей зависимостью
  { pattern: (f) => f === 'Cargo.toml', name: 'Actix-web' },

  // --- C# фреймворки ---

  // ASP.NET Core: *.csproj с Microsoft.AspNetCore
  { pattern: (f) => f.endsWith('.csproj'), name: 'ASP.NET Core' },
];

/**
 * Обнаружение фреймворков по списку файлов.
 *
 * Проверяет имена и пути файлов на наличие индикаторов фреймворков.
 * Работает синхронно, не выполняет I/O.
 */
export function detectFrameworks(fileList: string[]): string[] {
  const frameworks = new Set<string>();

  // Приводим все пути к нижнему регистру для сравнения
  const lowerFiles = fileList.map((f) => f.toLowerCase());

  // Проверяем каждый индикатор
  for (const { pattern, name } of FRAMEWORK_INDICATORS) {
    for (const file of lowerFiles) {
      if (pattern(file)) {
        frameworks.add(name);
        break;
      }
    }
  }

  // Django требует обоих файлов: manage.py и settings.py
  if (frameworks.has('Django')) {
    const hasManage = lowerFiles.includes('manage.py');
    const hasSettings = lowerFiles.some((f) => f.endsWith('settings.py'));
    if (!hasManage || !hasSettings) {
      frameworks.delete('Django');
    }
  }

  return Array.from(frameworks);
}
