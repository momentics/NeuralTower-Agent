/**
 * Тесты форматирования контекста.
 *
 * Проверяют: formatContextAsMarkdown и formatContextAsJson.
 */

import { describe, it, expect } from "vitest"
import { formatContextAsMarkdown, formatContextAsJson } from "../context/Formatter"
import type { TaskContext, INode, IGraphStats, NodeKind, EdgeKind } from "../ntgraph/Types"

describe("Formatter", () => {
  const createMockTaskContext = (): TaskContext => {
    const node: INode = {
      id: "n1",
      kind: "function",
      name: "hello",
      qualifiedName: "hello",
      filePath: "src/main.ts",
      language: "typescript",
      startLine: 1,
      endLine: 5,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }

    const nodes = new Map<string, INode>([["n1", node]])
    const stats: IGraphStats = {
      nodeCount: 1,
      edgeCount: 0,
      fileCount: 1,
      nodesByKind: {} as Record<NodeKind, number>,
      edgesByKind: {} as Record<EdgeKind, number>,
      filesByLanguage: {},
      dbSizeBytes: 0,
      lastUpdated: Date.now(),
    }

    return {
      query: "hello function",
      subgraph: { nodes, edges: [], roots: ["n1"] },
      entryPoints: [node],
      codeBlocks: [],
      relatedFiles: ["src/main.ts"],
      summary: "Найдено 1 узел",
      stats,
    }
  }

  describe("formatContextAsMarkdown", () => {
    it("produces valid markdown output", () => {
      const context = createMockTaskContext()
      const output = formatContextAsMarkdown(context)
      expect(output).toContain("# Контекст задачи")
      expect(output).toContain("## Статистика")
      expect(output).toContain("## Точки входа")
      expect(output).toContain("hello")
    })

    it("includes related files", () => {
      const context = createMockTaskContext()
      const output = formatContextAsMarkdown(context)
      expect(output).toContain("src/main.ts")
    })

    it("includes low confidence note when confidence is low", () => {
      const context = createMockTaskContext()
      context.subgraph.confidence = "low"
      const output = formatContextAsMarkdown(context)
      expect(output).toContain("__LOW_CONFIDENCE_HANDOFF__")
    })
  })

  describe("formatContextAsJson", () => {
    it("produces valid JSON output", () => {
      const context = createMockTaskContext()
      const output = formatContextAsJson(context)
      const parsed = JSON.parse(output)
      expect(parsed.query).toBe("hello function")
      expect(parsed.nodes).toHaveLength(1)
      expect(parsed.nodes[0].name).toBe("hello")
    })

    it("includes entry points", () => {
      const context = createMockTaskContext()
      const output = formatContextAsJson(context)
      const parsed = JSON.parse(output)
      expect(parsed.entryPoints).toHaveLength(1)
    })
  })
})
