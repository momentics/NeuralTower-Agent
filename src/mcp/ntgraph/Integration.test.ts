/**
 * Интеграционный тест production-wiring граф-индекса.
 *
 * Проверяет полную цепочку без моков БД:
 * openProjectGraphDb → ExtractionOrchestrator (storeExtractionResult +
 * resolveAndPersistBatched) → CodebaseSearch (FTS5) → MCP ToolHandler
 * (ntgraph_* инструменты) → инкрементальные обновления.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { openProjectGraphDb, getNtGraphDbPath } from "../../repo/ntgraph";
import type { NtGraphDb } from "../../repo/ntgraph";
import type { INode, IEdge, IFileRecord, IUnresolvedReference, IExtractionResult } from "../../repo/ntgraph/Types";
import { ExtractionOrchestrator } from "../../repo/extraction/Orchestrator";
import { CodebaseSearch } from "../../repo/CodebaseSearch";
import { InMemoryVectorStore } from "../../repo/InMemoryVectorStore";
import { ToolHandler } from "./ToolHandler";
import { NotIndexedError } from "./Errors";

const SRC_A = `import { helperB } from "./b";

export class UserService {
  async createUser(name: string): Promise<string> {
    return helperB(name);
  }
}
`;

const SRC_B = `export function helperB(name: string): string {
  return "user:" + name;
}
`;

function nodeId(filePath: string, kind: string, name: string, line: number): string {
  return createHash("sha256").update(`${filePath}:${kind}:${name}:${line}`).digest("hex");
}

function makeNode(partial: Omit<INode, "id" | "updatedAt"> & { id?: string }): INode {
  return {
    updatedAt: Date.now(),
    ...partial,
    id: partial.id ?? nodeId(partial.filePath, partial.kind, partial.name, partial.startLine),
  };
}

let projectRoot: string;
let emptyRoot: string;
let db: NtGraphDb;
let orchestrator: ExtractionOrchestrator;

function resultText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content.map((c) => c.text).join("\n");
}

/** Извлекает результат, эквивалентный работе экстрактора для src/a.ts. */
function extractionResultA(): IExtractionResult {
  const fileA = makeNode({
    kind: "file", name: "src/a.ts", qualifiedName: "src/a.ts",
    filePath: "src/a.ts", language: "typescript",
    startLine: 1, endLine: 8, startColumn: 0, endColumn: 0,
  });
  const cls = makeNode({
    kind: "class", name: "UserService",     qualifiedName: "UserService",
    filePath: "src/a.ts", language: "typescript",
    startLine: 3, endLine: 8, startColumn: 0, endColumn: 1, isExported: true,
  });
  const method = makeNode({
    kind: "method", name: "createUser",     qualifiedName: "UserService.createUser",
    filePath: "src/a.ts", language: "typescript",
    startLine: 4, endLine: 6, startColumn: 2, endColumn: 3,
    signature: "async createUser(name: string): Promise<string>", isAsync: true,
  });

  const edges: IEdge[] = [
    { source: fileA.id, target: cls.id, kind: "contains", provenance: "tree-sitter" },
    { source: cls.id, target: method.id, kind: "contains", provenance: "tree-sitter" },
  ];

  const refs: IUnresolvedReference[] = [
    {
      fromNodeId: method.id,
      referenceName: "helperB",
      referenceKind: "calls",
      line: 5,
      column: 11,
      filePath: "src/a.ts",
      language: "typescript",
    },
  ];

  return { nodes: [fileA, cls, method], edges, unresolvedReferences: refs, errors: [], durationMs: 1 };
}

