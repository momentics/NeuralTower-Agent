/**
 * Регистрация обратных вызовов — захват функций, передаваемых как аргументы (#756).
 *
 * Когда имя функции передаётся в качестве аргумента (`register_handler(target_cb)`),
 * присваивается полю или указателю (`o->cb = target_cb`), попадает в инициализатор
 * (`{ .recv_cb = my_cb }`, `{ recv: targetCb }`) или перечисляется в таблице
 * (`static cb_t table[] = { cb_a, cb_b }`), это зависимость, которую статический
 * анализ вызовов полностью пропускает: `callers(target_cb)` показывает только прямые
 * вызовы, поэтому каждый обратный вызов выглядит мёртвым кодом, а места его
 * регистрации невидимы для анализа влияния.
 *
 * Модуль собирает такие позиции во время обхода AST как кандидаты `function_ref`.
 * Правила захвата различаются по языкам (формы `&fn` в C, `Main::fn` в Java,
 * `::fn` в Kotlin, `#selector(fn)` в Swift, `@TargetCb` в Pascal,
 * `method(:fn)` в Ruby). Кандидаты фильтруются в конце извлечения файла
 * (см. `TreeSitterExtractor.flushFnRefCandidates`): остаются только имена,
 * совпадающие с функцией/методом того же файла или импортированной привязкой.
 * Разрешение сопоставляет выживших только с узлами функций/методов
 * (`matchFunctionRef` в `src/resolution/name-matcher.ts`) и сохраняет рёбра
 * `references`, которые уже видны `callers`/`impact`.
 *
 * Намеренно не покрывается: косвенные вызовы через диспетчер (`o->cb(x)` →
 * зарегистрированная функция), так как это требует анализа потока данных через
 * поля структур, а неправильное ребро хуже отсутствия. Также не покрываются
 * `obj.method`, где `obj` не `this`/`self` (тип получателя статически неизвестен).
 */

/** Текст узла синтаксического дерева. */
function getNodeText(node: any): string {
  return node.text;
}

/** Поиск дочернего узла по имени поля. */
function getChildByField(node: any, fieldName: string): any {
  return node.childForFieldName(fieldName);
}

/** Кандидат функции-ссылки — имя, позиция и режим захвата. */
export interface FnRefCandidate {
  name: string;
  line: number;
  column: number;
  /** Какой режим захвата породил этого кандидата (политика фильтрации ключируется на нём). */
  mode: CaptureMode;
  /**
   * Истина, когда значение было явной ссылкой (`&fn`, `&Cls::m`,
   * `::fn`, `#selector`, `method(:sym)`), а не голым идентификатором —
   * политика фильтрации C++ ключируется на нём.
   */
  explicitRef: boolean;
  /**
   * Пропустить фильтр имен текущего файла/импорта для этого кандидата.
   * Устанавливается для строковых вызываемых PHP в известных позициях HOF:
   * глобальные функции PHP ссылаются кросс-файлово БЕЗ импортов (глобальное
   * пространство имён), поэтому фильтр не может их увидеть — сильный позиционный
   * приоритет (строковый аргумент для `usort`/`array_map`/…) плюс правило
   * разрешения «уникальный или отбросить» обеспечивают точность.
   */
  skipGate?: boolean;
}

/** Как извлекать узлы значений из контейнера. */
export type CaptureMode =
  | 'args' // каждый именованный дочерний — потенциальное значение (списки аргументов вызова)
  | 'rhs' // правая часть присваивания (именованное поле, иначе последний именованный дочерний)
  | 'value' // поле `value` ключевой пары (инициализаторы объектов/структур/таблиц)
  | 'list' // каждый именованный дочерний (позиционные элементы массивов/инициализаторов/таблиц)
  | 'varinit'; // инициализатор переменной

/** Правило захвата для одного типа контейнера. */
interface CaptureRule {
  mode: CaptureMode;
  /** Поле, содержащее значение для rhs/value/varinit (по умолчанию зависит от режима). */
  field?: string;
}

