/**
 * Детекция фреймворков по списку файлов.
 *
 * Анализирует имена, пути файлов и содержимое для обнаружения фреймворков.
 */

/** Индикатор фреймворка: паттерн и имя фреймворка. */
interface FrameworkIndicator {
  pattern: (file: string) => boolean;
  name: string;
}

/** Индикатор по содержимому файла. */
interface ContentIndicator {
  match: RegExp;
  name: string;
  filePattern: RegExp;
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

  // Flask: детекция по содержимому файла (import flask)
  // FastAPI: детекция по содержимому файла (import fastapi)

  // --- Java фреймворки ---

  // Spring Boot: pom.xml с spring-boot или application.properties
  { pattern: (f) => f === 'application.properties' || f === 'application.yml', name: 'Spring Boot' },

  // --- Go фреймворки ---

  // Gin: go.mod с gin-gonic/gin

  // --- Rust фреймворки ---

  // Actix-web, Axum: детекция по содержимому Cargo.toml

  // --- C# фреймворки ---

  // ASP.NET Core: *.csproj с Microsoft.AspNetCore
  { pattern: (f) => f.endsWith('.csproj'), name: 'ASP.NET Core' },
];

/** Индикаторы по содержимому файлов. */
const CONTENT_INDICATORS: ContentIndicator[] = [
  // React: зависимость в package.json
  { match: /"react"\s*:/, name: 'React', filePattern: /^package\.json$/ },
  // Express: зависимость в package.json
  { match: /"express"\s*:/, name: 'Express', filePattern: /^package\.json$/ },
  // Spring Boot: аннотация @SpringBootApplication или @RestController
  { match: /@(?:SpringBootApplication|RestController|SpringBootConfiguration)/, name: 'Spring Boot', filePattern: /\.java$/ },
  // Flask: импорт flask в Python файле
  { match: /(?:^|\s)import\s+flask(?:\s|$|\.|:)/i, name: 'Flask', filePattern: /\.py$/ },
  // FastAPI: импорт fastapi в Python файле
  { match: /(?:^|\s)import\s+fastapi(?:\s|$|\.|:)/i, name: 'FastAPI', filePattern: /\.py$/ },
  // Actix-web: зависимость actix-web в Cargo.toml
  { match: /actix-web/, name: 'Actix-web', filePattern: /^Cargo\.toml$/ },
  // Axum: зависимость axum в Cargo.toml
  { match: /axum/, name: 'Axum', filePattern: /^Cargo\.toml$/ },
  // Gin: зависимость gin-gonic/gin в go.mod
  { match: /gin-gonic\/gin/, name: 'Gin', filePattern: /^go\.mod$/ },
];

/**
 * Обнаружение фреймворков по списку файлов.
 *
 * Проверяет имена и пути файлов на наличие индикаторов фреймворков.
 * Работает синхронно, не выполняет I/O.
 */
export function detectFrameworks(fileList: string[], fileContents?: Map<string, string>): string[] {
  const frameworks = new Set<string>();

  // Приводим все пути к нижнему регистру для сравнения
  const lowerFiles = fileList.map((f) => f.toLowerCase());

  // Проверяем каждый индикатор по имени файла
  for (const { pattern, name } of FRAMEWORK_INDICATORS) {
    for (const file of lowerFiles) {
      if (pattern(file)) {
        frameworks.add(name);
        break;
      }
    }
  }

  // Проверяем индикаторы по содержимому файлов
  if (fileContents) {
    for (const [filePath, content] of fileContents) {
      for (const { match, name, filePattern } of CONTENT_INDICATORS) {
        if (filePattern.test(filePath) && match.test(content)) {
          frameworks.add(name);
        }
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