/** Извлекает результат, эквивалентный работе экстрактора для src/b.ts. */
function extractionResultB(): IExtractionResult {
  const fileB = makeNode({
    kind: "file", name: "src/b.ts", qualifiedName: "src/b.ts",
    filePath: "src/b.ts", language: "typescript",
    startLine: 1, endLine: 3, startColumn: 0, endColumn: 0,
  });
  const fn = makeNode({
    kind: "function", name: "helperB",     qualifiedName: "helperB",
    filePath: "src/b.ts", language: "typescript",
    startLine: 1, endLine: 3, startColumn: 0, endColumn: 1,
    signature: "export function helperB(name: string): string", isExported: true,
  });

  const edges: IEdge[] = [
    { source: fileB.id, target: fn.id, kind: "contains", provenance: "tree-sitter" },
  ];

  return { nodes: [fileB, fn], edges, unresolvedReferences: [], errors: [], durationMs: 1 };
}

function fileRecord(relPath: string, content: string, nodeCount: number): IFileRecord {
  const stats = fs.statSync(path.join(projectRoot, relPath));
  return {
    path: relPath,
    contentHash: createHash("sha256").update(content).digest("hex"),
    language: "typescript",
    size: stats.size,
    modifiedAt: stats.mtimeMs,
    indexedAt: Date.now(),
    nodeCount,
  };
}

beforeAll(async () => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ntgraph-wiring-"));
  emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ntgraph-empty-"));

  fs.mkdirSync(path.join(projectRoot, "src"));
  fs.writeFileSync(path.join(projectRoot, "src", "a.ts"), SRC_A, "utf8");
  fs.writeFileSync(path.join(projectRoot, "src", "b.ts"), SRC_B, "utf8");

  // Production-путь создания БД (как в DI Container)
  db = openProjectGraphDb(projectRoot);
  orchestrator = new ExtractionOrchestrator(projectRoot, db);

  // Production-путь хранения (10-шаговый алгоритм storeExtractionResult)
  await orchestrator.storeExtractionResult(fileRecord("src/a.ts", SRC_A, 3), extractionResultA());
  await orchestrator.storeExtractionResult(fileRecord("src/b.ts", SRC_B, 2), extractionResultB());

  // Production-путь разрешения кросс-файловых ссылок
  await orchestrator.resolveAndPersistBatched();
});

afterAll(() => {
  db.close();
  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(emptyRoot, { recursive: true, force: true });
});

describe("production wiring: openProjectGraphDb", () => {
  it("creates .ntgraph/ntgraph.db inside the project root", () => {
    expect(fs.existsSync(getNtGraphDbPath(projectRoot))).toBe(true);
  });

  it("stores nodes, edges and file records", () => {
    const files = db.getAllFiles();
    expect(files.map((f) => f.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);

    expect(db.getNodesByName("UserService").some((n) => n.kind === "class")).toBe(true);
    expect(db.getNodesByName("helperB").some((n) => n.kind === "function")).toBe(true);
    expect(db.getNodesByName("createUser").some((n) => n.kind === "method")).toBe(true);
  });

  it("resolves the cross-file call edge (createUser -> helperB)", () => {
    const helperB = db.getNodesByName("helperB").find((n) => n.kind === "function");
    expect(helperB).toBeDefined();

    const callEdges = db.getIncomingEdges(helperB!.id).filter((e) => e.kind === "calls");
    expect(callEdges.length).toBeGreaterThanOrEqual(1);

    // Разрешённая ссылка удалена из unresolved_refs
    expect(db.getUnresolvedReferencesCount()).toBe(0);
  });
});

describe("production wiring: CodebaseSearch over NtGraphDb", () => {
  it("finds symbols via FTS5 keyword search", async () => {
    const search = CodebaseSearch.withGraphDb(new InMemoryVectorStore(), null, db);
    const results = await search.search("helperB", { topK: 5, searchMode: "keyword" });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.chunk.symbolName === "helperB")).toBe(true);
  });
});