/** Спецификация захвата функции-ссылки для одного языка. */
export interface FnRefSpec {
  /** Типы узлов голых идентификаторов, которые могут выступать функцией-значением. */
  idTypes: Set<string>;
  /** Тип контейнера → как извлекать значения кандидатов из него. */
  dispatch: Map<string, CaptureRule>;
  /**
   * Прозрачные слои обёрток между контейнером и его значениями
   * (`argument`, `value_argument`, `literal_element`, `expression_list`…).
   * Значение: поле для спуска, или null для «именованные дочерние».
   * `expression_list` раскрывает ВСЕ именованные дочерние (множественное присваивание Go).
   */
  layers?: Map<string, string | null>;
  /**
   * Унарные обёртки, операнд которых — функция-значение — C/C++ `&fn`
   * (pointer_expression), Pascal `@Fn` (exprUnary), Scala eta `fn _`
   * (postfix_expression). Значение: поле операнда, или null для первого именованного дочернего.
   */
  unwrap?: Map<string, string | null>;
  /**
   * Целые узлы-ссылки, требующие индивидуального извлечения имён —
   * `method_reference` (Java), `callable_reference` / `navigation_expression`
   * (Kotlin), `selector_expression` (Swift `#selector` / ObjC `@selector`),
   * вызовы Ruby `method(:sym)` и формы членов `this.method`.
   */
  special?: Set<string>;
  /**
   * Режимы захвата, кандидаты которых пропускают фильтр имен текущего файла/импорта
   * и полагаются на правило разрешения «уникальный или отбросить». Только C-семейство:
   * значение инициализатора, правая часть присваивания указателя на функцию или элемент
   таблицы — это позиция указателя на функцию по построению, а в C нет импорта символов —
   доминирующий паттерн репозитория (`server.c` таблица команд именует обработчики из
   файлов t_*.c) иначе был бы невидим. Аргументы вызова остаются отфильтрованными
   везде (локальные, переданные как аргументы, превосходят колбэки).
   */
  ungatedModes?: Set<CaptureMode>;
  /**
   * Только C++: в позициях args/rhs/varinit принимать ТОЛЬКО явные ссылки
   * (`&fn`, `&Cls::method`) — никогда голые идентификаторы. Кодовые базы C++
   * плотны с общими именами свободных функций/аксессоров (`begin`, `end`, `out`,
   * `size`, `data`), которые сталкиваются с параметрами и локальными, а внеклассные
   * определения членов извлекаются как узлы функций — сопоставление голых идентификаторов
   * для fmt было в основном неправильными рёбрами. Таблицы инициализаторов глобальной
   области (value/list) по-прежнему принимают голые идентификаторы, как в C.
   */
  addressOfOnly?: boolean;
}

/** Имена, которые никогда не являются ссылками на функции, даже когда грамматики называют их идентификаторами. */
export const NAME_STOPLIST = new Set([
  'this',
  'self',
  'super',
  'null',
  'nil',
  'true',
  'false',
  'undefined',
  'new',
  'NULL',
  'nullptr',
  'None',
]);

// ---------------------------------------------------------------------------
// Спецификации по языкам. Типы узлов проверены против каждой грамматики
// (фикстуры зондирования в исследовании #756; см. docs/design/function-ref-capture.md).
// ---------------------------------------------------------------------------

/** C / C++ / Objective-C разделяют формы инициализаторов и присваиваний C-семейства. */
function cFamilySpec(extra?: { special?: string[]; addressOfOnly?: boolean }): FnRefSpec {
  return {
    idTypes: new Set(['identifier']),
    dispatch: new Map<string, CaptureRule>([
      ['argument_list', { mode: 'args' }],
      ['assignment_expression', { mode: 'rhs', field: 'right' }],
      ['init_declarator', { mode: 'varinit', field: 'value' }],
      ['initializer_list', { mode: 'list' }],
      ['initializer_pair', { mode: 'value', field: 'value' }],
    ]),
    unwrap: new Map([['pointer_expression', 'argument']]),
    special: new Set(extra?.special ?? []),
    // В C нет импорта символов, а колбэки регистрируются кросс-файлово в масштабе
    // репозитория (redis: server.c таблица команд именует обработчики из t_*.c) — поэтому
    // позиции инициализаторов обходят фильтр и полагаются на правило разрешения
    // «уникальный или отбросить». ТОЛЬКО 'value'/'list' (инициализаторы структур/массивов),
    // и фильтрация дополнительно требует глобальную область файла: инициализатор
    // глобальной области C — это контекст константного выражения, поэтому голый
    // идентификатор там может быть только адресом функции (или enum/макросом, который
    // фильтр функций отбрасывает) — никогда переменной. 'rhs'/'varinit' были
    // протестированы и производили неправильные рёбра (`prev = next`, `*str = field` —
    // присваивания данных, совпадающие с уникальной функцией того же имени в другом месте),
    // поэтому присваивания остаются отфильтрованными по текущему файлу/импорту.
    ungatedModes: new Set<CaptureMode>(['value', 'list']),
    addressOfOnly: extra?.addressOfOnly,
  };
}

