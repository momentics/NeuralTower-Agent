/**
 * Тесты интеграции MCPEngine и ToolHandler.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Подмена NtGraphDb для избежания реальной БД
vi.mock("../../repo/ntgraph/index", () => {
  const mockQueryBuilder = {
    getAllNodeNames: vi.fn(() => []),
    getAllFilePaths: vi.fn(() => []),
    getNodesByName: vi.fn(() => []),
    getNodeById: vi.fn(() => null),
    getNodesByKind: vi.fn(() => []),
    getNodesByFile: vi.fn(() => []),
    getNodesByQualifiedNameExact: vi.fn(() => []),
    getNodesByLowerName: vi.fn(() => []),
    getOutgoingEdges: vi.fn(() => []),
    getIncomingEdges: vi.fn(() => []),
    getNodesByIds: vi.fn(() => new Map()),
    getUnresolvedReferences: vi.fn(() => []),
    getUnresolvedReferencesCount: vi.fn(() => 0),
    getUnresolvedReferencesBatch: vi.fn(() => []),
    insertNode: vi.fn(),
    insertNodes: vi.fn(),
    insertEdge: vi.fn(),
    insertEdges: vi.fn(),
    insertUnresolvedRef: vi.fn(),
    insertUnresolvedRefsBatch: vi.fn(),
    deleteSpecificResolvedReferences: vi.fn(),
    getStats: vi.fn(() => ({
      nodeCount: 0,
      edgeCount: 0,
      fileCount: 0,
      nodesByKind: {},
      edgesByKind: {},
      filesByLanguage: {},
      dbSizeBytes: 0,
      lastUpdated: Date.now(),
    })),
    getAllFiles: vi.fn(() => []),
  };

  class MockNtGraphDb {
    initialize = vi.fn();
    close = vi.fn();
    queryBuilder = mockQueryBuilder;
    getFileByPath = vi.fn(() => null);
    deleteFile = vi.fn();
    upsertFile = vi.fn();
    getNodesByKind = vi.fn(() => []);
    getNodeById = vi.fn(() => null);
    getNodesByName = vi.fn(() => []);
    getOutgoingEdges = vi.fn(() => []);
    getIncomingEdges = vi.fn(() => []);
    getAllFiles = vi.fn(() => []);
    getUnresolvedReferences = vi.fn(() => []);
    getStats = vi.fn(() => ({
      nodeCount: 0,
      edgeCount: 0,
      fileCount: 0,
      nodesByKind: {},
      edgesByKind: {},
      filesByLanguage: {},
      dbSizeBytes: 0,
      lastUpdated: Date.now(),
    }));
    enableWalValve = vi.fn();
    disableWalValve = vi.fn();
    foldWalNow = vi.fn();
    setMetadata = vi.fn();
  }

  return {
    NtGraphDb: MockNtGraphDb,
  };
});

// Подмена fs для контроля findNtGraphRoot
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof fs>("fs");
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    statSync: vi.fn(() => ({ isDirectory: () => false })),
  };
});

describe("MCPEngine and ToolHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("MCPEngine", () => {
    it("ensureInitialized creates ToolHandler", async () => {
      const { MCPEngine } = await import("./Engine");
      const engine = new MCPEngine();
      await engine.ensureInitialized("/some/path");
      const handler = engine.getToolHandler();
      expect(handler).toBeDefined();
    });

    it("lazy init — ToolHandler created on first ensureInitialized() call", async () => {
      const { MCPEngine } = await import("./Engine");
      const engine = new MCPEngine();
      await engine.ensureInitialized("/some/path");
      const handler = engine.getToolHandler();
      expect(handler).toBeDefined();
    });

    it("stop closes all cached connections", async () => {
      const { MCPEngine } = await import("./Engine");
      const engine = new MCPEngine();
      await engine.ensureInitialized("/some/path");
      const handler = engine.getToolHandler();
      const closeSpy = vi.spyOn(handler, "closeAll");
      engine.stop();
      expect(closeSpy).toHaveBeenCalled();
    });

    it("setProjectPathHint sets default project hint", async () => {
      const { MCPEngine } = await import("./Engine");
      const engine = new MCPEngine();
      engine.setProjectPathHint("/hint/path");
      await engine.ensureInitialized("/some/path");
      const handler = engine.getToolHandler();
      expect(handler.getDefaultProjectHint()).toBe("/hint/path");
    });

    it("catchUpSync sets catch-up gate", async () => {
      const { MCPEngine } = await import("./Engine");
      const engine = new MCPEngine();
      await engine.ensureInitialized("/some/path");
      const handler = engine.getToolHandler();
      const setGateSpy = vi.spyOn(handler, "setCatchUpGate");
      engine.catchUpSync();
      expect(setGateSpy).toHaveBeenCalled();
    });

    it("retryInitializeSync initializes if not already initialized", async () => {
      const { MCPEngine } = await import("./Engine");
      const engine = new MCPEngine();
      engine.retryInitializeSync("/some/path");
      // Ожидание асинхронной инициализации
      await new Promise((resolve) => setTimeout(resolve, 50));
      const handler = engine.getToolHandler();
      expect(handler).toBeDefined();
    });
  });

  describe("ToolHandler", () => {
    it("getTools returns all tool definitions", async () => {
      const { ToolHandler } = await import("./ToolHandler");
      const handler = new ToolHandler();
      const tools = handler.getTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools).toBeInstanceOf(Array);
    });

    it("execute with unknown tool returns error", async () => {
      const { ToolHandler } = await import("./ToolHandler");
      const handler = new ToolHandler();
      const result = await handler.execute("unknown_tool", { projectPath: "/some/path" });
      expect(result.isError).toBe(true);
    });

    it("execute with disallowed tool returns error", async () => {
      const { ToolHandler } = await import("./ToolHandler");
      vi.stubEnv("NTGRAPH_MCP_TOOLS", "ntgraph_search");
      const handler = new ToolHandler();
      const result = await handler.execute("ntgraph_explore", { projectPath: "/some/path" });
      expect(result.isError).toBe(true);
    });

    it("execute without project path returns error", async () => {
      const { ToolHandler } = await import("./ToolHandler");
      const handler = new ToolHandler();
      const result = await handler.execute("ntgraph_search", { query: "test" });
      expect(result.isError).toBe(true);
    });

    it("toolAllowlist returns correct allowlist", async () => {
      const { ToolHandler } = await import("./ToolHandler");
      const handler = new ToolHandler();
      const allowlist = handler.toolAllowlist();
      expect(allowlist.size).toBeGreaterThan(0);
      expect(allowlist.has("ntgraph_search")).toBe(true);
    });

    it("isToolAllowed returns true for allowed tools", async () => {
      const { ToolHandler } = await import("./ToolHandler");
      const handler = new ToolHandler();
      expect(handler.isToolAllowed("ntgraph_search")).toBe(true);
    });

    it("groupDefinitions groups nodes by file path", async () => {
      const { ToolHandler } = await import("./ToolHandler");
      const handler = new ToolHandler();
      const nodes = [
        { filePath: "/a.ts" },
        { filePath: "/b.ts" },
        { filePath: "/a.ts" },
      ];
      const groups = handler.groupDefinitions(nodes);
      expect(groups.size).toBe(2);
      expect(groups.get("/a.ts")!.length).toBe(2);
      expect(groups.get("/b.ts")!.length).toBe(1);
    });

    it("withWorktreeNotice adds notice to text", async () => {
      const { ToolHandler } = await import("./ToolHandler");
      const handler = new ToolHandler();
      const testDir = "/test/project";
      vi.spyOn(fs, "existsSync").mockImplementation((p: string) => {
        return p === path.join(testDir, ".ntgraph");
      });
      vi.spyOn(fs, "statSync").mockReturnValue({
        isDirectory: () => true,
      } as fs.Stats);
      const result = handler.withWorktreeNotice("original text", testDir);
      expect(result).toContain("original text");
      expect(result).toContain("[⚠️ Индекс из");
    });

    it("withStalenessNotice adds staleness notice", async () => {
      const { ToolHandler } = await import("./ToolHandler");
      const handler = new ToolHandler();
      const testDir = "/test/project";
      vi.spyOn(fs, "existsSync").mockImplementation((p: string) => {
        return p === path.join(testDir, ".ntgraph")
          || p === path.join(testDir, ".ntgraph", "ntgraph.db");
      });
      vi.spyOn(fs, "statSync").mockReturnValue({
        isDirectory: () => true,
      } as fs.Stats);
      const dbInstance = handler.getNtGraph(testDir);
      vi.spyOn(dbInstance, "getUnresolvedReferences").mockReturnValue([{ id: "1" }]);
      const result = handler.withStalenessNotice("original text", testDir);
      expect(result).toContain("original text");
      expect(result).toContain("неразрешённых ссылок");
    });

    it("awaitCatchUpGate waits for catch-up", async () => {
      const { ToolHandler } = await import("./ToolHandler");
      const handler = new ToolHandler();
      let resolved = false;
      const gate = new Promise<void>((resolve) => {
        resolved = false;
        setTimeout(() => {
          resolved = true;
          resolve();
        }, 10);
      });
      handler.setCatchUpGate(gate);
      await handler.awaitCatchUpGate();
      expect(resolved).toBe(true);
    });

    it("findAllSymbols returns empty result", async () => {
      const { ToolHandler } = await import("./ToolHandler");
      const handler = new ToolHandler();
      const result = handler.findAllSymbols("testSymbol");
      expect(result.nodes).toEqual([]);
      expect(result.note).toBe("");
    });
  });

  describe("NTGRAPH_MCP_TOOLS env variable", () => {
    it("filters tools by env variable", async () => {
      const { ToolHandler } = await import("./ToolHandler");
      vi.stubEnv("NTGRAPH_MCP_TOOLS", "ntgraph_search,ntgraph_explore");
      const handler = new ToolHandler();
      const tools = handler.getTools();
      expect(tools.length).toBe(2);
      const names = tools.map((t) => t.name);
      expect(names).toContain("ntgraph_search");
      expect(names).toContain("ntgraph_explore");
    });
  });
});
