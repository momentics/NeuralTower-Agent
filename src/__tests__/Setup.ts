import { vi } from "vitest"

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