// Захват `this.handleClick` (member_expression) испускает имя кандидата с
// ПРЕФИКСОМ `this.`: разрешение ограничивает его классом окружающего символа
// (префикс квалифицированного имени), поэтому `this.fonts` (свойство, после #808)
// и наследованные/неизвестные члены не дают ребра, а методы того же класса —
// `btn.on('click', this.handleClick)`, идиома регистрации наблюдателя —
// разрешаются точно. Голые идентификаторы остаются только для функций (голый
// идентификатор никогда не может быть значением метода в JS).
export const TS_JS_SPEC: FnRefSpec = {
  idTypes: new Set(['identifier']),
  dispatch: new Map<string, CaptureRule>([
    ['arguments', { mode: 'args' }],
    ['assignment_expression', { mode: 'rhs', field: 'right' }],
    ['variable_declarator', { mode: 'varinit', field: 'value' }],
    ['pair', { mode: 'value', field: 'value' }],
    ['array', { mode: 'list' }],
  ]),
  special: new Set(['member_expression']),
};

export const PYTHON_SPEC: FnRefSpec = {
  idTypes: new Set(['identifier']),
  dispatch: new Map<string, CaptureRule>([
    ['argument_list', { mode: 'args' }],
    ['assignment', { mode: 'rhs', field: 'right' }],
    ['keyword_argument', { mode: 'value', field: 'value' }], // Thread(target=worker)
    ['pair', { mode: 'value', field: 'value' }],
    ['list', { mode: 'list' }],
  ]),
  special: new Set(['attribute']),
};

export const GO_SPEC: FnRefSpec = {
  idTypes: new Set(['identifier']),
  dispatch: new Map<string, CaptureRule>([
    ['argument_list', { mode: 'args' }],
    ['assignment_statement', { mode: 'rhs', field: 'right' }],
    ['short_var_declaration', { mode: 'rhs', field: 'right' }],
    ['var_spec', { mode: 'varinit', field: 'value' }],
    ['keyed_element', { mode: 'value' }], // value = последний дочерний literal_element
    ['literal_value', { mode: 'list' }], // позиционные составные литералы
  ]),
  layers: new Map<string, string | null>([
    ['literal_element', null],
    ['expression_list', null],
  ]),
};

export const RUST_SPEC: FnRefSpec = {
  idTypes: new Set(['identifier']),
  dispatch: new Map<string, CaptureRule>([
    ['arguments', { mode: 'args' }],
    ['assignment_expression', { mode: 'rhs', field: 'right' }],
    ['field_initializer', { mode: 'value', field: 'value' }],
    ['array_expression', { mode: 'list' }],
    ['static_item', { mode: 'varinit', field: 'value' }],
    ['let_declaration', { mode: 'varinit', field: 'value' }],
  ]),
};

export const JAVA_SPEC: FnRefSpec = {
  // В Java нет значений функций-голых идентификаторов — только ссылки на методы.
  idTypes: new Set<string>(),
  dispatch: new Map<string, CaptureRule>([
    ['argument_list', { mode: 'args' }],
    ['assignment_expression', { mode: 'rhs', field: 'right' }],
    ['variable_declarator', { mode: 'varinit', field: 'value' }],
  ]),
  special: new Set(['method_reference']),
};

export const KOTLIN_SPEC: FnRefSpec = {
  idTypes: new Set<string>(),
  dispatch: new Map<string, CaptureRule>([
    ['value_arguments', { mode: 'args' }],
    ['assignment', { mode: 'rhs' }], // RHS = последний именованный дочерний (нет поля в грамматике)
  ]),
  layers: new Map<string, string | null>([['value_argument', null]]),
  special: new Set(['callable_reference', 'navigation_expression']),
};

export const CSHARP_SPEC: FnRefSpec = {
  idTypes: new Set(['identifier']),
  dispatch: new Map<string, CaptureRule>([
    ['argument_list', { mode: 'args' }],
    ['assignment_expression', { mode: 'rhs', field: 'right' }], // покрывает `+=` подписку на событие
    ['initializer_expression', { mode: 'list' }],
    ['variable_declarator', { mode: 'varinit' }],
  ]),
  layers: new Map<string, string | null>([['argument', null]]),
  special: new Set(['member_access_expression']),
};

export const RUBY_SPEC: FnRefSpec = {
  // Голые идентификаторы в аргументах Ruby — это ВЫЗОВЫ методов или локальные,
  // никогда не являются значениями функций — только идиома `method(:name)`
  // (и `&method(:name)`) плюс символы хук-DSL (`before_action :authenticate`)
  // квалифицируются.
  idTypes: new Set<string>(),
  dispatch: new Map<string, CaptureRule>([
    ['argument_list', { mode: 'args' }],
    ['pair', { mode: 'value', field: 'value' }],
  ]),
  layers: new Map<string, string | null>([['block_argument', null]]),
  special: new Set(['call', 'simple_symbol']),
};

