/**
 * Спецификации языков для универсального AST-экстрактора.
 *
 * Карта «тип узла tree-sitter → kind узла графа» сверена с реальным
 * выводом грамматик tree-sitter-wasms (отладочный дамп дерева,
 * см. шаг 15.9). Если конкретная грамматика именовала узлы иначе —
 * поправить карту по выводу отладочного скрипта.
 */

import { NodeKind } from '../../ntgraph/Types';
import type { IGenericLanguageSpec } from './GenericAst';

export const GENERIC_SPECS: Record<string, IGenericLanguageSpec> = {
  dart: {
    language: 'dart',
    grammar: 'dart',
    extensions: ['.dart'],
    nodeTypes: {
      class_definition: NodeKind.Class,
      method_signature: NodeKind.Method,
      function_signature: NodeKind.Function,
      enum_declaration: NodeKind.Enum,
      mixin_declaration: NodeKind.Class,
      extension_declaration: NodeKind.Class,
    },
  },
  scala: {
    language: 'scala',
    grammar: 'scala',
    extensions: ['.scala', '.sc'],
    // def внутри class/object/trait — метод, на верхнем уровне — функция
    methodInsideTypes: true,
    nodeTypes: {
      class_definition: NodeKind.Class,
      object_definition: NodeKind.Class,
      trait_definition: NodeKind.Interface,
      function_definition: NodeKind.Function,
      function_declaration: NodeKind.Function,
    },
  },
  solidity: {
    language: 'solidity',
    grammar: 'solidity',
    extensions: ['.sol'],
    nodeTypes: {
      contract_declaration: NodeKind.Class,
      function_definition: NodeKind.Function,
      struct_declaration: NodeKind.Struct,
      event_definition: NodeKind.TypeAlias,
      modifier_definition: NodeKind.Method,
      enum_declaration: NodeKind.Enum,
      error_declaration: NodeKind.TypeAlias,
    },
  },
  lua: {
    language: 'lua',
    grammar: 'lua',
    extensions: ['.lua', '.luau'],
    nodeTypes: {
      local_function_definition_statement: NodeKind.Function,
      function_definition_statement: NodeKind.Function,
    },
  },
  objc: {
    language: 'objc',
    grammar: 'objc',
    extensions: ['.m'],
    nodeTypes: {
      class_interface: NodeKind.Class,
      class_implementation: NodeKind.Class,
      protocol_declaration: NodeKind.Interface,
      method_declaration: NodeKind.Method,
      method_definition: NodeKind.Method,
    },
  },
  elixir: {
    language: 'elixir',
    grammar: 'elixir',
    extensions: ['.ex', '.exs'],
    // Объявления (defmodule, def, ...) в этой грамматике парсятся как вызовы
    callKeywords: {
      defmodule: NodeKind.Class,
      def: NodeKind.Function,
      defp: NodeKind.Function,
      defmacro: NodeKind.Function,
      defmacrop: NodeKind.Function,
      defprotocol: NodeKind.Interface,
      defimpl: NodeKind.Class,
    },
  },
  ocaml: {
    language: 'ocaml',
    grammar: 'ocaml',
    extensions: ['.ml'],
    nodeTypes: {
      let_binding: NodeKind.Function,
      type_binding: NodeKind.TypeAlias,
      module_binding: NodeKind.Class,
      constructor_declaration: NodeKind.TypeAlias,
    },
  },
  rescript: {
    language: 'rescript',
    grammar: 'rescript',
    extensions: ['.res'],
    nodeTypes: {
      let_binding: NodeKind.Variable,
      type_binding: NodeKind.TypeAlias,
    },
  },
  zig: {
    language: 'zig',
    grammar: 'zig',
    extensions: ['.zig'],
    // Имена struct/enum/union в этой версии грамматики теряются в ERROR-узлах
    // и не восстанавливаются — настраиваем только надёжные объявления.
    nodeTypes: {
      function_declaration: NodeKind.Function,
    },
    tokenKinds: {
      'variable_declaration:const': NodeKind.Constant,
      'variable_declaration:var': NodeKind.Variable,
    },
  },
  // .sh/.bash/.zsh детектируются как язык 'shell'; грамматика — bash
  shell: {
    language: 'shell',
    grammar: 'bash',
    extensions: ['.sh', '.bash', '.zsh'],
    nodeTypes: {
      function_definition: NodeKind.Function,
    },
  },
  css: {
    language: 'css',
    grammar: 'css',
    extensions: ['.css'],
    nodeTypes: {
      // Селекторы CSS-правила — «класс» стилей
      rule_set: NodeKind.Class,
    },
  },
  json: {
    language: 'json',
    grammar: 'json',
    extensions: ['.json'],
    nodeTypes: {
      pair: NodeKind.Variable,
    },
  },
  toml: {
    language: 'toml',
    grammar: 'toml',
    extensions: ['.toml'],
    nodeTypes: {
      table: NodeKind.Class,
      table_array_element: NodeKind.Class,
    },
  },
};
