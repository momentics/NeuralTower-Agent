import { vi } from "vitest"

// Отключаем пул воркеров в тестах — используем in-process WASM-парсинг
// (реальный воркер покрывается отдельным интеграционным тестом, ФАЗА 4, шаг 4.3).
process.env.CODEGRAPH_PARSE_WORKERS = "0"

// Заглушка для crypto.randomBytes при генерации HTML вебвью
vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    default: {
      randomBytes: (n: number) => Buffer.alloc(n),
      createHash: actual.createHash,
    },
    randomBytes: (n: number) => Buffer.alloc(n),
    createHash: actual.createHash,
  }
})

// Заглушка для fetch в сетевых тестах
vi.stubGlobal("fetch", vi.fn())
