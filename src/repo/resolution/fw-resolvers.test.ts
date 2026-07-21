/**
 * Комплексные тесты фреймворк-резолверов.
 *
 * Проверяет обнаружение, разрешение ссылок, экстракцию и postExtract
 * для всех зарегистрированных фреймворк-резолверов.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { NtGraphDb, QueryBuilder, INode, IEdge, IUnresolvedReference, NodeKind, EdgeKind, Language, IFileRecord, IResolutionContext } from "../ntgraph/index"
import { ReferenceResolver } from "./Resolver"
import * as os from "os"
import * as fs from "fs/promises"
import * as path from "path"
import * as fsSync from "fs"

// Регистрация всех фреймворк-резолверов
import './fw-resolvers'

import { detectFrameworks, getAllFrameworkResolvers, getApplicableFrameworks } from './Frameworks'

describe("Framework Resolvers", () => {
  let ntDb: NtGraphDb
  let qb: QueryBuilder
  let tmpDir: string
  let cwdFiles: string[] = []

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `ntgraph-fw-${Date.now()}-${Math.random()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    const dbPath = path.join(tmpDir, "test.db")
    ntDb = new NtGraphDb(dbPath)
    ntDb.initialize()
    qb = ntDb.queryBuilder
  })

  afterEach(async () => {
    ntDb.close()
    await fs.rm(tmpDir, { recursive: true, force: true })
    for (const f of cwdFiles) {
      try {
        await fs.rm(f, { recursive: true, force: true })
      } catch { /* ignore */ }
    }
    cwdFiles = []
  })

  // ===================================================================
  // Вспомогательные функции
  // ===================================================================

  function insertNode(
    id: string,
    kind: NodeKind,
    name: string,
    filePath: string,
    language: Language,
    startLine: number = 1,
    endLine: number = 10,
    qualifiedName?: string
  ): INode {
    const node: INode = {
      id,
      kind,
      name,
      qualifiedName: qualifiedName || name,
      filePath,
      language,
      startLine,
      endLine,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    }
    qb.insertNode(node)
    return node
  }

  function insertEdge(source: string, target: string, kind: EdgeKind): void {
    qb.insertEdge({ source, target, kind })
  }

  function insertFileRecord(filePath: string, language: Language): void {
    const record: IFileRecord = {
      path: filePath,
      contentHash: "dummy",
      language,
      size: 0,
      modifiedAt: Date.now(),
      indexedAt: Date.now(),
      nodeCount: 0,
    }
    qb.upsertFile(record)
  }

  function writeCwdFile(relPath: string, content: string): void {
    const fullPath = path.join(process.cwd(), relPath)
    fsSync.mkdirSync(path.dirname(fullPath), { recursive: true })
    fsSync.writeFileSync(fullPath, content)
    cwdFiles.push(fullPath)
  }

  function makeResolver(): ReferenceResolver {
    const r = new ReferenceResolver(tmpDir, qb)
    r.warmCaches()
    return r
  }

  function makeResolverAndInit(): ReferenceResolver {
    const r = new ReferenceResolver(tmpDir, qb)
    r.initialize()
    return r
  }

  // ===================================================================
  // Тесты обнаружения фреймворков
  // ===================================================================

  describe("detectFrameworks", () => {
    it("returns React resolver for project with JSX files", () => {
      insertFileRecord("src/App.tsx", "typescript")
      const resolver = makeResolverAndInit()
      const frameworks = resolver.getDetectedFrameworks()
      expect(frameworks).toContain("React")
    })

    it("returns Laravel resolver for project with artisan", () => {
      insertFileRecord("artisan", "php")
      const resolver = makeResolverAndInit()
      const frameworks = resolver.getDetectedFrameworks()
      expect(frameworks).toContain("Laravel")
    })

    it("returns Vue resolver for project with .vue files", () => {
      insertFileRecord("src/App.vue", "vue")
      const resolver = makeResolverAndInit()
      const frameworks = resolver.getDetectedFrameworks()
      expect(frameworks).toContain("Vue")
    })

    it("returns Flask resolver for project with flask in requirements.txt", () => {
      writeCwdFile("requirements.txt", "flask==2.0\nrequests==2.28\n")
      insertFileRecord("requirements.txt", "python")
      const resolver = makeResolverAndInit()
      const frameworks = resolver.getDetectedFrameworks()
      expect(frameworks).toContain("Flask")
    })

    it("returns Spring Boot resolver for project with pom.xml containing spring-boot", () => {
      writeCwdFile("pom.xml", '<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter</artifactId></dependency>')
      insertFileRecord("pom.xml", "java")
      const resolver = makeResolverAndInit()
      const frameworks = resolver.getDetectedFrameworks()
      expect(frameworks).toContain("Spring Boot")
    })

    it("returns Express resolver for project with routes directory", () => {
      writeCwdFile("routes/index.ts", "app.get('/users', handler)")
      insertFileRecord("routes/index.ts", "typescript")
      const resolver = makeResolverAndInit()
      const frameworks = resolver.getDetectedFrameworks()
      expect(frameworks).toContain("Express")
    })

    it("returns Django resolver for project with manage.py", () => {
      insertFileRecord("manage.py", "python")
      const resolver = makeResolverAndInit()
      const frameworks = resolver.getDetectedFrameworks()
      expect(frameworks).toContain("Django")
    })
  })

  // ===================================================================
  // Тесты getAllFrameworkResolvers и getApplicableFrameworks
  // ===================================================================

  describe("Framework registry", () => {
    it("getAllFrameworkResolvers returns all registered resolvers", () => {
      const resolvers = getAllFrameworkResolvers()
      expect(resolvers.length).toBeGreaterThan(0)
      const names = resolvers.map(r => r.name)
      expect(names).toContain("React")
      expect(names).toContain("Express")
      expect(names).toContain("Laravel")
      expect(names).toContain("Vue")
      expect(names).toContain("Django")
      expect(names).toContain("Flask")
      expect(names).toContain("FastAPI")
      expect(names).toContain("Spring Boot")
      expect(names).toContain("NestJS")
    })

    it("getApplicableFrameworks filters by language", () => {
      insertFileRecord("src/App.tsx", "typescript")
      insertFileRecord("artisan", "php")
      const resolver = makeResolverAndInit()
      const frameworks = resolver.getDetectedFrameworks()
      const allResolvers = getAllFrameworkResolvers()
      const detected = allResolvers.filter(r => frameworks.includes(r.name))
      const tsApplicable = getApplicableFrameworks(detected, "typescript")
      const phpApplicable = getApplicableFrameworks(detected, "php")
      const tsNames = tsApplicable.map(r => r.name)
      const phpNames = phpApplicable.map(r => r.name)
      expect(tsNames).toContain("React")
      expect(phpNames).toContain("Laravel")
    })
  })

  // ===================================================================
  // Тесты claimsReference
  // ===================================================================

  describe("claimsReference pre-filter", () => {
    it("passes Controller@method through pre-filter (Laravel)", () => {
      insertFileRecord("artisan", "php")
      makeResolverAndInit()
      const laravelResolver = getAllFrameworkResolvers().find(r => r.name === "Laravel")!
      expect(laravelResolver.claimsReference?.("UserController@store")).toBe(true)
      expect(laravelResolver.claimsReference?.("normalName")).toBe(false)
    })

    it("passes Model::method through pre-filter (Laravel)", () => {
      insertFileRecord("artisan", "php")
      makeResolverAndInit()
      const laravelResolver = getAllFrameworkResolvers().find(r => r.name === "Laravel")!
      expect(laravelResolver.claimsReference?.("User::find")).toBe(true)
      expect(laravelResolver.claimsReference?.("normalName")).toBe(false)
    })

    it("passes _iterable_class through pre-filter (Django)", () => {
      insertFileRecord("manage.py", "python")
      makeResolverAndInit()
      const djangoResolver = getAllFrameworkResolvers().find(r => r.name === "Django")!
      expect(djangoResolver.claimsReference?.("_iterable_class")).toBe(true)
      expect(djangoResolver.claimsReference?.("normalName")).toBe(false)
    })

    it("passes config-key with colon through pre-filter (Spring)", () => {
      insertFileRecord("pom.xml", "java")
      makeResolverAndInit()
      const springResolver = getAllFrameworkResolvers().find(r => r.name === "Spring Boot")!
      expect(springResolver.claimsReference?.("app:database:url")).toBe(true)
      expect(springResolver.claimsReference?.("normalName")).toBe(false)
    })

    it("passes Controller.method through pre-filter (Express)", () => {
      writeCwdFile("routes/index.ts", "app.get('/users', handler)")
      insertFileRecord("routes/index.ts", "typescript")
      makeResolverAndInit()
      const expressResolver = getAllFrameworkResolvers().find(r => r.name === "Express")!
      expect(expressResolver.claimsReference?.("UserController.getAll")).toBe(true)
      expect(expressResolver.claimsReference?.("normalName")).toBe(false)
    })

    it("passes defineProps through pre-filter (Vue)", () => {
      insertFileRecord("src/App.vue", "vue")
      makeResolverAndInit()
      const vueResolver = getAllFrameworkResolvers().find(r => r.name === "Vue")!
      expect(vueResolver.claimsReference?.("defineProps")).toBe(true)
      expect(vueResolver.claimsReference?.("normalName")).toBe(false)
    })

    it("passes useRoute through pre-filter (Vue)", () => {
      insertFileRecord("src/App.vue", "vue")
      makeResolverAndInit()
      const vueResolver = getAllFrameworkResolvers().find(r => r.name === "Vue")!
      expect(vueResolver.claimsReference?.("useRoute")).toBe(true)
      expect(vueResolver.claimsReference?.("normalName")).toBe(false)
    })

    it("passes *_router through pre-filter (FastAPI)", () => {
      writeCwdFile("requirements.txt", "fastapi==0.100\n")
      insertFileRecord("requirements.txt", "python")
      makeResolverAndInit()
      const fastapiResolver = getAllFrameworkResolvers().find(r => r.name === "FastAPI")!
      expect(fastapiResolver.claimsReference?.("api_router")).toBe(true)
      expect(fastapiResolver.claimsReference?.("normalName")).toBe(false)
    })
  })

  // ===================================================================
  // Тесты разрешения React
  // ===================================================================

  describe("React resolve", () => {
    it("resolves PascalCase component from JSX file", () => {
      insertFileRecord("src/App.tsx", "typescript")
      insertNode("comp-header", "component", "Header", "src/Header.tsx", "typescript")
      const resolver = makeResolverAndInit()

      const ref: IUnresolvedReference = {
        fromNodeId: "src/App.tsx",
        referenceName: "Header",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "typescript",
        filePath: "src/App.tsx",
      }

      const result = resolver.resolveOne(ref)
      expect(result).not.toBeNull()
      expect(result!.targetNodeId).toBe("comp-header")
      expect(result!.provenance).toBe("react-component")
    })

    it("resolves use* hook from JSX file", () => {
      insertFileRecord("src/App.tsx", "typescript")
      insertNode("hook-useAuth", "function", "useAuth", "src/hooks/useAuth.ts", "typescript")
      const resolver = makeResolverAndInit()

      const ref: IUnresolvedReference = {
        fromNodeId: "src/App.tsx",
        referenceName: "useAuth",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "typescript",
        filePath: "src/App.tsx",
      }

      const result = resolver.resolveOne(ref)
      expect(result).not.toBeNull()
      expect(result!.targetNodeId).toBe("hook-useAuth")
      expect(result!.provenance).toBe("react-hook")
    })
  })

  // ===================================================================
  // Тесты экстракции Express
  // ===================================================================

  describe("Express extract", () => {
    it("extracts route from app.get('/path', handler)", () => {
      const expressResolver = getAllFrameworkResolvers().find(r => r.name === "Express")!
      const content = "app.get('/users', usersController.getAll);"
      const result = expressResolver.extract!("/routes/index.ts", content)
      expect(result.nodes.length).toBeGreaterThan(0)
      expect(result.nodes[0]!.kind).toBe(NodeKind.Route)
      expect(result.nodes[0]!.name).toBe("GET /users")
    })
  })

  // ===================================================================
  // Тесты экстракции Laravel
  // ===================================================================

  describe("Laravel extract", () => {
    it("extracts route from Route::get('/path', [Controller::class, 'method'])", () => {
      const laravelResolver = getAllFrameworkResolvers().find(r => r.name === "Laravel")!
      const content = "Route::get('/users', [UserController::class, 'index']);"
      const result = laravelResolver.extract!("/routes/web.php", content)
      expect(result.nodes.length).toBeGreaterThan(0)
      expect(result.nodes[0]!.kind).toBe(NodeKind.Route)
      expect(result.nodes[0]!.name).toBe("GET /users")
      expect(result.references.length).toBeGreaterThan(0)
      expect(result.references[0]!.referenceName).toBe("UserController@index")
    })
  })

  // ===================================================================
  // Тесты разрешения Express Controller.method
  // ===================================================================

  describe("Express resolve", () => {
    it("resolves Controller.method reference", () => {
      writeCwdFile("routes/index.ts", "app.get('/users', handler)")
      insertFileRecord("routes/index.ts", "typescript")
      insertNode("ctrl-users", "class", "UsersController", "src/controllers/UsersController.ts", "typescript")
      insertNode("meth-getAll", "method", "getAll", "src/controllers/UsersController.ts", "typescript")
      insertEdge("ctrl-users", "meth-getAll", "contains")
      const resolver = makeResolverAndInit()

      const ref: IUnresolvedReference = {
        fromNodeId: "routes/index.ts",
        referenceName: "UsersController.getAll",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "typescript",
        filePath: "routes/index.ts",
      }

      const result = resolver.resolveOne(ref)
      expect(result).not.toBeNull()
      expect(result!.targetNodeId).toBe("meth-getAll")
      expect(result!.provenance).toBe("express-controller")
    })
  })

  // ===================================================================
  // Тесты разрешения Laravel Model::method
  // ===================================================================

  describe("Laravel resolve", () => {
    it("resolves Model::method reference", () => {
      insertFileRecord("artisan", "php")
      insertNode("model-user", "class", "User", "app/Models/User.php", "php")
      insertNode("meth-find", "method", "find", "app/Models/User.php", "php")
      insertEdge("model-user", "meth-find", "contains")
      const resolver = makeResolverAndInit()

      const ref: IUnresolvedReference = {
        fromNodeId: "artisan",
        referenceName: "User::find",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "php",
        filePath: "artisan",
      }

      const result = resolver.resolveOne(ref)
      expect(result).not.toBeNull()
      expect(result!.targetNodeId).toBe("meth-find")
      expect(result!.provenance).toBe("laravel-eloquent")
    })
  })

  // ===================================================================
  // Тесты разрешения Vue
  // ===================================================================

  describe("Vue resolve", () => {
    it("resolves compiler macro defineProps", () => {
      insertFileRecord("src/App.vue", "vue")
      insertNode("file-vue", "file", "App", "src/App.vue", "vue")
      const resolver = makeResolverAndInit()

      const ref: IUnresolvedReference = {
        fromNodeId: "file-vue",
        referenceName: "defineProps",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "vue",
        filePath: "src/App.vue",
      }

      const result = resolver.resolveOne(ref)
      expect(result).not.toBeNull()
      expect(result!.targetNodeId).toBe("file-vue")
      expect(result!.provenance).toBe("vue-macro")
    })

    it("resolves Nuxt auto-import useRoute", () => {
      insertFileRecord("src/App.vue", "vue")
      insertNode("file-vue", "file", "App", "src/App.vue", "vue")
      const resolver = makeResolverAndInit()

      const ref: IUnresolvedReference = {
        fromNodeId: "file-vue",
        referenceName: "useRoute",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "vue",
        filePath: "src/App.vue",
      }

      const result = resolver.resolveOne(ref)
      expect(result).not.toBeNull()
      expect(result!.targetNodeId).toBe("file-vue")
      expect(result!.provenance).toBe("nuxt-auto-import")
    })
  })

  // ===================================================================
  // Тесты разрешения FastAPI *_router
  // ===================================================================

  describe("FastAPI resolve", () => {
    it("resolves *_router reference", () => {
      writeCwdFile("requirements.txt", "fastapi==0.100\n")
      insertFileRecord("requirements.txt", "python")
      insertNode("router-api", "function", "api_router", "app/api.py", "python")
      const resolver = makeResolverAndInit()

      const ref: IUnresolvedReference = {
        fromNodeId: "app/main.py",
        referenceName: "api_router",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "python",
        filePath: "app/main.py",
      }

      const result = resolver.resolveOne(ref)
      expect(result).not.toBeNull()
      expect(result!.targetNodeId).toBe("router-api")
      expect(result!.provenance).toBe("fastapi-router")
    })
  })

  // ===================================================================
  // Тесты разрешения Spring config-key
  // ===================================================================

  describe("Spring resolve", () => {
    it("resolves @Value config-key to YAML leaf-key via colon separator", () => {
      writeCwdFile("pom.xml", '<dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter</artifactId></dependency>')
      insertFileRecord("pom.xml", "java")
      insertNode("config-key", "constant", "app.database.url", "src/main/resources/application.yml", "yaml")
      const resolver = makeResolverAndInit()

      // Verify setup
      const frameworks = resolver.getDetectedFrameworks()
      expect(frameworks).toContain("Spring Boot")
      const configNodes = resolver.getNodesByName("app.database.url")
      expect(configNodes.length).toBe(1)
      const allConstants = resolver.getNodesByKind("constant")
      expect(allConstants.length).toBeGreaterThan(0)

      const ref: IUnresolvedReference = {
        fromNodeId: "pom.xml",
        referenceName: "app:database:url",
        referenceKind: "function_ref",
        line: 1,
        column: 1,
        language: "java",
        filePath: "src/main/java/App.java",
      }

      // Test resolver directly
      const springResolver = getAllFrameworkResolvers().find(r => r.name === "Spring Boot")!
      const directResult = springResolver.resolve(ref, resolver)
      expect(directResult).not.toBeNull()
      expect(directResult!.targetNodeId).toBe("config-key")
      expect(directResult!.provenance).toContain("spring-config")
    })
  })

  // ===================================================================
  // Тесты NestJS postExtract
  // ===================================================================

  describe("NestJS postExtract", () => {
    it("postExtract processes RouterModule.register() prefixes", () => {
      const moduleContent = "RouterModule.register([{ path: 'admin', children: [UsersController] }])"

      // The postExtract extracts "Users" from "UsersController" and looks for a class named "Users"
      insertNode("type-users", "class", "Users", "users.entity.ts", "typescript")
      insertNode("route-users", "route", "users", "app.module.ts", "typescript", 1, 1, "app.module.ts#users")

      // Verify query builder returns expected data
      const typeNodes = qb.getNodesByName("Users").filter(n => n.kind === "class")
      expect(typeNodes.length).toBe(1)
      const routes = qb.getNodesByKind("route")
      expect(routes.length).toBe(1)

      const mockContext: IResolutionContext = {
        getAllFiles: () => ["app.module.ts"],
        getFileContent: (path: string) => path === "app.module.ts" ? moduleContent : null,
        getNodesByName: (name: string) => qb.getNodesByName(name),
        getNodesByKind: (kind: NodeKind) => qb.getNodesByKind(kind),
        getNodesByFile: (filePath: string) => qb.getNodesByFile(filePath),
        getNodeById: (id: string) => qb.getNodeById(id),
        getNodesByQualifiedName: (qn: string) => qb.getNodesByQualifiedNameExact(qn),
        getNodesByLowerName: (ln: string) => qb.getNodesByLowerName(ln),
        getSupertypes: () => [],
        getChildren: () => [],
        getAncestors: () => [],
        getIncomingEdges: () => [],
        getOutgoingEdges: () => [],
        getFilePathFromNodeId: () => null,
        getLanguageFromNodeId: () => null,
        getImportMappings: () => [],
        getReExports: () => [],
        getDetectedFrameworks: () => [],
        iterateNodesByKind: () => (function* () {})(),
        getFileLines: () => null,
        getMethodMatches: () => [],
        getSupertypesByName: () => [],
        listDirectories: () => [],
        getCppIncludeDirs: () => [],
        getProjectAliases: () => null,
        getGoModule: () => null,
        getWorkspacePackages: () => null,
      }

      const nestjsResolver = getAllFrameworkResolvers().find(r => r.name === "NestJS")!

      const postExtractNodes = nestjsResolver.postExtract?.(mockContext) || []
      expect(postExtractNodes.length).toBeGreaterThan(0)
      const prefixedRoute = postExtractNodes.find(n => n.name.startsWith("admin"))
      expect(prefixedRoute).toBeDefined()
    })
  })
})