/**
 * Хук-DSL в стиле Rails/ActiveSupport, чьи аргументы-символы именуют метод
 * окружающего класса: обратные вызовы жизненного цикла (`before_action`,
 * `after_save`, `around_create`, `skip_before_action`…), `validate :method`,
 * `set_callback`, `helper_method` и `rescue_from(..., with: :handler)`. НЕ
 * `validates` (множественное число) — его символы именуют АТРИБУТЫ, а не методы.
 */
const RUBY_HOOK_RE = /^(skip_)?(before|after|around)_[a-z_]+$/;
const RUBY_HOOK_NAMES = new Set(['validate', 'set_callback', 'helper_method', 'rescue_from']);
function isRubyHookCall(name: string): boolean {
  return RUBY_HOOK_RE.test(name) || RUBY_HOOK_NAMES.has(name);
}

export const SWIFT_SPEC: FnRefSpec = {
  idTypes: new Set(['simple_identifier']),
  dispatch: new Map<string, CaptureRule>([
    ['value_arguments', { mode: 'args' }],
    ['assignment', { mode: 'rhs', field: 'result' }],
    ['array_literal', { mode: 'list' }],
    ['property_declaration', { mode: 'varinit', field: 'value' }],
  ]),
  layers: new Map<string, string | null>([['value_argument', 'value']]),
  special: new Set(['selector_expression']),
};

export const SCALA_SPEC: FnRefSpec = {
  idTypes: new Set(['identifier']),
  dispatch: new Map<string, CaptureRule>([
    ['arguments', { mode: 'args' }],
    ['assignment_expression', { mode: 'rhs', field: 'right' }],
    ['val_definition', { mode: 'varinit', field: 'value' }],
  ]),
  unwrap: new Map<string, string | null>([['postfix_expression', null]]), // eta-расширение `fn _`
};

export const DART_SPEC: FnRefSpec = {
  idTypes: new Set(['identifier']),
  dispatch: new Map<string, CaptureRule>([
    ['arguments', { mode: 'args' }],
    ['assignment_expression', { mode: 'rhs', field: 'right' }],
    ['pair', { mode: 'value', field: 'value' }],
    ['list_literal', { mode: 'list' }],
    ['static_final_declaration', { mode: 'varinit' }],
  ]),
  layers: new Map<string, string | null>([['argument', null]]),
};

export const LUA_SPEC: FnRefSpec = {
  idTypes: new Set(['identifier']),
  dispatch: new Map<string, CaptureRule>([
    ['arguments', { mode: 'args' }],
    ['assignment_statement', { mode: 'rhs' }], // RHS expression_list дочерние несут поля `value`
    ['field', { mode: 'value', field: 'value' }], // поля таблиц, ключевые И позиционные
  ]),
  layers: new Map<string, string | null>([['expression_list', null]]),
};

export const PASCAL_SPEC: FnRefSpec = {
  idTypes: new Set(['identifier']),
  dispatch: new Map<string, CaptureRule>([
    ['exprArgs', { mode: 'args' }],
    ['assignment', { mode: 'rhs', field: 'rhs' }], // OnClick := Handler
  ]),
  unwrap: new Map<string, string | null>([['exprUnary', 'operand']]), // @Handler
};

/**
 * Основные функции PHP, чьи строковые аргументы являются ВЫЗЫВАЕМЫМИ — позиционный
 * приоритет, который делает голую строку надёжной ссылкой на функцию.
 * Намеренно только ядро PHP; реестры фреймворков (WordPress `add_action`)
 * принадлежат к резолверу фреймворков, если он когда-либо добавится.
 */
const PHP_CALLABLE_HOFS = new Set([
  'array_map', 'array_filter', 'array_walk', 'array_walk_recursive', 'array_reduce',
  'usort', 'uasort', 'uksort',
  'array_udiff', 'array_udiff_assoc', 'array_uintersect', 'array_uintersect_assoc',
  'call_user_func', 'call_user_func_array',
  'forward_static_call', 'forward_static_call_array',
  'preg_replace_callback', 'preg_replace_callback_array',
  'register_shutdown_function', 'register_tick_function',
  'set_error_handler', 'set_exception_handler', 'spl_autoload_register',
  'ob_start', 'iterator_apply', 'header_register_callback',
  'is_callable',
]);

export const PHP_SPEC: FnRefSpec = {
  // В PHP нет значений функций-голых идентификаторов (первоклассный вызываемый
  // `fn(...)` уже извлекается как ребро `calls`). Что квалифицируется:
  //  - строковый аргумент известной функции-принимающей вызываемые
  //    (`usort($a, 'cmp_items')`) — см. PHP_CALLABLE_HOFS
  //  - массивные вызываемые: `[$this, 'method']` (в области класса) и
  //    `[Foo::class, 'method']` (квалифицированные), в аргументах любого вызова
  idTypes: new Set<string>(),
  dispatch: new Map<string, CaptureRule>([['arguments', { mode: 'args' }]]),
  layers: new Map<string, string | null>([['argument', null]]),
  special: new Set(['encapsed_string', 'string', 'array_creation_expression']),
};

