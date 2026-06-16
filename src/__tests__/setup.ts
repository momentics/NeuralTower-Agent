import { vi } from "vitest"

// Заглушка для crypto.randomBytes при генерации HTML вебвью
vi.mock("crypto", () => ({
  default: {
    randomBytes: (n: number) => Buffer.alloc(n),
  },
  randomBytes: (n: number) => Buffer.alloc(n),
}))

// Заглушка для fetch в сетевых тестах
vi.stubGlobal("fetch", vi.fn())
