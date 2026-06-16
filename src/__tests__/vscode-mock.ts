const EventEmitter = class {
  private listeners: Function[] = []
  event(handler: Function) {
    this.listeners.push(handler)
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== handler) } }
  }
  fire(...args: unknown[]) {
    for (const l of this.listeners) l(...args)
  }
  dispose() {
    this.listeners = []
  }
}

const Disposable = {
  from(...disposables: any[]) {
    return { dispose: () => { for (const d of disposables) d?.dispose?.() } }
  },
}

const Uri = {
  file(path: string) { return { fsPath: path, scheme: "file", path } },
  joinPath(base: any, ...paths: string[]) { return { fsPath: paths.join("/"), scheme: "file", path: paths.join("/") } },
}

const Position = class {
  constructor(public line: number, public character: number) {}
}

const Range = class {
  constructor(public start: any, public end: any) {}
}

const Selection = class {
  constructor(public anchorLine: number, public anchorCharacter: number, public activeLine: number, public activeCharacter: number) {}
  get isEmpty() { return this.anchorLine === this.activeLine && this.anchorCharacter === this.activeCharacter }
  get start() { return new Position(this.anchorLine, this.anchorCharacter) }
  get end() { return new Position(this.activeLine, this.activeCharacter) }
}

const SymbolKind = {
  File: 0, Module: 1, Namespace: 2, Package: 3, Class: 5, Method: 6, Property: 7,
  Field: 8, Constructor: 9, Enum: 10, Interface: 11, Function: 12, Variable: 13,
  Constant: 14, String: 15, Number: 16, Boolean: 17, Array: 18, Object: 19,
  Key: 20, Null: 21, EnumMember: 22, Struct: 23, Event: 24, Operator: 25, TypeParameter: 26,
}

const CodeActionKind = {
  QuickFix: "quickfix",
  RefactorRewrite: "refactor.rewrite",
}

const CodeAction = class {
  constructor(public title: string, public kind?: any) {}
}

const StatusBarItem = class {
  text = ""
  color: any = null
  tooltip = ""
  command: string | undefined
  show() {}
  dispose() {}
}

const StatusBarAlignment = { Right: 2 }

const ThemeColor = class {
  constructor(public id: string) {}
}

const window = {
  activeTextEditor: null,
  createStatusBarItem: () => new StatusBarItem(),
  createOutputChannel: () => ({
    show: () => {},
    appendLine: () => {},
    append: () => {},
    dispose: () => {},
  }),
  createWebviewPanel: () => ({
    webview: {
      html: "",
      options: {},
      cspSource: "unsafe-inline",
      asWebviewUri: (uri: any) => uri.fsPath,
      postMessage: () => Promise.resolve(true),
      onDidReceiveMessage: () => ({ dispose: () => {} }),
    },
    reveal: () => {},
    dispose: () => {},
    onDidDispose: () => ({ dispose: () => {} }),
  }),
  registerWebviewViewProvider: () => ({ dispose: () => {} }),
  registerWebviewPanelSerializer: () => ({ dispose: () => {} }),
  showInformationMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  showInputBox: () => Promise.resolve(undefined),
}

const workspace = {
  workspaceFolders: [],
  getConfiguration: (section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T => defaultValue as T,
    update: () => Promise.resolve(),
  }),
  openTextDocument: async (uri: any) => ({
    uri,
    getText: () => "",
    lineAt: () => ({ text: "", lineNumber: 0 }),
  }),
  getDiagnostics: () => [],
  onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
}

const commands = {
  _calls: [] as { id: string; handler: Function }[],
  registerCommand: (id: string, handler: Function) => {
    commands._calls.push({ id, handler })
    return { dispose: () => {} }
  },
  executeCommand: async () => undefined,
}

const languages = {
  getDiagnostics: () => [],
  registerCodeActionsProvider: () => ({ dispose: () => {} }),
}

const debug = {
  activeDebugSession: null,
}

const env = {
  clipboard: {
    readText: async () => "",
    writeText: async () => {},
  },
}

const MarkdownString = class {
  constructor(public value: string) {}
}

const MarkedString = class {
  constructor(public value: string) {}
}

const Hover = class {
  constructor(public contents: any[]) {}
}

const Location = class {
  constructor(public uri: any, public range: any) {}
}

const SymbolInformation = class {
  constructor(public name: string, public kind: number, public containerName: string, public location: any) {}
}

const DocumentSymbol = class {
  constructor(public name: string, public kind: number, public range: any, public children: any[] = [], public detail?: string) {}
}

const SignatureHelp = class {
  constructor(public signatures: any[] = [], public activeSignature: number = 0) {}
}

const Diagnostic = class {
  constructor(public range: any, public message: string, public severity: number = 0) {}
}

const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 }

const ViewColumn = { Beside: -1, Active: -1, One: 1, Two: 2, Three: 3 }

export {
  EventEmitter,
  Disposable,
  Uri,
  Position,
  Range,
  Selection,
  SymbolKind,
  CodeActionKind,
  CodeAction,
  StatusBarItem,
  StatusBarAlignment,
  ThemeColor,
  window,
  workspace,
  commands,
  languages,
  debug,
  env,
  MarkdownString,
  MarkedString,
  Hover,
  Location,
  SymbolInformation,
  DocumentSymbol,
  SignatureHelp,
  Diagnostic,
  DiagnosticSeverity,
  ViewColumn,
}

export default {
  EventEmitter,
  Disposable,
  Uri,
  Position,
  Range,
  Selection,
  SymbolKind,
  CodeActionKind,
  CodeAction,
  StatusBarItem,
  StatusBarAlignment,
  ThemeColor,
  window,
  workspace,
  commands,
  languages,
  debug,
  env,
  MarkdownString,
  MarkedString,
  Hover,
  Location,
  SymbolInformation,
  DocumentSymbol,
  SignatureHelp,
  Diagnostic,
  DiagnosticSeverity,
  ViewColumn,
}
