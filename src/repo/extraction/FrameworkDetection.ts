import * as fs from 'fs/promises';
import * as path from 'path';

// Проверка существования файла
async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

// Чтение JSON-файла
async function readJson<T = any>(filePath: string): Promise<T | null> {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content) as T;
    } catch {
        return null;
    }
}

// Чтение текстового файла
async function readText(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, 'utf-8');
    } catch {
        return null;
    }
}

// Определение структуры package.json
interface PackageJson {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}

// Поиск файлов по шаблону в директории
async function findFilesByPattern(dir: string, pattern: string): Promise<string[]> {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const results: string[] = [];
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...(await findFilesByPattern(fullPath, pattern)));
            } else if (new RegExp(pattern).test(entry.name)) {
                results.push(fullPath);
            }
        }
        return results;
    } catch {
        return [];
    }
}

// Обнаружение фреймворков в проекте
export async function detectFrameworks(projectRoot: string): Promise<string[]> {
    const frameworks = new Set<string>();

    // --- JavaScript/TypeScript фреймворки ---

    // React: зависимость react в package.json или наличие JSX/TSX файлов
    const pkgPath = path.join(projectRoot, 'package.json');
    const pkg = await readJson<PackageJson>(pkgPath);
    if (pkg) {
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        const depKeys = Object.keys(allDeps).map(k => k.toLowerCase());

        if (depKeys.includes('react')) {
            frameworks.add('React');
        }

        // Express: зависимость express в package.json
        if (depKeys.includes('express')) {
            frameworks.add('Express');
        }

        // NestJS: зависимость @nestjs/core в package.json
        if (depKeys.includes('@nestjs/core')) {
            frameworks.add('NestJS');
        }

        // Vue: зависимость vue в package.json
        if (depKeys.includes('vue')) {
            frameworks.add('Vue');
        }
    }

    // Поиск JSX/TSX файлов для React (если package.json не найден)
    if (!frameworks.has('React')) {
        const jsxFiles = await findFilesByPattern(projectRoot, '\\.(jsx|tsx)$');
        if (jsxFiles.length > 0) {
            frameworks.add('React');
        }
    }

    // Next.js: наличие next.config.js, next.config.mjs или директории pages/
    if (await fileExists(path.join(projectRoot, 'next.config.js'))) {
        frameworks.add('Next.js');
    } else if (await fileExists(path.join(projectRoot, 'next.config.mjs'))) {
        frameworks.add('Next.js');
    } else if (await fileExists(path.join(projectRoot, 'pages'))) {
        const pagesStat = await fs.stat(path.join(projectRoot, 'pages'));
        if (pagesStat.isDirectory()) {
            frameworks.add('Next.js');
        }
    }

    // Angular: наличие angular.json
    if (await fileExists(path.join(projectRoot, 'angular.json'))) {
        frameworks.add('Angular');
    }

    // Vue: наличие vue.config.js (если не определено через package.json)
    if (!frameworks.has('Vue') && await fileExists(path.join(projectRoot, 'vue.config.js'))) {
        frameworks.add('Vue');
    }

    // Svelte: наличие svelte.config.js
    if (await fileExists(path.join(projectRoot, 'svelte.config.js'))) {
        frameworks.add('Svelte');
    }

    // --- Python фреймворки ---

    // Django: наличие manage.py и settings.py
    if (await fileExists(path.join(projectRoot, 'manage.py'))) {
        const settingsPath = path.join(projectRoot, 'settings.py');
        if (await fileExists(settingsPath)) {
            frameworks.add('Django');
        }
    }

    // Flask: app.py с импортом Flask или requirements.txt с flask
    const appPyPath = path.join(projectRoot, 'app.py');
    if (!frameworks.has('Flask')) {
        const appPyContent = await readText(appPyPath);
        if (appPyContent && /from\s+flask\s+import|import\s+flask/i.test(appPyContent)) {
            frameworks.add('Flask');
        }
    }
    if (!frameworks.has('Flask')) {
        const reqPath = path.join(projectRoot, 'requirements.txt');
        const reqContent = await readText(reqPath);
        if (reqContent && /flask/i.test(reqContent)) {
            frameworks.add('Flask');
        }
    }

    // FastAPI: main.py с импортом FastAPI
    const mainPyPath = path.join(projectRoot, 'main.py');
    const mainPyContent = await readText(mainPyPath);
    if (mainPyContent && /from\s+fastapi\s+import|import\s+fastapi/i.test(mainPyContent)) {
        frameworks.add('FastAPI');
    }

    // --- Java фреймворки ---

    // Spring Boot: pom.xml с spring-boot или application.properties
    const pomPath = path.join(projectRoot, 'pom.xml');
    const pomContent = await readText(pomPath);
    if (pomContent && /spring-boot/i.test(pomContent)) {
        frameworks.add('Spring Boot');
    } else if (await fileExists(path.join(projectRoot, 'application.properties'))) {
        frameworks.add('Spring Boot');
    }

    // --- Go фреймворки ---

    // Gin: go.mod с gin-gonic/gin
    const goModPath = path.join(projectRoot, 'go.mod');
    const goModContent = await readText(goModPath);
    if (goModContent && /gin-gonic\/gin/i.test(goModContent)) {
        frameworks.add('Gin');
    }

    // --- Rust фреймворки ---

    // Actix-web, Axum: Cargo.toml с соответствующей зависимостью
    const cargoTomlPath = path.join(projectRoot, 'Cargo.toml');
    const cargoContent = await readText(cargoTomlPath);
    if (cargoContent) {
        if (/actix-web/i.test(cargoContent)) {
            frameworks.add('Actix-web');
        }
        if (/axum/i.test(cargoContent)) {
            frameworks.add('Axum');
        }
    }

    // --- C# фреймворки ---

    // ASP.NET Core: *.csproj с Microsoft.AspNetCore
    const csprojFiles = await findFilesByPattern(projectRoot, '\\.csproj$');
    for (const csprojFile of csprojFiles) {
        const csprojContent = await readText(csprojFile);
        if (csprojContent && /Microsoft\.AspNetCore/i.test(csprojContent)) {
            frameworks.add('ASP.NET Core');
            break;
        }
    }

    return Array.from(frameworks);
}