/**
 * Спецификации захвата по языкам.
 */
export const FN_REF_SPECS: Record<string, FnRefSpec | undefined> = {
  c: cFamilySpec(),
  cpp: cFamilySpec({ addressOfOnly: true }),
  objc: cFamilySpec({ special: ['selector_expression'] }),
  typescript: TS_JS_SPEC,
  tsx: TS_JS_SPEC,
  javascript: TS_JS_SPEC,
  jsx: TS_JS_SPEC,
  python: PYTHON_SPEC,
  go: GO_SPEC,
  rust: RUST_SPEC,
  java: JAVA_SPEC,
  kotlin: KOTLIN_SPEC,
  csharp: CSHARP_SPEC,
  php: PHP_SPEC,
  ruby: RUBY_SPEC,
  swift: SWIFT_SPEC,
  scala: SCALA_SPEC,
  dart: DART_SPEC,
  lua: LUA_SPEC,
  luau: LUA_SPEC,
  pascal: PASCAL_SPEC,
};

// ---------------------------------------------------------------------------
// Захват
// ---------------------------------------------------------------------------

/**
 * Извлекает имена кандидатов из контейнера. Возвращает пары
 * (имя, позиция) каждого найденного выражения, похожего на функцию-значение.
 */
export function captureFnRefCandidates(
  container: any,
  rule: CaptureRule,
  spec: FnRefSpec
): FnRefCandidate[] {
  const valueNodes: any[] = [];

  switch (rule.mode) {
    case 'args':
    case 'list': {
      for (let i = 0; i < container.namedChildCount; i++) {
        const child = container.namedChild(i);
        if (child) valueNodes.push(child);
      }
      break;
    }
    case 'rhs': {
      const rhs = rule.field
        ? getChildByField(container, rule.field)
        : container.namedChild(container.namedChildCount - 1);
      if (rhs) {
        // Пропуск хранения параметра: `this.status = status` / `o->cb = cb` — когда
        // имя присваиваемого члена РАВНО идентификатору RHS, RHS — это локальная/
        // параметр, который сохраняется, и функция, которую он держит (если есть),
        // статически неизвестна. Функция того же имени в другом месте разрешится в
        // НЕПРАВИЛЬНУЮ цель (находка excalidraw A/B), поэтому пропускаем.
        const lhs =
          getChildByField(container, 'left') ??
          getChildByField(container, 'lhs') ??
          getChildByField(container, 'target') ??
          (container.namedChildCount >= 2 ? container.namedChild(0) : null);
        const lhsText = lhs ? getNodeText(lhs) : '';
        const lhsLastName = lhsText.match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*$/)?.[1];
        const rhsText = getNodeText(rhs).trim();
        if (lhsLastName && lhsLastName === rhsText) break;
        valueNodes.push(rhs);
      }
      break;
    }
    case 'value': {
      let value = rule.field ? getChildByField(container, rule.field) : null;
      // Ключевые контейнеры без поля value (Go keyed_element): значение —
      // ПОСЛЕДНИЙ именованный дочерний (первый — ключ).
      if (!value && container.namedChildCount > 0) {
        value = container.namedChild(container.namedChildCount - 1);
      }
      if (value) valueNodes.push(value);
      break;
    }
    case 'varinit': {
      // Деструктуризация (`const { center } = ellipse`) извлекает ДАННЫЕ из RHS —
      // никогда не является псевдонимом функции. Без этого пропуска параметр,
      // затеняющий функцию того же имени из импорта, производил неправильное ребро.
      const nameNode =
        getChildByField(container, 'name') ?? getChildByField(container, 'pattern');
      if (nameNode && (nameNode.type === 'object_pattern' || nameNode.type === 'array_pattern' ||
                        nameNode.type === 'tuple_pattern' || nameNode.type === 'struct_pattern')) {
        break;
      }
      if (rule.field) {
        const value = getChildByField(container, rule.field);
        if (value) valueNodes.push(value);
      } else {
        // Нет поля value в этой грамматике (C# variable_declarator, Dart
        // static_final_declaration): инициализатор — последний именованный дочерний —
        // но декларатор БЕЗ инициализатора имеет своё ИМЯ там вместо.
        // Требуется ≥2 именованных дочерних и никогда не выбираем дочерний name/pattern.
        const value = container.namedChild(container.namedChildCount - 1);
        const nameChild =
          getChildByField(container, 'name') ?? getChildByField(container, 'pattern');
        if (
          value &&
          container.namedChildCount >= 2 &&
          (!nameChild || value.id !== nameChild.id)
        ) {
          valueNodes.push(value);
        }
      }
      break;
    }
  }

  const out: FnRefCandidate[] = [];
  for (const v of valueNodes) {
    // Голый идентификатор — это тот, который нормализуется без прохождения через
    // форму ссылки unwrap/special. Политика addressOfOnly C++ (применяется при
    // фильтрации, где известна область файла) отбрасывает голые идентификаторы
    // вне таблиц инициализаторов глобальной области.
    const explicitRef = !spec.idTypes.has(v.type);
    for (const { name, node, skipGate } of normalizeValue(v, spec, 0)) {
      if (!name || NAME_STOPLIST.has(name)) continue;
      out.push({
        name,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        mode: rule.mode,
        explicitRef,
        skipGate,
      });
    }
  }
  return out;
}

