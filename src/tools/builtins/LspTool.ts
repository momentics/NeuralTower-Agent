import * as vscode from "vscode"
import type { ITool, ToolSchema } from "../ITool"
import type { ToolResult } from "../../agent/AgentTypes"
import * as path from "path"
import * as fs from "fs/promises"
import { pathToFileURL } from "url"
import { ExecutionError, TimeoutError, ValidationError } from "../../core/errors"

const LSP_TIMEOUT_MS = 10_000
const MAX_SYMBOL_RESULTS = 50
const MAX_REFERENCE_RESULTS = 30
const MAX_HOVER_CHARS = 4000
const MAX_DEFINITION_SNIPPET_LINES = 15

const operations = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "signatureHelp",
  "goToTypeDefinition",
] as const

type LspOperation = (typeof operations)[number]

export class LspTool implements ITool {
  name = "lsp"
  description = "LSP-операции для семантического анализа кода: переход к определению, поиск ссылок, символы документа/workspace, всплывающая подсказка, реализация, сигнатура, тип"
  category = "lsp"
  isSafe = true

  schema: ToolSchema = {
    name: "lsp",
    description: "LSP-операции для семантического анализа кода",
    parameters: {
      operation: {
        type: "string",
        description: `Операция: ${operations.join(", ")}`,
        enum: [...operations],
      },
      filePath: {
        type: "string",
        description: "Абсолютный или относительный путь к файлу",
      },
      line: {
        type: "number",
        description: "Номер строки (с 1, как в редакторе). Не требуется для documentSymbol и workspaceSymbol.",
      },
      character: {
        type: "number",
        description: "Позиция символа (с 1, как в редакторе). Не требуется для documentSymbol и workspaceSymbol.",
      },
      query: {
        type: "string",
        description: "Поисковый запрос для workspaceSymbol. Пустая строка запрашивает все символы.",
      },
    },
    required: ["operation"],
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const operation = args.operation as LspOperation | undefined
    const filePathRaw = args.filePath as string | undefined

    if (!operation) {
      return { output: "Не указана операция", success: false }
    }

    if (!operations.includes(operation)) {
      return { output: `Неподдерживаемая операция: ${operation}. Доступно: ${operations.join(", ")}`, success: false }
    }

    if (!filePathRaw && operation !== "workspaceSymbol") {
      return { output: "Не указан путь к файлу (требуется для всех операций кроме workspaceSymbol)", success: false }
    }

    const line = args.line ? Number(args.line) : undefined
    const character = args.character ? Number(args.character) : undefined
    const query = args.query ? String(args.query) : undefined

    try {
      switch (operation) {
        case "documentSymbol":
          return await this.executeDocumentSymbol(filePathRaw!)
        case "workspaceSymbol":
          return await this.executeWorkspaceSymbol(query ?? "")
        case "goToDefinition":
          return await this.executeGoToDefinition(filePathRaw!, line, character)
        case "findReferences":
          return await this.executeFindReferences(filePathRaw!, line, character)
        case "hover":
          return await this.executeHover(filePathRaw!, line, character)
        case "goToImplementation":
          return await this.executeGoToImplementation(filePathRaw!, line, character)
        case "signatureHelp":
          return await this.executeSignatureHelp(filePathRaw!, line, character)
        case "goToTypeDefinition":
          return await this.executeGoToTypeDefinition(filePathRaw!, line, character)
      }
    } catch (err) {
      return {
        output: `LSP-ошибка: ${err instanceof Error ? err.message : String(err)}`,
        success: false,
      }
    }
  }

