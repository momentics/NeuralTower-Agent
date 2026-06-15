const vscode = {
  // EventEmitter
  EventEmitter: class {
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
  },

  // Disposable
  Disposable: {
    from(...disposables: any[]) {
      return { dispose: () => { for (const d of disposables) d?.dispose?.() } }
    },
  },

  // Uri
  Uri: {
    file(path: string) { return { fsPath: path, scheme: "file", path } },
    joinPath(base: any, ...paths: string[]) { return { fsPath: paths.join("/"), scheme: "file", path: paths.join("/") } },
  },

  // Position
  Position: class {
    constructor(public line: number, public character: number) {}
  },

  // Range
  Range: class {
    constructor(public start: any, public end: any) {}
  },

  // Selection
  Selection: class {
    constructor(public anchorLine: number, public anchorCharacter: number, public activeLine: number, public activeCharacter: number) {}
    get isEmpty() { return this.anchorLine === this.activeLine && this.anchorCharacter === this.activeCharacter }
    get start() { return new vscode.Position(this.anchorLine, this.anchorCharacter) }
    get end() { return new vscode.Position(this.activeLine, this.activeCharacter) }
  },

  // SymbolKind
  SymbolKind: {
    File: 0, Module: 1, Namespace: 2, Package: 3, Class: 5, Method: 6, Property: 7,
    Field: 8, Constructor: 9, Enum: 10, Interface: 11, Function: 12, Variable: 13,
    Constant: 14, String: 15, Number: 16, Boolean: 17, Array: 18, Object: 19,
    Key: 20, Null: 21, EnumMember: 22, Struct: 23, Event: 24, Operator: 25, TypeParameter: 26,
  },

  // CodeActionKind
  CodeActionKind: {
    QuickFix: "quickfix",
    RefactorRewrite: "refactor.rewrite",
  },

  // CodeAction
  CodeAction: class {
    constructor(public title: string, public kind?: any) {}
  },

  // StatusBarItem
  StatusBarItem: class {
    text = ""
    color: any = null
    tooltip = ""
    command: string | undefined
    show() {}
    dispose() {}
  },

  // StatusBarAlignment
  StatusBarAlignment: { Right: 2 },

  // ThemeColor
  ThemeColor: class {
    constructor(public id: string) {}
  },

  // window
  window: {
    activeTextEditor: null,
    createStatusBarItem: () => new vscode.StatusBarItem(),
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
    showInformationMessage: () => Promise.resolve(undefined),
    showWarningMessage: () => Promise.resolve(undefined),
    showErrorMessage: () => Promise.resolve(undefined),
  },

  // workspace
  workspace: {
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
  },

  // commands
  commands: {
    registerCommand: () => ({ dispose: () => {} }),
    executeCommand: async () => undefined,
  },

  // languages
  languages: {
    getDiagnostics: () => [],
  },

  // MarkdownString
  MarkdownString: class {
    constructor(public value: string) {}
  },

  // MarkedString
  MarkedString: class {
    constructor(public value: string) {}
  },

  // Hover
  Hover: class {
    constructor(public contents: any[]) {}
  },

  // Location
  Location: class {
    constructor(public uri: any, public range: any) {}
  },

  // SymbolInformation
  SymbolInformation: class {
    constructor(public name: string, public kind: number, public containerName: string, public location: any) {}
  },

  // DocumentSymbol
  DocumentSymbol: class {
    constructor(public name: string, public kind: number, public range: any, public children: any[] = [], public detail?: string) {}
  },

  // SignatureHelp
  SignatureHelp: class {
    constructor(public signatures: any[] = [], public activeSignature: number = 0) {}
  },

  // Diagnostic
  Diagnostic: class {
    constructor(public range: any, public message: string, public severity: number = 0) {}
  },

  // DiagnosticSeverity
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
}

export default vscode
