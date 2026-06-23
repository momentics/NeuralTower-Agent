import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NeuralTowerEmbeddingProvider } from "./NeuralTowerEmbeddingProvider"
import { BackendError, ConnectionError } from "../core/Errors"

const dim = 768
const emb = (v: number) => new Array(dim).fill(v)

describe("NeuralTowerEmbeddingProvider", () => {
  describe("constructor", () => {
    it("uses default config when no config provided", () => {
      const provider = new NeuralTowerEmbeddingProvider()
      expect(provider.modelName()).toBe("nomic-embed-text")
      expect(provider.dimension()).toBe(1536)
      expect(provider.isAvailable()).toBe(false)
    })

    it("uses custom config when provided", () => {
      const provider = new NeuralTowerEmbeddingProvider({
        baseUrl: "http://custom:9999",
        model: "custom-model",
        batchSize: 64,
        timeoutMs: 5000,
      })
      expect(provider.modelName()).toBe("custom-model")
    })
  })

  describe("isAvailable", () => {
    it("returns false initially", () => {
      const provider = new NeuralTowerEmbeddingProvider()
      expect(provider.isAvailable()).toBe(false)
    })
  })

  describe("dimension", () => {
    it("returns default dimension before availability check", () => {
      const provider = new NeuralTowerEmbeddingProvider()
      expect(provider.dimension()).toBe(1536)
    })
  })

  describe("modelName", () => {
    it("returns default model name", () => {
      const provider = new NeuralTowerEmbeddingProvider()
      expect(provider.modelName()).toBe("nomic-embed-text")
    })

    it("returns custom model name", () => {
      const provider = new NeuralTowerEmbeddingProvider({ model: "my-model" })
      expect(provider.modelName()).toBe("my-model")
    })
  })

  describe("embed", () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })

    it("returns zero vectors when provider not available", async () => {
      // Мокируем проверку доступности — она не выполняется
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no server")))

      const provider = new NeuralTowerEmbeddingProvider()
      const result = await provider.embed(["hello", "world"])

      expect(result).toHaveLength(2)
      expect(result[0]).toHaveLength(1536)
      expect(result[0]).toEqual(new Array(1536).fill(0))
      expect(result[1]).toEqual(new Array(1536).fill(0))
    })

    it("sends request in correct format on success", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [
            { embedding: emb(1) },
            { embedding: emb(2) },
          ],
        }),
      })
      vi.stubGlobal("fetch", fetchMock)

      const provider = new NeuralTowerEmbeddingProvider()
      const result = await provider.embed(["text1", "text2"])

      expect(result).toEqual([emb(1), emb(2)])
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:30000/v1/embeddings",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "nomic-embed-text",
            input: ["text1", "text2"],
          }),
        }),
      )
    })

    it("splits texts into batches when exceeding batch size", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          // Проверка доступности
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: [{ embedding: emb(1) }],
          }),
        })
        .mockResolvedValueOnce({
          // Первый батч
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: [{ embedding: emb(1) }, { embedding: emb(2) }],
          }),
        })
        .mockResolvedValueOnce({
          // Второй батч
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: [{ embedding: emb(3) }],
          }),
        })
      vi.stubGlobal("fetch", fetchMock)

      const provider = new NeuralTowerEmbeddingProvider({ batchSize: 2 })
      const result = await provider.embed(["a", "b", "c"])

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual(emb(1))
      expect(result[1]).toEqual(emb(2))
      expect(result[2]).toEqual(emb(3))
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it("handles missing data in response", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      })
      vi.stubGlobal("fetch", fetchMock)

      const provider = new NeuralTowerEmbeddingProvider()
      const result = await provider.embed(["text1", "text2"])

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual(new Array(1536).fill(0))
    })

    it("handles missing embedding in data item", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{}],
        }),
      })
      vi.stubGlobal("fetch", fetchMock)

      const provider = new NeuralTowerEmbeddingProvider()
      const result = await provider.embed(["text1"])

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(new Array(1536).fill(0))
    })

    it("throws BackendError on HTTP error after availability check", async () => {
      // Сначала проверка доступности проходит успешно, затем HTTP-ошибка
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: [{ embedding: emb(1) }],
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: vi.fn().mockResolvedValue("Internal Error"),
        })
      vi.stubGlobal("fetch", fetchMock)

      const provider = new NeuralTowerEmbeddingProvider()
      await expect(provider.embed(["text"])).rejects.toThrow(BackendError)
    })

    it("throws ConnectionError on timeout after availability check", async () => {
      // Сначала проверка доступности проходит успешно, затем таймаут
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: [{ embedding: emb(1) }],
          }),
        })
        .mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"))
      vi.stubGlobal("fetch", fetchMock)

      const provider = new NeuralTowerEmbeddingProvider({ timeoutMs: 100 })
      await expect(provider.embed(["text"])).rejects.toThrow(ConnectionError)
    })

    it("throws ConnectionError on network error after availability check", async () => {
      // Сначала проверка доступности проходит успешно, затем сетевая ошибка
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: [{ embedding: emb(1) }],
          }),
        })
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      vi.stubGlobal("fetch", fetchMock)

      const provider = new NeuralTowerEmbeddingProvider()
      await expect(provider.embed(["text"])).rejects.toThrow(ConnectionError)
    })
  })

  describe("checkAvailability", () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })

    it("sets available and dimension on successful check", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ embedding: emb(0.5) }],
        }),
      }))

      const provider = new NeuralTowerEmbeddingProvider()
      expect(provider.isAvailable()).toBe(false)

      await provider.embed(["test"])

      expect(provider.isAvailable()).toBe(true)
      expect(provider.dimension()).toBe(dim)
    })

    it("sets not available when check fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no server")))

      const provider = new NeuralTowerEmbeddingProvider()
      await provider.embed(["test"])

      expect(provider.isAvailable()).toBe(false)
    })

    it("uses detected dimension for zero vectors after failed availability", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no server")))

      const provider = new NeuralTowerEmbeddingProvider()
      const result = await provider.embed(["test"])

      expect(result).toHaveLength(1)
      expect(result[0]).toHaveLength(1536)
    })
  })
})