  private async withTimeout<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(`LSP ${label}: таймаут ${LSP_TIMEOUT_MS}ms`)), LSP_TIMEOUT_MS)
    })
    try {
      return await Promise.race([fn(), timeoutPromise])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async resolveUri(filePathRaw: string): Promise<vscode.Uri> {
    let filePath = filePathRaw
    if (!path.isAbsolute(filePathRaw)) {
      const workspaces = vscode.workspace.workspaceFolders
      if (workspaces && workspaces.length > 0) {
        filePath = path.join(workspaces[0].uri.fsPath, filePathRaw)
      }
    }
    return vscode.Uri.file(filePath)
  }

  private async ensureFileExists(filePath: string): Promise<void> {
    try {
      await fs.access(filePath)
    } catch {
      throw new ValidationError(`Файл не найден: ${filePath}`)
    }
  }

  private async openDocumentForLsp(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.openTextDocument(uri)
    } catch {
      // Документ может быть бинарным или недоступным — LSP обработает ошибку
    }
  }

  private async executeDocumentSymbol(filePathRaw: string): Promise<ToolResult> {
    const uri = await this.resolveUri(filePathRaw)
    await this.ensureFileExists(uri.fsPath)
    await this.openDocumentForLsp(uri)

    const symbols = await this.withTimeout(
      () => Promise.resolve(vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        uri,
      )).then((r) => r ?? []),
      "documentSymbol",
    )

    if (symbols.length === 0) {
      return { output: `Символы не найдены для ${uri.fsPath}`, success: true }
    }

    const lines = this.formatDocumentSymbols(symbols, 0, [])
    const output = lines.slice(0, MAX_SYMBOL_RESULTS)
    return {
      output: `Символы файла ${uri.fsPath}:\n\n${output.join("\n")}`,
      success: true,
    }
  }

  private formatDocumentSymbols(symbols: vscode.DocumentSymbol[], depth: number, results: string[]): string[] {
    const indent = "  ".repeat(depth)

    for (const sym of symbols) {
      if (results.length >= MAX_SYMBOL_RESULTS) break
      const kindLabel = this.symbolKindLabel(sym.kind)
      const range = `${sym.range.start.line + 1}-${sym.range.end.line + 1}`
      const detail = sym.detail ? ` (${sym.detail})` : ""
      results.push(`${indent}${kindLabel} ${sym.name}${detail} [${range}]`)

      if (sym.children && sym.children.length > 0 && depth < 4 && results.length < MAX_SYMBOL_RESULTS) {
        this.formatDocumentSymbols(sym.children, depth + 1, results)
      }
    }

    return results
  }

  private symbolKindLabel(kind: vscode.SymbolKind): string {
    const map: Record<number, string> = {
      [vscode.SymbolKind.File]: "file",
      [vscode.SymbolKind.Module]: "module",
      [vscode.SymbolKind.Namespace]: "namespace",
      [vscode.SymbolKind.Package]: "package",
      [vscode.SymbolKind.Class]: "class",
      [vscode.SymbolKind.Method]: "method",
      [vscode.SymbolKind.Property]: "property",
      [vscode.SymbolKind.Field]: "field",
      [vscode.SymbolKind.Constructor]: "constructor",
      [vscode.SymbolKind.Enum]: "enum",
      [vscode.SymbolKind.Interface]: "interface",
      [vscode.SymbolKind.Function]: "function",
      [vscode.SymbolKind.Variable]: "variable",
      [vscode.SymbolKind.Constant]: "constant",
      [vscode.SymbolKind.String]: "string",
      [vscode.SymbolKind.Number]: "number",
      [vscode.SymbolKind.Boolean]: "boolean",
      [vscode.SymbolKind.Array]: "array",
      [vscode.SymbolKind.Object]: "object",
      [vscode.SymbolKind.Key]: "key",
      [vscode.SymbolKind.Null]: "null",
      [vscode.SymbolKind.EnumMember]: "enum_member",
      [vscode.SymbolKind.Struct]: "struct",
      [vscode.SymbolKind.Event]: "event",
      [vscode.SymbolKind.Operator]: "operator",
      [vscode.SymbolKind.TypeParameter]: "type_param",
    }
    return map[kind] ?? `kind:${kind}`
  }

  private async executeWorkspaceSymbol(query: string): Promise<ToolResult> {
    const results = await this.withTimeout(
      () => Promise.resolve(vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        "vscode.executeWorkspaceSymbolProvider",
        query,
      )).then((r) => r ?? []),
      "workspaceSymbol",
    )

    if (results.length === 0) {
      return { output: `Символы workspace для "${query}" не найдены`, success: true }
    }

    const relevantKinds = new Set([
      vscode.SymbolKind.Class,
      vscode.SymbolKind.Function,
      vscode.SymbolKind.Method,
      vscode.SymbolKind.Interface,
      vscode.SymbolKind.Variable,
      vscode.SymbolKind.Constant,
      vscode.SymbolKind.Struct,
      vscode.SymbolKind.Enum,
    ])
    const filtered = results
      .filter((s) => relevantKinds.has(s.kind))
      .slice(0, MAX_SYMBOL_RESULTS)

    if (filtered.length === 0) {
      return { output: `Символы workspace для "${query}" не найдены (из ${results.length} результатов нет релевантных видов)`, success: true }
    }

    const lines = filtered.map((s) => {
      const kind = this.symbolKindLabel(s.kind)
      const container = s.containerName ? ` <${s.containerName}>` : ""
      const loc = s.location
      return `${kind} ${s.name}${container} — ${loc.uri.fsPath}:${loc.range.start.line + 1}`
    })

    return {
      output: `Символы workspace для "${query}" (${filtered.length} из ${results.length}):\n\n${lines.join("\n")}`,
      success: true,
    }
  }

  private async executeGoToDefinition(
    filePathRaw: string,
    line?: number,
    character?: number,
  ): Promise<ToolResult> {
    const uri = await this.resolveUri(filePathRaw)
    await this.ensureFileExists(uri.fsPath)
    await this.openDocumentForLsp(uri)
    const position = this.toPosition(line, character)

    const definitions = await this.withTimeout(
      () => Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeDefinitionProvider",
        uri,
        position,
      )).then((r) => r ?? []),
      "goToDefinition",
    )

    if (definitions.length === 0) {
      return { output: `Определение не найдено в ${uri.fsPath}:${position.line + 1}:${position.character + 1}`, success: true }
    }

    const lines = await this.formatLocations(definitions, "Определение")
    return {
      output: lines.join("\n\n"),
      success: true,
    }
  }

  private async executeGoToTypeDefinition(
    filePathRaw: string,
    line?: number,
    character?: number,
  ): Promise<ToolResult> {
    const uri = await this.resolveUri(filePathRaw)
    await this.ensureFileExists(uri.fsPath)
    await this.openDocumentForLsp(uri)
    const position = this.toPosition(line, character)

    const typeDefs = await this.withTimeout(
      () => Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeTypeDefinitionProvider",
        uri,
        position,
      )).then((r) => r ?? []),
      "goToTypeDefinition",
    )

    if (typeDefs.length === 0) {
      return { output: `Определение типа не найдено в ${uri.fsPath}:${position.line + 1}:${position.character + 1}`, success: true }
    }

    const lines = await this.formatLocations(typeDefs, "Определение типа")
    return {
      output: lines.join("\n\n"),
      success: true,
    }
  }

  private async executeGoToImplementation(
    filePathRaw: string,
    line?: number,
    character?: number,
  ): Promise<ToolResult> {
    const uri = await this.resolveUri(filePathRaw)
    await this.ensureFileExists(uri.fsPath)
    await this.openDocumentForLsp(uri)
    const position = this.toPosition(line, character)

    const implementations = await this.withTimeout(
      () => Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeImplementationProvider",
        uri,
        position,
      )).then((r) => r ?? []),
      "goToImplementation",
    )

    if (implementations.length === 0) {
      return { output: `Реализация не найдена в ${uri.fsPath}:${position.line + 1}:${position.character + 1}`, success: true }
    }

    const lines = await this.formatLocations(implementations, "Реализация")
    return {
      output: lines.join("\n\n"),
      success: true,
    }
  }

  private async executeFindReferences(
    filePathRaw: string,
    line?: number,
    character?: number,
  ): Promise<ToolResult> {
    const uri = await this.resolveUri(filePathRaw)
    await this.ensureFileExists(uri.fsPath)
    await this.openDocumentForLsp(uri)
    const position = this.toPosition(line, character)

    const references = await this.withTimeout(
      () => Promise.resolve(vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeReferenceProvider",
        uri,
        position,
        { includeDeclaration: true },
      )).then((r) => r ?? []),
      "findReferences",
    )

    if (references.length === 0) {
      return { output: `Ссылки не найдены в ${uri.fsPath}:${position.line + 1}:${position.character + 1}`, success: true }
    }

    const grouped = this.groupLocationsByFile(references.slice(0, MAX_REFERENCE_RESULTS))
    const lines: string[] = [`Ссылки (${references.length} всего):`]

    for (const [file, locs] of Object.entries(grouped)) {
      const relPath = this.relativePath(file)
      lines.push(`\n${relPath}:`)
      for (const loc of locs) {
        const snippet = await this.getLineSnippet(loc)
        lines.push(`  строка ${loc.range.start.line + 1}: ${snippet}`)
      }
    }

    return { output: lines.join("\n"), success: true }
  }

  private async executeHover(
    filePathRaw: string,
    line?: number,
    character?: number,
  ): Promise<ToolResult> {
    const uri = await this.resolveUri(filePathRaw)
    await this.ensureFileExists(uri.fsPath)
    await this.openDocumentForLsp(uri)
    const position = this.toPosition(line, character)

    const hovers = await this.withTimeout(
      () => Promise.resolve(vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        uri,
        position,
      )).then((r) => r ?? []),
      "hover",
    )

    if (hovers.length === 0) {
      return { output: `Hover-информация не найдена в ${uri.fsPath}:${position.line + 1}:${position.character + 1}`, success: true }
    }

    const lines: string[] = []
    for (const hover of hovers) {
      for (const content of hover.contents) {
        const text = this.markdownToString(content)
        if (text) {
          lines.push(text.slice(0, MAX_HOVER_CHARS))
        }
      }
    }

    if (lines.length === 0) {
      return { output: `Hover-информация пуста в ${uri.fsPath}:${position.line + 1}:${position.character + 1}`, success: true }
    }

    return { output: lines.join("\n\n"), success: true }
  }

  private async executeSignatureHelp(
    filePathRaw: string,
    line?: number,
    character?: number,
  ): Promise<ToolResult> {
    const uri = await this.resolveUri(filePathRaw)
    await this.ensureFileExists(uri.fsPath)
    await this.openDocumentForLsp(uri)
    const position = this.toPosition(line, character)

    const help = await this.withTimeout(
      () => Promise.resolve(vscode.commands.executeCommand<vscode.SignatureHelp | undefined>(
        "vscode.executeSignatureHelpProvider",
        uri,
        position,
        "\n",
      )).then((r) => r),
      "signatureHelp",
    )

    if (!help || help.signatures.length === 0) {
      return { output: `Сигнатура не найдена в ${uri.fsPath}:${position.line + 1}:${position.character + 1}`, success: true }
    }

    const lines: string[] = []
    for (let i = 0; i < help.signatures.length; i++) {
      const sig = help.signatures[i]
      const label = typeof sig.label === "string" ? sig.label : String(sig.label)
      const active = help.activeSignature === i ? " [активна]" : ""
      lines.push(`${label}${active}`)

      if (sig.documentation) {
        lines.push(this.markdownToString(sig.documentation))
      }

      if (sig.parameters) {
        for (const param of sig.parameters) {
          const paramLabel = typeof param.label === "string" ? param.label : Array.isArray(param.label) ? `${param.label[0]}-${param.label[1]}` : String(param.label)
          const paramDoc = param.documentation ? this.markdownToString(param.documentation) : ""
          lines.push(`  ${paramLabel}${paramDoc ? ` — ${paramDoc}` : ""}`)
        }
      }
    }

    return { output: lines.join("\n"), success: true }
  }

  private async formatLocations(locations: vscode.Location[], title: string): Promise<string[]> {
    const lines: string[] = []

    for (const loc of locations) {
      const relPath = this.relativePath(loc.uri.fsPath)
      const snippet = await this.getLineSnippet(loc)
      lines.push(`${title}: ${relPath}:${loc.range.start.line + 1}`)

      if (snippet) {
        lines.push(`  ${snippet}`)
      }
    }

    return lines
  }

  private async getLineSnippet(location: vscode.Location): Promise<string> {
    try {
      const doc = await vscode.workspace.openTextDocument(location.uri)
      const line = doc.lineAt(location.range.start.line)
      return line.text.trim().slice(0, 200)
    } catch {
      return ""
    }
  }

  private groupLocationsByFile(locations: vscode.Location[]): Record<string, vscode.Location[]> {
    const grouped: Record<string, vscode.Location[]> = {}
    for (const loc of locations) {
      const file = loc.uri.fsPath
      if (!grouped[file]) grouped[file] = []
      grouped[file].push(loc)
    }
    return grouped
  }

  private toPosition(line?: number, character?: number): vscode.Position {
    const l = line ? Math.max(0, line - 1) : 0
    const c = character ? Math.max(0, character - 1) : 0
    return new vscode.Position(l, c)
  }

  private relativePath(absPath: string): string {
    const workspaces = vscode.workspace.workspaceFolders
    if (workspaces && workspaces.length > 0) {
      return path.relative(workspaces[0].uri.fsPath, absPath)
    }
    return absPath
  }

  private markdownToString(content: vscode.MarkdownString | vscode.MarkedString | vscode.MarkedString[]): string {
    if (Array.isArray(content)) {
      return content.map((c) => this.markdownToString(c)).filter(Boolean).join("\n\n")
    }

    if (content instanceof vscode.MarkdownString) {
      return content.value
    }

    if (typeof content === "string") {
      return content
    }

    if ("value" in content && typeof content.value === "string") {
      return content.value
    }

    if ("language" in content && "value" in content) {
      return content.value
    }

    return String(content)
  }
}
