/**
 * Синтез указателей на функции в C/C++.
 *
 * C/C++ полиморфизм основан на указателях на функции: struct содержит поле
 * с указателем на функцию (`int (*fn)(int)` или typedef `hook_func func`),
 * конкретные функции регистрируются через таблицы инициализации или присваивания,
 * а диспетчер вызывает их косвенно (`p->fn(argv)`).
 *
 * Этот модуль связывает:
 *   - регистрации — функция привязана к `S.field` через позиционный или
 *     designated инициализатор, или прямое присваивание `x->field = fn`;
 *   - диспетчеризация — `recv->field(…)` где `recv` имеет тип struct `S`;
 *   - поле-в-поле распространение — `a->f = b->g` объединяет обработчики.
 *
 * Также обрабатывает массивы указателей на функции без struct:
 * `opcode_t *opcodes[256] = {nop, …}` с диспетчеризацией `opcodes[op](…)`.
 */

import * as path from 'node:path';
import type { QueryBuilder } from '../ntgraph/QueryBuilder';
import type { IEdge, INode, IResolutionContext, NodeKind } from '../ntgraph/Types';
import { LRUCache } from '../ntgraph/LruCache';
import { stripCommentsForRegex } from '../extraction/StripComments';
import { memoryBudgetBytes } from './MemoryBudget';

// =============================================================================
// Константы
// =============================================================================

/** Расширения файлов C/C++. */
const C_CPP_EXT = /\.(c|h|cc|cpp|cxx|hpp|hh|hxx|cppm|ipp|inl|tcc)$/i;

/** Виды узлов, представляющих функции. */
const FN_KINDS = new Set<NodeKind>(['function', 'method']);

/** Максимальное число рёбер от одной точки диспетчеризации. */
const FANOUT_CAP = 300;

/** Ключевые слова типов C/C++, которые нельзя путать с именами typedef. */
const C_TYPE_KEYWORDS = new Set([
  'void', 'int', 'char', 'short', 'long', 'unsigned', 'signed', 'float', 'double',
  'const', 'struct', 'union', 'enum', 'static', 'volatile', 'register', 'inline',
]);

/** Расширения файлов, которые могут содержать таблицы регистрации. */
const INCLUDABLE_EXT = /\.(def|inc|h|hh|hpp|hxx|c|cc|cpp|cxx|ipp|tcc|tbl)$/i;

// =============================================================================
// Интерфейсы
// =============================================================================

/** Поле struct, в порядке объявления, с флагом указателя на функцию. */
interface FieldInfo {
  name: string;
  index: number;
  isFnPtr: boolean;
  type: string;
}

/** Сырое объявление поля, распознанное на этапе сканирования. */
interface RawFieldDecl {
  name: string | null;
  index: number;
  ptr: boolean;
  type: string;
}

/** Факты файла, собранные на этапе сканирования. */
interface FileFacts {
  initTokens: string[] | null;
  arrayElems: string[] | null;
  inlinePtr: boolean;
  inlineTypes: string[] | null;
  dPairs: string[] | null;
  dispatchFields: string[] | null;
  arrayDispatchNames: string[] | null;
  includes: string[];
}

/** Функциональный макрос: `#define NAME(p0,p1,…) expansion`. */
interface MacroDef {
  params: string[];
  expansion: string;
}

/** Единица регистрации. */
interface Unit {
  text: string;
  file: string;
  env: Map<string, MacroDef>;
  objEnv: Map<string, string>;
}

/** Пара распространения поля. */
interface PropagationPair {
  to: string;
  from: string;
}

// =============================================================================
// Регулярные выражения
// =============================================================================

