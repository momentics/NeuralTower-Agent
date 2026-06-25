declare module 'tree-sitter' {
  export class Parser {
    setLanguage(grammar: any): void;
    parse(input: string, existing?: any): any;
  }
}

declare module 'tree-sitter-typescript' {
  export const TypeScript: any;
  export const TSX: any;
}

declare module 'tree-sitter-python' {
  export const Language: any;
}

declare module 'tree-sitter-go' {
  export const Language: any;
}

declare module 'tree-sitter-rust' {
  export const Language: any;
}

declare module 'tree-sitter-java' {
  export const Language: any;
}

declare module 'tree-sitter-cpp' {
  export const Language: any;
}

declare module 'tree-sitter-c' {
  export const Language: any;
}

declare module 'tree-sitter-c-sharp' {
  export const Language: any;
}