describe("production wiring: MCP ntgraph tools over the real DB", () => {
  it("ntgraph_search finds symbols", async () => {
    const handler = new ToolHandler();
    try {
      const result = await handler.execute("ntgraph_search", {
        query: "UserService",
        projectPath: projectRoot,
      });

      expect(result.isError).toBeFalsy();
      expect(resultText(result)).toContain("UserService");
    } finally {
      handler.closeAll();
    }
  });

  it("ntgraph_status returns graph statistics", async () => {
    const handler = new ToolHandler();
    try {
      const result = await handler.execute("ntgraph_status", {
        projectPath: projectRoot,
      });

      expect(result.isError).toBeFalsy();
      const text = resultText(result);
      expect(text).toMatch(/Файлы:\*\* 2/);
      expect(text).toContain("Узлы:");
      expect(text).toContain("Рёбра:");
    } finally {
      handler.closeAll();
    }
  });

  it("ntgraph_node returns symbol info with code", async () => {
    const handler = new ToolHandler();
    try {
      const result = await handler.execute("ntgraph_node", {
        symbol: "helperB",
        includeCode: true,
        projectPath: projectRoot,
      });

      expect(result.isError).toBeFalsy();
      const text = resultText(result);
      expect(text).toContain("helperB");
      expect(text).toContain("src/b.ts");
    } finally {
      handler.closeAll();
    }
  });

  it("returns NotIndexedError semantics (textResult without isError) for unindexed project", async () => {
    const handler = new ToolHandler();
    try {
      const result = await handler.execute("ntgraph_search", {
        query: "anything",
        projectPath: emptyRoot,
      });

      expect(result.isError).toBeFalsy();
      expect(resultText(result)).toContain("Индекс не доступен");
    } finally {
      handler.closeAll();
    }
  });

  it("getNtGraph throws NotIndexedError for unindexed project", () => {
    const handler = new ToolHandler();
    try {
      expect(() => handler.getNtGraph(emptyRoot)).toThrow(NotIndexedError);
    } finally {
      handler.closeAll();
    }
  });
});

describe("production wiring: incremental update", () => {
  it("storeExtractionResult re-extracts a changed file and adds new nodes", async () => {
    const updatedB = SRC_B + `\nexport function helperC(x: number): number {\n  return x * 2;\n}\n`;
    fs.writeFileSync(path.join(projectRoot, "src", "b.ts"), updatedB, "utf8");

    const fileB = makeNode({
      kind: "file", name: "src/b.ts", qualifiedName: "src/b.ts",
      filePath: "src/b.ts", language: "typescript",
      startLine: 1, endLine: 7, startColumn: 0, endColumn: 0,
    });
    const fnB = makeNode({
      kind: "function", name: "helperB",     qualifiedName: "helperB",
      filePath: "src/b.ts", language: "typescript",
      startLine: 1, endLine: 3, startColumn: 0, endColumn: 1,
      signature: "export function helperB(name: string): string", isExported: true,
    });
    const fnC = makeNode({
      kind: "function", name: "helperC",     qualifiedName: "helperC",
      filePath: "src/b.ts", language: "typescript",
      startLine: 4, endLine: 6, startColumn: 0, endColumn: 1,
      signature: "export function helperC(x: number): number", isExported: true,
    });

    const result: IExtractionResult = {
      nodes: [fileB, fnB, fnC],
      edges: [
        { source: fileB.id, target: fnB.id, kind: "contains", provenance: "tree-sitter" },
        { source: fileB.id, target: fnC.id, kind: "contains", provenance: "tree-sitter" },
      ],
      unresolvedReferences: [],
      errors: [],
      durationMs: 1,
    };

    await orchestrator.storeExtractionResult(fileRecord("src/b.ts", updatedB, 3), result);

    expect(db.getNodesByName("helperC").some((n) => n.kind === "function")).toBe(true);
    // Старый узел helperB сохранён (перезапись файла, а не удаление)
    expect(db.getNodesByName("helperB").some((n) => n.kind === "function")).toBe(true);
  });

  it("indexFile runs the in-process extraction path", async () => {
    const result = await orchestrator.indexFile("src/a.ts");

    // Реальный WASM-парсинг: узлы извлечены, без parse_error
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.errors.filter((e) => e.code === "parse_error")).toHaveLength(0);
  });
});