/** Одна нормализованная функция-значение: её имя, исходный узел и политика фильтра. */
interface NormalizedRef {
  name: string;
  node: any;
  skipGate?: boolean;
}

/**
 * Нормализует одно выражение значения в ноль или более имён функций. Рекурсия
 * ограничена (только слои обёрток); всё, что не является распознанной формой
 * функции-значения, даёт [].
 */
function normalizeValue(
  node: any,
  spec: FnRefSpec,
  depth: number
): NormalizedRef[] {
  if (depth > 4) return [];
  const type = node.type;

  // Голый идентификатор
  if (spec.idTypes.has(type)) {
    return [{ name: getNodeText(node), node }];
  }

  // Прозрачные слои (argument, value_argument, literal_element,
  // expression_list, block_argument). expression_list раскрывается (Go `a, b = f, g`).
  const layerField = spec.layers?.get(type);
  if (spec.layers?.has(type)) {
    // Пропуск пересылки параметра с меткой (Swift/Kotlin): `value: value` /
    // `delay: delay` — когда метка РАВНА идентификатору значения, значение —
    // это пересланный локальный/параметр, а не ссылка на функцию (находка
    // Alamofire A/B; то же обоснование, что и пропуск присваивания `this.x = x`).
    if (type === 'value_argument') {
      const label = getChildByField(node, 'name');
      const value = getChildByField(node, 'value') ?? node.namedChild(node.namedChildCount - 1);
      if (
        label &&
        value &&
        getNodeText(label).trim() === getNodeText(value).trim()
      ) {
        return [];
      }
    }
    if (layerField) {
      const inner = getChildByField(node, layerField);
      return inner ? normalizeValue(inner, spec, depth + 1) : [];
    }
    const results: NormalizedRef[] = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) results.push(...normalizeValue(child, spec, depth + 1));
    }
    return results;
  }

  // Унарные обёртки: &fn / @Fn / `fn _`
  const unwrapField = spec.unwrap?.get(type);
  if (spec.unwrap?.has(type)) {
    // C-семейство `pointer_expression` покрывает КАК `&x` (адрес — функция-
    // значение), так и `*x` (дереференс — чтение данных, никогда не функция-
    // значение). Только `&` квалифицируется; без этого чтения `*begin` fmt
    // разрешались в его свободные функции `begin()`.
    if (type === 'pointer_expression' && node.child(0)?.type !== '&') return [];
    const inner = unwrapField ? getChildByField(node, unwrapField) : node.namedChild(0);
    if (!inner) return [];
    // C++ `&Widget::on_click` — сохраняем КАЛИФЦИРОВАННОЕ имя. Разрешение
    // ограничивает метод тем классом (более точно, чем сопоставление голых
    // имён, и освобождено от правила C++ «голые идентификаторы — свободные
    // функции», поскольку `&Cls::m` — явная ссылка на член).
    if (inner.type === 'qualified_identifier') {
      const text = getNodeText(inner).trim();
      return /^[A-Za-z_][\w:]*$/.test(text) ? [{ name: text, node: inner }] : [];
    }
    return normalizeValue(inner, spec, depth + 1);
  }

  // Специальные целые узлы-ссылки
  if (spec.special?.has(type)) {
    return normalizeSpecial(node, type);
  }

  return [];
}

/** Правый потомок-самого-дочернего заданного типа. */
function lastNamedOfType(node: any, types: Set<string>): any | null {
  let found: any | null = null;
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (!child) continue;
    if (types.has(child.type)) found = child;
    const deeper = lastNamedOfType(child, types);
    if (deeper) found = deeper;
  }
  return found;
}