const FNPTR_DECL_RE = /\(\s*(?:\w+\s+)*\*\s*(\w+)\s*\)\s*\(/;
const FNPTR_TYPEDEF_RE = /\btypedef\b[^;{}]*?\(\s*(?:\w+\s+)*\*\s*(\w+)\s*\)\s*\(/g;
const FNTYPE_TYPEDEF_STMT_RE = /\btypedef\b([^;{}]*);/g;
const INCLUDE_RE = /#[ \t]*include[ \t]+"([^"\n]+)"/g;
const OBJ_ALIAS_RE = /^[ \t]*#[ \t]*define[ \t]+(\w+)[ \t]+(?:struct[ \t]+)*[A-Za-z_]\w*[ \t\r]*$/gm;
const INIT_RE =
  /(?:^|[;{}])\s*(?:(?:static|const|extern|register|volatile)\s+)*(?:struct\s+)?(\w+)\s+(\w+)\s*(\[[^\]]*\])?\s*=\s*\{/g;
const INLINE_STRUCT_RE = /\bstruct\s+(\w+)\s*\{/g;
const ARRAY_TABLE_RE =
  /(?:^|[;{}])\s*(?:(?:static|const|extern|register|volatile)\s+)*(\w+)\s+(\*\s*)?(\w+)\s*\[[^\]]*\]\s*=\s*\{/g;
const DISPATCH_RE = /((?:\w+(?:\s*\[[^\][]*\])?\s*(?:->|\.)\s*)+)(\w+)\s*\)?\s*\(/g;
const ARRAY_DISPATCH_RE = /(?:\(\s*\*\s*)?\b(\w+)\s*\[[^\][]*\]\s*\)?\s*\(/g;
const FIELD_ASSIGN_RE = /(\w+)\s*(?:->|\.)\s*(\w+)\s*=\s*(\w+)\s*(?:->|\.)\s*(\w+)/g;

// =============================================================================
// Вспомогательные функции (статические)
// =============================================================================

function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(body: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === sep && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out;
}

function sliceLinesPre(lines: string[], startLine?: number, endLine?: number): string {
  if (!startLine) return '';
  return lines.slice(startLine - 1, endLine ?? startLine).join('\n');
}

function parseFunctionMacros(stripped: string): Map<string, MacroDef> {
  const out = new Map<string, MacroDef>();
  if (!stripped.includes('#define') && !stripped.includes('# define')) return out;
  const joined = stripped.replace(/\\\r?\n/g, ' ');
  const RE = /^[ \t]*#[ \t]*define[ \t]+(\w+)\(([^)]*)\)\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(joined))) {
    const params = m[2]!.split(',').map((p) => p.trim()).filter(Boolean);
    if (params.some((p) => p === '...' || p.endsWith('...'))) continue;
    out.set(m[1]!, { params, expansion: m[3]!.trim() });
  }
  return out;
}

function parseObjectMacros(stripped: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!stripped.includes('#define') && !stripped.includes('# define')) return out;
  const joined = stripped.replace(/\\\r?\n/g, ' ');
  const RE = /^[ \t]*#[ \t]*define[ \t]+(\w+)[ \t]+(\S[^\n]*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(joined))) out.set(m[1]!, m[2]!.trim());
  return out;
}

function parseDefinedNames(stripped: string): Set<string> {
  const out = new Set<string>();
  if (!stripped.includes('#define') && !stripped.includes('# define')) return out;
  const RE = /^[ \t]*#[ \t]*define[ \t]+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(stripped))) out.add(m[1]!);
  return out;
}

function evalConditionals(text: string, defined: Set<string>): string {
  if (!/#\s*if/.test(text)) return text;
  const lines = text.split('\n');
  const stack: { parentActive: boolean; active: boolean; taken: boolean }[] = [];
  const activeNow = (): boolean => (stack.length === 0 ? true : stack[stack.length - 1]!.active);
  const condDefined = (expr: string): boolean | null => {
    let mm = expr.match(/^defined\s*\(?\s*(\w+)\s*\)?$/);
    if (mm) return defined.has(mm[1]!);
    mm = expr.match(/^!\s*defined\s*\(?\s*(\w+)\s*\)?$/);
    if (mm) return !defined.has(mm[1]!);
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    let mm: RegExpMatchArray | null;
    if ((mm = t.match(/^#\s*ifdef\s+(\w+)/))) {
      const pa = activeNow();
      const cond = defined.has(mm[1]!);
      stack.push({ parentActive: pa, active: pa && cond, taken: cond });
      lines[i] = '';
      continue;
    }
    if ((mm = t.match(/^#\s*ifndef\s+(\w+)/))) {
      const pa = activeNow();
      const cond = !defined.has(mm[1]!);
      stack.push({ parentActive: pa, active: pa && cond, taken: cond });
      lines[i] = '';
      continue;
    }
    if ((mm = t.match(/^#\s*if\s+(.+)$/))) {
      const pa = activeNow();
      const c = condDefined(mm[1]!.trim());
      const cond = c === null ? true : c;
      stack.push({ parentActive: pa, active: pa && cond, taken: cond });
      lines[i] = '';
      continue;
    }
    if (/^#\s*elif\b/.test(t)) {
      const top = stack[stack.length - 1];
      if (top) { top.active = top.parentActive && !top.taken; top.taken = true; }
      lines[i] = '';
      continue;
    }
    if (/^#\s*else\b/.test(t)) {
      const top = stack[stack.length - 1];
      if (top) { top.active = top.parentActive && !top.taken; top.taken = true; }
      lines[i] = '';
      continue;
    }
    if (/^#\s*endif\b/.test(t)) {
      stack.pop();
      lines[i] = '';
      continue;
    }
    if (!activeNow()) lines[i] = '';
  }
  return lines.join('\n');
}

function resolveTypeName(name: string, objEnv: Map<string, string> | undefined): string {
  let n = name;
  for (let i = 0; objEnv && i < 5; i++) {
    const v = objEnv.get(n);
    const t = v?.trim().match(/^(?:struct\s+)?(\w+)$/);
    if (!t) break;
    n = t[1]!;
  }
  return n;
}

function substituteMacro(def: MacroDef, args: string[]): string {
  const map = new Map<string, string>();
  def.params.forEach((p, i) => map.set(p, args[i] ?? ''));
  return def.expansion.replace(/\b\w+\b/g, (tok) => (map.has(tok) ? map.get(tok)! : tok));
}

function expandMacroCalls(text: string, env: Map<string, MacroDef>): string {
  if (env.size === 0) return text;
  let out = text;
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    const RE = /\b(\w+)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = RE.exec(out))) {
      const def = env.get(m[1]!);
      if (!def) continue;
      const open = m.index + m[0].length - 1;
      const close = matchParen(out, open);
      if (close < 0) continue;
      const args = splitTopLevel(out.slice(open + 1, close), ',').map((a) => a.trim());
      out = out.slice(0, m.index) + substituteMacro(def, args) + out.slice(close + 1);
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return out;
}

function parseStructFieldsRaw(inner: string): RawFieldDecl[] {
  const fields: RawFieldDecl[] = [];
  let idx = 0;
  for (const rawDecl of splitTopLevel(inner, ';')) {
    const decl = rawDecl.trim();
    if (!decl) continue;
    const parts = splitTopLevel(decl, ',');
    const firstTyped = parts[0]!.match(/(\w+)\s+\**\s*(\w+)\s*$/);
    const sharedType = firstTyped ? firstTyped[1]! : '';
    for (let pi = 0; pi < parts.length; pi++) {
      const p = parts[pi]!.trim();
      let name: string | null = null;
      let type = '';
      let ptr = false;
      const pm = p.match(FNPTR_DECL_RE);
      if (pm) {
        name = pm[1]!;
        ptr = true;
      } else if (pi === 0) {
        if (firstTyped) { name = firstTyped[2]!; type = sharedType; }
      } else {
        const dm = p.match(/^\**\s*(\w+)/);
        if (dm) { name = dm[1]!; type = sharedType; }
      }
      fields.push({ name, index: idx, ptr, type });
      idx++;
    }
  }
  return fields;
}

function classifyFields(
  rawFields: RawFieldDecl[],
  fnPtrTypedefs: Set<string>,
  fnTypeTypedefs: Set<string>
): FieldInfo[] {
  return rawFields.map((f) => ({
    name: f.name ?? '',
    index: f.index,
    isFnPtr:
      !!f.name &&
      (f.ptr || (!!f.type && (fnPtrTypedefs.has(f.type) || fnTypeTypedefs.has(f.type)))),
    type: f.type,
  }));
}

function escapeRe(x: string): string {
  return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// =============================================================================
// Основной синтез
// =============================================================================

/**
 * Основной вход — синтез рёбер диспетчеризации указателей на функции в C/C++.
 */
export function synthesizeCfnptrEdges(
  _queries: QueryBuilder,
  context: IResolutionContext
): IEdge[] {
  const files = context.getAllFiles().filter((f) => C_CPP_EXT.test(f));
  if (files.length === 0) return [];

  // Кэш содержимого файлов
  const rawCache = new LRUCache<string, string | null>(Math.min(files.length + 512, 4096));
  const raw = (file: string): string | null => {
    if (rawCache.has(file)) return rawCache.get(file)!;
    const r = context.getFileContent(file);
    rawCache.set(file, r);
    return r;
  };

  // Интернирование строк для экономии памяти
  const interned = new Map<string, string>();
  const intern = (x: string): string => {
    let f = interned.get(x);
    if (f === undefined) {
      f = Buffer.from(x, 'utf8').toString('utf8');
      interned.set(f, f);
    }
    return f;
  };

  // Кэш очищенного источника
  const srcCache = new LRUCache<string, string>(
    memoryBudgetBytes() * 0.5 >= files.length * 1.05 * 24576
      ? Math.ceil(files.length * 1.05) + 512
      : 128
  );
  const src = (file: string): string | null => {
    const hit = srcCache.get(file);
    if (hit !== undefined) return hit;
    const r = raw(file);
    const s = r == null ? '' : stripCommentsForRegex(r, 'c');
    srcCache.set(file, s);
    return r == null ? null : s;
  };

  // Разрешение #include относительно файла-включающего
  const resolveInclude = (includer: string, inc: string): string | null => {
    const dir = path.posix.dirname(includer.replace(/\\/g, '/'));
    const cand = path.posix.normalize(path.posix.join(dir, inc));
    if (context.getFileContent(cand) !== null) return cand;
    if (context.getFileContent(inc) !== null) return inc;
    return null;
  };

  // ---- Глобальные таблицы ----
  const fnPtrTypedefs = new Set<string>();
  const fnTypeTypedefs = new Set<string>();
  const rawFieldsByNode = new Map<string, RawFieldDecl[]>();
  const factsByFile = new Map<string, FileFacts>();
  const inlineTags = new Set<string>();
  const aliasNames = new Set<string>();

  // ---- Этап A: сканирование извлечения ----
  for (const file of files) {
    const s = src(file);
    if (!s) continue;

    if (s.includes('typedef')) {
      FNPTR_TYPEDEF_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = FNPTR_TYPEDEF_RE.exec(s))) fnPtrTypedefs.add(intern(m[1]!));
      FNTYPE_TYPEDEF_STMT_RE.lastIndex = 0;
      while ((m = FNTYPE_TYPEDEF_STMT_RE.exec(s))) {
        const guts = m[1]!;
        if (guts.includes('(*') || guts.includes('( *')) continue;
        const fm = guts.match(/\b(\w+)\s*\(/);
        if (fm && !C_TYPE_KEYWORDS.has(fm[1]!)) fnTypeTypedefs.add(intern(fm[1]!));
      }
    }

    const fileNodes = context.getNodesByFile(file);
    let lines: string[] | null = null;
    for (const st of fileNodes) {
      if (st.kind !== 'struct') continue;
      lines ??= s.split('\n');
      const body = sliceLinesPre(lines, st.startLine, st.endLine);
      const open = body.indexOf('{');
      const close = open >= 0 ? matchBrace(body, open) : -1;
      if (open < 0 || close < 0) continue;
      rawFieldsByNode.set(st.id, parseStructFieldsRaw(body.slice(open + 1, close)));
    }

    const initTokens = new Set<string>();
    const arrayElems = new Set<string>();
    const inlineTypes = new Set<string>();
    let inlinePtr = false;
    if (s.includes('{')) {
      INLINE_STRUCT_RE.lastIndex = 0;
      let im: RegExpExecArray | null;
      while ((im = INLINE_STRUCT_RE.exec(s))) {
        const sOpen = im.index + im[0].length - 1;
        const sClose = matchBrace(s, sOpen);
        if (sClose < 0) continue;
        const vm = s.slice(sClose + 1).match(/^\s*(\w+)\s*(\[[^\]]*\])?\s*(=\s*\{)?/);
        if (!vm || !vm[1]) continue;
        inlineTags.add(intern(im[1]!));
        for (const f of parseStructFieldsRaw(s.slice(sOpen + 1, sClose))) {
          if (!f.name) continue;
          if (f.ptr) inlinePtr = true;
          else if (f.type) inlineTypes.add(intern(f.type));
        }
      }
      if (s.includes('=')) {
        INIT_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = INIT_RE.exec(s))) initTokens.add(intern(m[1]!));
        ARRAY_TABLE_RE.lastIndex = 0;
        while ((m = ARRAY_TABLE_RE.exec(s))) arrayElems.add(intern((m[2] ? '*' : '') + m[1]!));
      }
    }

    if (s.includes('#define') || s.includes('# define')) {
      const joined = s.replace(/\\\r?\n/g, ' ');
      OBJ_ALIAS_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = OBJ_ALIAS_RE.exec(joined))) aliasNames.add(intern(m[1]!));
    }

    const dPairs = new Set<string>();
    if (s.includes('=')) {
      FIELD_ASSIGN_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = FIELD_ASSIGN_RE.exec(s))) dPairs.add(intern(m[2]! + '\0' + m[4]!));
    }
    const dispatchFields = new Set<string>();
    const arrayNames = new Set<string>();
    DISPATCH_RE.lastIndex = 0;
    let dm: RegExpExecArray | null;
    while ((dm = DISPATCH_RE.exec(s))) dispatchFields.add(intern(dm[2]!));
    ARRAY_DISPATCH_RE.lastIndex = 0;
    while ((dm = ARRAY_DISPATCH_RE.exec(s))) arrayNames.add(intern(dm[1]!));

    const includes: string[] = [];
    const rawText = raw(file);
    if (rawText && rawText.includes('include')) {
      INCLUDE_RE.lastIndex = 0;
      let im: RegExpExecArray | null;
      while ((im = INCLUDE_RE.exec(rawText))) {
        if (!INCLUDABLE_EXT.test(im[1]!)) continue;
        const t = resolveInclude(file, im[1]!);
        if (t) includes.push(intern(t));
      }
    }

    if (
      initTokens.size || arrayElems.size || inlinePtr || inlineTypes.size ||
      dPairs.size || dispatchFields.size || arrayNames.size || includes.length
    ) {
      factsByFile.set(file, {
        initTokens: initTokens.size ? [...initTokens] : null,
        arrayElems: arrayElems.size ? [...arrayElems] : null,
        inlinePtr,
        inlineTypes: inlineTypes.size ? [...inlineTypes] : null,
        dPairs: dPairs.size ? [...dPairs] : null,
        dispatchFields: dispatchFields.size ? [...dispatchFields] : null,
        arrayDispatchNames: arrayNames.size ? [...arrayNames] : null,
        includes: includes.length ? includes : [],
      });
    }
  }

  // ---- Этап B: макеты полей struct ----
  const structLayout = new Map<string, FieldInfo[]>();
  const allStructFields = new Map<string, FieldInfo[][]>();
  const fieldToStructs = new Map<string, Set<string>>();

  const registerStructLayout = (name: string, fields: FieldInfo[]): void => {
    if (!allStructFields.has(name)) allStructFields.set(name, []);
    allStructFields.get(name)!.push(fields);
    for (const f of fields) {
      if (f.name && f.isFnPtr) {
        if (!fieldToStructs.has(f.name)) fieldToStructs.set(f.name, new Set());
        fieldToStructs.get(f.name)!.add(name);
      }
    }
    if (fields.some((f) => f.isFnPtr)) structLayout.set(name, fields);
  };

  for (const st of context.getNodesByKind('struct')) {
    if (!C_CPP_EXT.test(st.filePath)) continue;
    const rawFields = rawFieldsByNode.get(st.id);
    if (!rawFields) continue;
    registerStructLayout(st.name, classifyFields(rawFields, fnPtrTypedefs, fnTypeTypedefs));
  }
  rawFieldsByNode.clear();

  const fnPtrFieldOf = (struct: string, field: string): boolean =>
    !!structLayout.get(struct)?.some((f) => f.name === field && f.isFnPtr);

  const resolveFn = (name: string, preferFile?: string): INode | null => {
    const cands = context.getNodesByName(name).filter((n) => FN_KINDS.has(n.kind));
    if (cands.length === 0) return null;
    if (cands.length === 1) return cands[0]!;
    if (preferFile) {
      const same = cands.find((n) => n.filePath === preferFile);
      if (same) return same;
    }
    return cands[0]!;
  };

  // ---- Этап C: регистрации ----
  const reg = new Map<string, Set<string>>();
  const addReg = (struct: string, field: string, fn: INode): void => {
    const key = `${struct}.${field}`;
    if (!reg.has(key)) reg.set(key, new Set());
    reg.get(key)!.add(fn.id);
  };

  const arrayReg = new Map<string, { file: string; ids: Set<string> }[]>();
  const addArrayReg = (name: string, file: string, fn: INode): void => {
    let entries = arrayReg.get(name);
    if (!entries) { entries = []; arrayReg.set(name, entries); }
    let e = entries.find((x) => x.file === file);
    if (!e) { e = { file, ids: new Set() }; entries.push(e); }
    e.ids.add(fn.id);
  };

  const registerStructValue = (
    struct: string,
    valueBody: string,
    file: string,
    env?: Map<string, MacroDef>
  ): void => {
    const layout = structLayout.get(struct);
    if (!layout) return;
    if (env && env.size) valueBody = expandMacroCalls(valueBody, env);
    valueBody = valueBody.trim();
    if (valueBody.startsWith('{')) {
      const e = matchBrace(valueBody, 0);
      if (e > 0 && valueBody.slice(e + 1).trim() === '') valueBody = valueBody.slice(1, e);
    }
    const items = splitTopLevel(valueBody, ',');
    let pos = 0;
    for (const rawItem of items) {
      const item = rawItem.trim();
      if (!item) continue;
      const des = item.match(/^\.\s*(\w+)\s*=\s*(?:&\s*)?(\w+)\s*$/);
      if (des) {
        const field = des[1]!;
        if (fnPtrFieldOf(struct, field)) {
          const fn = resolveFn(des[2]!, file);
          if (fn) addReg(struct, field, fn);
        }
        continue;
      }
      const field = layout.find((f) => f.index === pos);
      if (field?.isFnPtr) {
        const id = item.match(/^&?\s*(\w+)\s*$/);
        if (id) {
          const fn = resolveFn(id[1]!, file);
          if (fn) addReg(struct, field.name, fn);
        }
      }
      pos++;
    }
  };

  const registerArrayValue = (
    name: string,
    body: string,
    file: string,
    env?: Map<string, MacroDef>
  ): void => {
    if (env && env.size) body = expandMacroCalls(body, env);
    for (const rawItem of splitTopLevel(body, ',')) {
      let item = rawItem.trim();
      if (!item) continue;
      const des = item.match(/^\[[^\]]*\]\s*=\s*([\s\S]*)$/);
      if (des) item = des[1]!.trim();
      item = item.replace(/^\((?:[\w\s*]+)\)\s*/, '').replace(/^&\s*/, '').trim();
      const id = item.match(/^(\w+)$/);
      if (!id) continue;
      const fn = resolveFn(id[1]!, file);
      if (fn) addArrayReg(name, file, fn);
    }
  };

  // Кэши макросов
  const fnMacroCache = new LRUCache<string, Map<string, MacroDef>>(256);
  const fileFnMacros = (file: string): Map<string, MacroDef> => {
    let m = fnMacroCache.get(file);
    if (!m) { m = parseFunctionMacros(src(file) ?? ''); fnMacroCache.set(file, m); }
    return m;
  };
  const objMacroCache = new LRUCache<string, Map<string, string>>(256);
  const fileObjMacros = (file: string): Map<string, string> => {
    let m = objMacroCache.get(file);
    if (!m) { m = parseObjectMacros(src(file) ?? ''); objMacroCache.set(file, m); }
    return m;
  };
  const definedCache = new LRUCache<string, Set<string>>(256);
  const fileDefinedNames = (file: string): Set<string> => {
    let d = definedCache.get(file);
    if (!d) { d = parseDefinedNames(src(file) ?? ''); definedCache.set(file, d); }
    return d;
  };

  const buildEnv = (
    file: string,
    depth: number,
    seen: Set<string>,
    fn: Map<string, MacroDef>,
    obj: Map<string, string>,
    def: Set<string>
  ): void => {
    if (depth < 0 || seen.has(file)) return;
    seen.add(file);
    for (const [k, v] of fileFnMacros(file)) if (!fn.has(k)) fn.set(k, v);
    for (const [k, v] of fileObjMacros(file)) if (!obj.has(k)) obj.set(k, v);
    for (const n of fileDefinedNames(file)) def.add(n);
    for (const inc of localIncludesOf(file)) buildEnv(inc, depth - 1, seen, fn, obj, def);
  };

  const NO_INCLUDES: string[] = [];
  const includeCache = new LRUCache<string, string[]>(1024);
  const localIncludesOf = (file: string): string[] => {
    const f = factsByFile.get(file);
    if (f) return f.includes;
    let out = includeCache.get(file);
    if (out) return out;
    const rawText = raw(file);
    if (!rawText || !rawText.includes('include')) { includeCache.set(file, NO_INCLUDES); return NO_INCLUDES; }
    const incs: string[] = [];
    INCLUDE_RE.lastIndex = 0;
    let im: RegExpExecArray | null;
    while ((im = INCLUDE_RE.exec(rawText))) {
      if (!INCLUDABLE_EXT.test(im[1]!)) continue;
      const t = resolveInclude(file, im[1]!);
      if (t) incs.push(intern(t));
    }
    out = incs.length ? incs : NO_INCLUDES;
    includeCache.set(file, out);
    return out;
  };

  const processInit = (
    struct: string,
    body: string,
    isArray: boolean,
    file: string,
    env: Map<string, MacroDef>
  ): void => {
    if (isArray) {
      for (const el of splitTopLevel(body, ',')) {
        const t = el.trim();
        if (t.startsWith('{')) {
          const e = matchBrace(t, 0);
          if (e > 0) registerStructValue(struct, t.slice(1, e), file, env);
        } else if (t) {
          registerStructValue(struct, t, file, env);
        }
      }
    } else {
      registerStructValue(struct, body, file, env);
    }
  };

  const globalVarType = new Map<string, string>();

  const processUnit = (unit: Unit): void => {
    const s = unit.text;
    if (!s || !s.includes('{')) return;

    INLINE_STRUCT_RE.lastIndex = 0;
    let im: RegExpExecArray | null;
    while ((im = INLINE_STRUCT_RE.exec(s))) {
      const tag = im[1]!;
      const sOpen = im.index + im[0].length - 1;
      const sClose = matchBrace(s, sOpen);
      if (sClose < 0) continue;
      const after = s.slice(sClose + 1);
      const vm = after.match(/^\s*(\w+)\s*(\[[^\]]*\])?\s*(=\s*\{)?/);
      if (!vm || !vm[1]) continue;
      const fields = classifyFields(
        parseStructFieldsRaw(s.slice(sOpen + 1, sClose)),
        fnPtrTypedefs,
        fnTypeTypedefs
      );
      if (!fields.some((f) => f.isFnPtr)) continue;
      if (!structLayout.has(tag)) registerStructLayout(tag, fields);
      globalVarType.set(vm[1]!, tag);
      if (vm[3]) {
        const aOpen = sClose + 1 + after.indexOf('{', vm[0].length - 1);
        const aClose = matchBrace(s, aOpen);
        if (aClose > 0) {
          processInit(tag, s.slice(aOpen + 1, aClose), !!vm[2], unit.file, unit.env);
          INLINE_STRUCT_RE.lastIndex = aClose;
        }
      }
    }

    if (!s.includes('=')) return;
    INIT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INIT_RE.exec(s))) {
      let struct = m[1]!;
      if (!structLayout.has(struct)) struct = resolveTypeName(struct, unit.objEnv);
      if (!structLayout.has(struct)) continue;
      const isArray = !!m[3];
      const open = m.index + m[0].length - 1;
      const close = matchBrace(s, open);
      if (close < 0) continue;
      globalVarType.set(m[2]!, struct);
      processInit(struct, s.slice(open + 1, close), isArray, unit.file, unit.env);
      INIT_RE.lastIndex = close;
    }

    ARRAY_TABLE_RE.lastIndex = 0;
    let am: RegExpExecArray | null;
    while ((am = ARRAY_TABLE_RE.exec(s))) {
      const elemType = am[1]!;
      const hasStar = !!am[2];
      if (!((fnTypeTypedefs.has(elemType) && hasStar) || fnPtrTypedefs.has(elemType))) continue;
      const open = am.index + am[0].length - 1;
      const close = matchBrace(s, open);
      if (close < 0) continue;
      registerArrayValue(am[3]!, s.slice(open + 1, close), unit.file, unit.env);
      ARRAY_TABLE_RE.lastIndex = close;
    }
  };

  const typedefHit = (t: string): boolean => fnPtrTypedefs.has(t) || fnTypeTypedefs.has(t);
  const regSurvives = (f: FileFacts): boolean =>
    f.inlinePtr ||
    (f.inlineTypes?.some(typedefHit) ?? false) ||
    (f.initTokens?.some((t) => structLayout.has(t) || inlineTags.has(t) || aliasNames.has(t)) ?? false) ||
    (f.arrayElems?.some((e) =>
      e.charCodeAt(0) === 42 ? typedefHit(e.slice(1)) : fnPtrTypedefs.has(e)
    ) ?? false);

  const indexedSet = new Set(files);
  const seenInclude = new Set<string>();

  for (const file of files) {
    const facts = factsByFile.get(file);
    if (!facts) continue;
    const survives = regSurvives(facts);
    if (!survives && facts.includes.length === 0) continue;
    const env = new Map<string, MacroDef>();
    const objEnv = new Map<string, string>();
    const defined = new Set<string>();
    buildEnv(file, 2, new Set(), env, objEnv, defined);
    if (survives) {
      const s = src(file);
      if (s) processUnit({ text: s, file, env, objEnv });
    }
    for (const target of facts.includes) {
      if (seenInclude.has(`${file}>${target}`)) continue;
      const incSrc = src(target);
      if (!incSrc) continue;
      if (indexedSet.has(target)) {
        const ownDef = fileDefinedNames(target);
        const adds = [...defined].some((n) => !ownDef.has(n));
        if (!adds || !/#\s*if/.test(incSrc)) continue;
      }
      seenInclude.add(`${file}>${target}`);
      const text = evalConditionals(incSrc, defined);
      const incEnv = new Map(env);
      for (const [k, v] of parseFunctionMacros(text)) incEnv.set(k, v);
      const incObjEnv = new Map(objEnv);
      for (const [k, v] of parseObjectMacros(text)) incObjEnv.set(k, v);
      processUnit({ text, file: target, env: incEnv, objEnv: incObjEnv });
    }
  }

  // ---- Разрешение типа получателя (внутри замыкания) ----
  const recvReCache = new Map<string, RegExp>();
  const recvTypeIn = (fnSrc: string, recv: string): string | null => {
    let re = recvReCache.get(recv);
    if (!re) {
      re = new RegExp(`(?:struct\\s+)?(\\w+)\\s*\\*?\\s*\\b${recv}\\b\\s*(?:[,)=;]|\\[)`, 'g');
      recvReCache.set(recv, re);
    }
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fnSrc))) {
      if (structLayout.has(m[1]!)) return m[1]!;
    }
    return null;
  };

  const varReCache = new Map<string, RegExp>();
  const varTypeIn = (fnSrc: string, v: string): string | null => {
    let re = varReCache.get(v);
    if (!re) {
      re = new RegExp(`(?:struct\\s+)?(\\w+)\\s*\\*?\\s*\\b${escapeRe(v)}\\b\\s*(?:[,)=;]|\\[)`, 'g');
      varReCache.set(v, re);
    }
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fnSrc))) {
      if (!C_TYPE_KEYWORDS.has(m[1]!)) return m[1]!;
    }
    return globalVarType.get(v) ?? null;
  };

  const resolveChainType = (fnSrc: string, chain: string): string | null => {
    const segs = chain.replace(/\s*\[[^\]]*\]/g, '').split(/\s*(?:->|\.)\s*/).filter(Boolean);
    if (segs.length === 0) return null;
    let t = varTypeIn(fnSrc, segs[0]!);
    for (let i = 1; t && i < segs.length; i++) {
      let next: string | null = null;
      for (const fields of allStructFields.get(t) ?? []) {
        const f = fields.find((fl) => fl.name === segs[i] && fl.type);
        if (f) { next = f.type; break; }
      }
      t = next;
    }
    return t;
  };

  // ---- Этап D: поле-в-поле распространение ----
  const propagations: PropagationPair[] = [];
  for (const file of files) {
    const facts = factsByFile.get(file);
    if (
      !facts?.dPairs?.some((p) => {
        const i = p.indexOf('\0');
        return fieldToStructs.has(p.slice(0, i)) && fieldToStructs.has(p.slice(i + 1));
      })
    ) continue;
    const s = src(file);
    if (!s || !s.includes('=')) continue;
    const fileNodes = context.getNodesByFile(file);
    const dLines = s.split('\n');
    for (const fn of fileNodes) {
      if (!FN_KINDS.has(fn.kind)) continue;
      const body = sliceLinesPre(dLines, fn.startLine, fn.endLine);
      if (!body.includes('=')) continue;
      FIELD_ASSIGN_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = FIELD_ASSIGN_RE.exec(body))) {
        const [, lrecv, lfield, rrecv, rfield] = m;
        if (!fieldToStructs.has(lfield!) || !fieldToStructs.has(rfield!)) continue;
        const lt = recvTypeIn(body, lrecv!);
        const rt = recvTypeIn(body, rrecv!);
        if (lt && rt && fnPtrFieldOf(lt, lfield!) && fnPtrFieldOf(rt, rfield!)) {
          propagations.push({ to: `${lt}.${lfield}`, from: `${rt}.${rfield}` });
        }
      }
    }
  }
  for (let pass = 0; pass < 3 && propagations.length; pass++) {
    let changed = false;
    for (const { to, from } of propagations) {
      const fromSet = reg.get(from);
      if (!fromSet) continue;
      if (!reg.has(to)) reg.set(to, new Set());
      const toSet = reg.get(to)!;
      for (const id of fromSet) {
        if (!toSet.has(id)) {
          toSet.add(id);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  if (reg.size === 0 && arrayReg.size === 0) return [];

  // ---- Этап E: точки диспетчеризации → рёбра ----
  const edges: IEdge[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const facts = factsByFile.get(file);
    if (!facts) continue;
    const eSurvives =
      (facts.dispatchFields?.some((f) => fieldToStructs.has(f)) ?? false) ||
      (arrayReg.size > 0 && (facts.arrayDispatchNames?.some((n) => arrayReg.has(n)) ?? false));
    if (!eSurvives) continue;
    const s = src(file);
    if (!s) continue;
    const fileNodes = context.getNodesByFile(file);
    const eLines = s.split('\n');
    for (const fn of fileNodes) {
      if (!FN_KINDS.has(fn.kind)) continue;
      const body = sliceLinesPre(eLines, fn.startLine, fn.endLine);
      DISPATCH_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      let added = 0;
      let lcIdx = 0;
      let lcLine = fn.startLine;
      const lineAt = (idx: number): number => {
        for (let i = lcIdx; i < idx; i++) if (body.charCodeAt(i) === 10) lcLine++;
        lcIdx = idx;
        return lcLine;
      };
      while ((m = DISPATCH_RE.exec(body)) && added < FANOUT_CAP) {
        const baseChain = m[1]!.replace(/\s*(?:->|\.)\s*$/, '').trim();
        const field = m[2]!;
        const owners = fieldToStructs.get(field);
        if (!owners || owners.size === 0) continue;
        let struct = resolveChainType(body, baseChain);
        if (!struct || !owners.has(struct)) {
          const lastSeg = baseChain.replace(/\s*\[[^\]]*\]/g, '').split(/\s*(?:->|\.)\s*/).pop()!;
          const t = recvTypeIn(body, lastSeg);
          struct = t && owners.has(t) ? t : null;
        }
        if (!struct || !owners.has(struct)) struct = owners.size === 1 ? [...owners][0]! : null;
        if (!struct) continue;
        const targets = reg.get(`${struct}.${field}`);
        if (!targets) continue;
        const line = lineAt(m.index);
        for (const tid of targets) {
          if (tid === fn.id) continue;
          const key = `${fn.id}>${tid}`;
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push({
            source: fn.id,
            target: tid,
            kind: 'calls',
            line,
            provenance: 'heuristic',
            metadata: {
              synthesizedBy: 'fn-pointer-dispatch',
              via: `${struct}.${field}`,
              registeredAt: `${fn.filePath}:${line}`,
            },
          });
          if (++added >= FANOUT_CAP) break;
        }
      }

      if (arrayReg.size && added < FANOUT_CAP) {
        lcIdx = 0;
        lcLine = fn.startLine;
        ARRAY_DISPATCH_RE.lastIndex = 0;
        while ((m = ARRAY_DISPATCH_RE.exec(body)) && added < FANOUT_CAP) {
          const entries = arrayReg.get(m[1]!);
          if (!entries) continue;
          const ids = entries.length === 1
            ? entries[0]!.ids
            : (entries.find((e) => e.file === fn.filePath)?.ids ?? null);
          if (!ids) continue;
          const line = lineAt(m.index);
          for (const tid of ids) {
            if (tid === fn.id) continue;
            const key = `${fn.id}>${tid}`;
            if (seen.has(key)) continue;
            seen.add(key);
            edges.push({
              source: fn.id,
              target: tid,
              kind: 'calls',
              line,
              provenance: 'heuristic',
              metadata: {
                synthesizedBy: 'fn-pointer-dispatch',
                via: `${m[1]}[]`,
                registeredAt: `${fn.filePath}:${line}`,
              },
            });
            if (++added >= FANOUT_CAP) break;
          }
        }
      }
    }
  }

  return edges;
}
