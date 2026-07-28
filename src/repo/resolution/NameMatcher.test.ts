/**
 * Тесты сопоставления имён.
 *
 * Проверяют: matchReference, matchFunctionRef, sameLanguageFamily, crossesKnownFamily.
 */

import { describe, it, expect } from "vitest"
import { sameLanguageFamily, crossesKnownFamily, matchCppCallChain } from "../resolution/NameMatcher"
import type { IResolutionContext, INode, IEdge } from "../ntgraph/Types"

describe("NameMatcher", () => {
  describe("sameLanguageFamily", () => {
    it("TypeScript and JavaScript are same family", () => {
      expect(sameLanguageFamily('typescript', 'javascript')).toBe(true)
      expect(sameLanguageFamily('tsx', 'jsx')).toBe(true)
      expect(sameLanguageFamily('typescript', 'jsx')).toBe(true)
    })

    it("JVM languages are same family", () => {
      expect(sameLanguageFamily('java', 'kotlin')).toBe(true)
      expect(sameLanguageFamily('java', 'scala')).toBe(true)
      expect(sameLanguageFamily('kotlin', 'scala')).toBe(true)
    })

    it("C languages are same family", () => {
      expect(sameLanguageFamily('c', 'cpp')).toBe(true)
    })

    it("Apple languages are same family", () => {
      expect(sameLanguageFamily('swift', 'objc')).toBe(true)
    })

    it("Different families return false", () => {
      expect(sameLanguageFamily('python', 'go')).toBe(false)
      expect(sameLanguageFamily('java', 'csharp')).toBe(false)
      expect(sameLanguageFamily('python', 'javascript')).toBe(false)
    })

    it("Same language returns true", () => {
      expect(sameLanguageFamily('python', 'python')).toBe(true)
      expect(sameLanguageFamily('go', 'go')).toBe(true)
      expect(sameLanguageFamily('rust', 'rust')).toBe(true)
    })

    it("Unknown languages are compared literally", () => {
      expect(sameLanguageFamily('unknown', 'unknown')).toBe(true)
      expect(sameLanguageFamily('unknown', 'python')).toBe(false)
    })
  })

  describe("crossesKnownFamily", () => {
    it("returns true for cross-family references", () => {
      expect(crossesKnownFamily('python', 'go')).toBe(true)
      expect(crossesKnownFamily('java', 'csharp')).toBe(true)
    })

    it("returns false for same-family references", () => {
      expect(crossesKnownFamily('typescript', 'javascript')).toBe(false)
      expect(crossesKnownFamily('java', 'kotlin')).toBe(false)
    })

    it("returns false for same language", () => {
      expect(crossesKnownFamily('python', 'python')).toBe(false)
    })
  })

  describe("matchCppCallChain", () => {
    function createContext(nodes: INode[]): IResolutionContext {
      const nodeMap = new Map(nodes.map(n => [n.id, n]));
      return {
        getNodeById: (id: string) => nodeMap.get(id) ?? null,
        getNodesByKind: () => [],
        getNodesByQualifiedName: () => [],
        getNodesByLowerName: () => [],
        getSupertypes: () => [],
        getChildren: () => [],
        getAncestors: () => [],
        getIncomingEdges: () => [],
        getOutgoingEdges: () => [],
        getNodesByFile: () => [],
        getNodesByName: (name: string) => nodes.filter(n => n.name === name),
        getImportMappings: () => [],
        getReExports: () => [],
        getFileContent: () => null,
        getFilePathFromNodeId: () => null,
        getLanguageFromNodeId: () => null,
        getDetectedFrameworks: () => [],
        getAllFiles: () => [],
        listDirectories: () => [],
      };
    }

    it("resolves Widget::instance().render() chain", () => {
      const nodes: INode[] = [
        { id: 'widget', kind: 'class', name: 'Widget', qualifiedName: 'Widget', filePath: 'widget.hpp', language: 'cpp', startLine: 1, endLine: 10, startColumn: 0, endColumn: 0 },
        { id: 'instance', kind: 'method', name: 'instance', qualifiedName: 'Widget::instance', filePath: 'widget.hpp', language: 'cpp', startLine: 3, endLine: 3, startColumn: 0, endColumn: 0, returnType: 'Widget' },
        { id: 'render', kind: 'method', name: 'render', qualifiedName: 'Widget::render', filePath: 'widget.hpp', language: 'cpp', startLine: 5, endLine: 8, startColumn: 0, endColumn: 0 },
      ];
      const ctx = createContext(nodes);

      const ref = {
        fromNodeId: 'caller',
        referenceName: 'Widget::instance().render',
        referenceKind: 'calls',
        line: 10,
        column: 0,
        filePath: 'main.cpp',
        language: 'cpp',
      };

      const result = matchCppCallChain(ref, ctx);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.targetNodeId).toBe('render');
        expect(result.provenance).toBe('cpp-call-chain');
      }
    });

    it("returns null for non-C++ languages", () => {
      const ctx = createContext([]);
      const ref = {
        fromNodeId: 'caller',
        referenceName: 'Foo::bar().baz',
        referenceKind: 'calls',
        line: 1,
        column: 0,
        filePath: 'main.java',
        language: 'java',
      };

      expect(matchCppCallChain(ref, ctx)).toBeNull();
    });

    it("returns null when type not found", () => {
      const ctx = createContext([]);
      const ref = {
        fromNodeId: 'caller',
        referenceName: 'Widget::instance().render',
        referenceKind: 'calls',
        line: 10,
        column: 0,
        filePath: 'main.cpp',
        language: 'cpp',
      };

      expect(matchCppCallChain(ref, ctx)).toBeNull();
    });
  })
})