function normalizeSpecial(
  node: any,
  type: string
): NormalizedRef[] {
  switch (type) {
    // Ссылки на методы Java. Получатель решает маршрут разрешения (#808):
    //   `this::run0` / `super::close` → `this.<m>` (резолвер в области класса;
    //     super едет на проходе супертипа наследуемого члена)
    //   `Type::method` (с заглавной) → квалифицированное `Type::method` (суффикс-
    //     сопоставлено с членами того типа, способное кросс-файлово)
    //   `variable::method` → ничего (тип получателя статически неизвестен —
    //     отложенный класс obj.method)
    case 'method_reference': {
      let last: any | null = null;
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child && child.type === 'identifier') last = child;
      }
      if (!last) return [];
      const m = getNodeText(last);
      const text = getNodeText(node);
      if (text.startsWith('this::') || text.startsWith('super::')) {
        return [{ name: `this.${m}`, node: last }];
      }
      const recv = text.match(/^([A-Z][A-Za-z0-9_]*)\s*::/);
      if (recv) {
        // `Type::method` — но `Type::new` (ссылка на конструктор) не имеет
        // узла метода для приземления; пусть стоплист отбросит его через голое имя.
        return m === 'new' ? [] : [{ name: `${recv[1]}::${m}`, node: last }];
      }
      return [];
    }

    // Kotlin `::targetCb` (одна часть) / `OtherClass::handle` (две части —
    // получатель — type_identifier; получатели со строчных — переменные,
    // отложенный класс obj.method).
    case 'callable_reference': {
      let receiver: any | null = null;
      let member: any | null = null;
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (!child) continue;
        if (child.type === 'type_identifier') receiver = child;
        if (child.type === 'simple_identifier') member = child;
      }
      if (!member) return [];
      const m = getNodeText(member);
      if (!receiver) return [{ name: m, node: member }]; // ::topLevelFn
      const recvText = getNodeText(receiver);
      return /^[A-Z]/.test(recvText)
        ? [{ name: `${recvText}::${m}`, node: member }]
        : []; // variable::method — неизвестный тип получателя
    }

    // Kotlin `this::fire` парсится как navigation_expression с `::fire`
    // navigation_suffix — маршрутизация через резолвер области класса `this.`.
    // Обычная навигация `a.b` (и любой получатель, не являющийся `this`) ДОЛЖНА
    // дать ничего.
    case 'navigation_expression': {
      if (!getNodeText(node).startsWith('this::')) return [];
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child && child.type === 'navigation_suffix' && getNodeText(child).startsWith('::')) {
          const id = child.namedChild(child.namedChildCount - 1);
          if (id) return [{ name: `this.${getNodeText(id)}`, node: id }];
        }
      }
      return [];
    }

    // Swift `#selector(Holder.fire)` → fire. ObjC `@selector(storeImage:)` →
    // `storeImage:` дословно (узлы методов ObjC сохраняют свои двоеточия селектора).
    case 'selector_expression': {
      const inner = node.namedChild(0);
      if (!inner) return [];
      if (inner.type === 'identifier' || inner.type === 'simple_identifier') {
        return [{ name: getNodeText(inner), node: inner }];
      }
      // Точечная форма Swift: правый simple_identifier. Ключевой селектор ObjC:
      // текст как есть.
      const last = lastNamedOfType(node, new Set(['simple_identifier']));
      if (last) return [{ name: getNodeText(last), node: last }];
      return [{ name: getNodeText(inner).trim(), node: inner }];
    }

    // Ruby `method(:target_cb)` — `call`, чей метод буквально `method`
    // с одним символьным аргументом.
    case 'call': {
      const method = getChildByField(node, 'method');
      if (!method || getNodeText(method) !== 'method') return [];
      const args = getChildByField(node, 'arguments');
      if (!args || args.namedChildCount !== 1) return [];
      const sym = args.namedChild(0);
      if (!sym || sym.type !== 'simple_symbol') return [];
      const name = getNodeText(sym).replace(/^:/, '');
      return name ? [{ name, node: sym }] : [];
    }

    // `this.handleClick` (TS/JS) — объект должен быть ТОЧНО `this`. Имя
    // сохраняет префикс `this.`, чтобы разрешение могло ограничить его
    // окружающим классом (см. resolveThisMemberFnRef), а не сопоставлять
    // голые имена.
    case 'member_expression': {
      const obj = getChildByField(node, 'object');
      const prop = getChildByField(node, 'property');
      if (obj && prop && obj.type === 'this' && prop.type === 'property_identifier') {
        return [{ name: `this.${getNodeText(prop)}`, node: prop }];
      }
      return [];
    }

    // `self.handle_click` (Python) — объект должен быть ТОЧНО `self`.
    case 'attribute': {
      const obj = getChildByField(node, 'object');
      const attr = getChildByField(node, 'attribute');
      if (obj && attr && obj.type === 'identifier' && getNodeText(obj) === 'self') {
        return [{ name: getNodeText(attr), node: attr }];
      }
      return [];
    }

    // `this.Run0` (C#) — получатель должен быть ТОЧНО `this`. Две формы грамматики:
    // новая tree-sitter-c-sharp экспонирует поле `expression`, содержащее
    // `this_expression`; вендорная грамматика сохраняет `this` как анонимный
    // токен (только поле `name` — именованный дочерний), поэтому откат к тексту узла.
    case 'member_access_expression': {
      const name = getChildByField(node, 'name');
      if (!name) return [];
      const expr = getChildByField(node, 'expression');
      const isThisReceiver = expr
        ? expr.type === 'this_expression' || expr.type === 'this'
        : getNodeText(node).startsWith('this.');
      return isThisReceiver ? [{ name: getNodeText(name), node: name }] : [];
    }

    // Строковый вызываемый PHP — надёжен ТОЛЬКО как аргумент известной
    // функции-принимающей вызываемые (`usort($a, 'cmp_items')`). Глобальные
    // функции PHP ссылаются кросс-файлово без импортов, поэтому они пропускают
    // фильтр имен и полагаются на правило разрешения «уникальный или отбросить».
    // Строка `'Cls::method'` становится квалифицированным кандидатом.
    case 'encapsed_string':
    case 'string': {
      const callee = phpEnclosingCallName(node);
      if (!callee || !PHP_CALLABLE_HOFS.has(callee)) return [];
      const content = phpStringContent(node);
      if (!content) return [];
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(content)) {
        return [{ name: content, node, skipGate: true }];
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/.test(content)) {
        return [{ name: content, node, skipGate: true }];
      }
      return [];
    }

    // Массивные вызываемые PHP, допустимы в аргументах ЛЮБОГО вызова (сама
    // форма однозначна): `[$this, 'method']` → область класса `this.method`;
    // `[Foo::class, 'method']` → квалифицированное `Foo::method`.
    case 'array_creation_expression': {
      if (node.namedChildCount !== 2) return [];
      const recv = node.namedChild(0)?.namedChild(0);
      const strEl = node.namedChild(1)?.namedChild(0);
      if (!recv || !strEl) return [];
      if (strEl.type !== 'encapsed_string' && strEl.type !== 'string') return [];
      const member = phpStringContent(strEl);
      if (!member || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(member)) return [];
      if (recv.type === 'variable_name' && getNodeText(recv) === '$this') {
        return [{ name: `this.${member}`, node: strEl }];
      }
      if (recv.type === 'class_constant_access_expression') {
        const cls = recv.namedChild(0);
        const kw = recv.namedChild(1);
        if (cls && kw && getNodeText(kw) === 'class') {
          return [{ name: `${getNodeText(cls)}::${member}`, node: strEl }];
        }
      }
      return [];
    }

    // Символы хук-DSL Ruby (`before_action :authenticate`,
    // `rescue_from E, with: :render_404`): символ именует метод
    // ОКРУЖАЮЩЕГО класса — маршрутизация через резолвер области класса `this.`
    // (который также обходит суперклассы, покрывая наследование в стиле
    // ApplicationController). Символы под любым другим вызовом дают ничего.
    case 'simple_symbol': {
      const call = rubyEnclosingCall(node);
      if (!call) return [];
      const method = getChildByField(call, 'method');
      if (!method || !isRubyHookCall(getNodeText(method))) return [];
      const sym = getNodeText(node).replace(/^:/, '');
      if (!/^[A-Za-z_][A-Za-z0-9_?!]*$/.test(sym)) return [];
      return [{ name: `this.${sym}`, node }];
    }

    default:
      return [];
  }
}

/** Содержание узла строкового литерала PHP (с одинарными или двойными кавычками). */
function phpStringContent(node: any): string | null {
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === 'string_content') return getNodeText(child).trim();
  }
  return null;
}

/** Имя функции вызова PHP, аргументы которого содержат `node`, если есть. */
function phpEnclosingCallName(node: any): string | null {
  let cur: any | null = node.parent;
  for (let hops = 0; cur && hops < 4; hops++, cur = cur.parent) {
    if (cur.type === 'function_call_expression') {
      const fn = getChildByField(cur, 'function');
      return fn ? fn.text : null;
    }
    if (cur.type === 'member_call_expression' || cur.type === 'scoped_call_expression') {
      return null; // вызовы методов — не основные HOF
    }
  }
  return null;
}

/** Узел Ruby `call`, аргументы (или ключевая пара) которого содержат `node`. */
function rubyEnclosingCall(node: any): any | null {
  let cur: any | null = node.parent;
  for (let hops = 0; cur && hops < 4; hops++, cur = cur.parent) {
    if (cur.type === 'call') return cur;
  }
  return null;
}
