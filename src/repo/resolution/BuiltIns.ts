/**
 * Встроенные символы по языкам.
 *
 * Используется для фильтрации ссылок — встроенные символы не требуют разрешения.
 */

// =============================================================================
// JavaScript / TypeScript
// =============================================================================

/** Встроенные символы JavaScript/TypeScript (27 символов). */
export const JS_BUILT_INS = new Set([
  'console', 'window', 'document', 'Promise', 'Array', 'Object',
  'String', 'Number', 'Boolean', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Date', 'Math', 'JSON', 'RegExp', 'Error', 'TypeError', 'SyntaxError',
  'ReferenceError', 'RangeError', 'parseInt', 'parseFloat', 'setTimeout',
  'setInterval', 'clearTimeout', 'clearInterval',
]);

/** React-хуки (10 хуков). */
export const REACT_HOOKS = new Set([
  'useState', 'useEffect', 'useContext', 'useReducer', 'useMemo',
  'useCallback', 'useRef', 'useImperativeHandle', 'useLayoutEffect',
  'useDebugValue',
]);

// =============================================================================
// Python
// =============================================================================

/** Встроенные символы Python (50+ символов). */
export const PYTHON_BUILT_INS = new Set([
  'print', 'len', 'range', 'list', 'dict', 'set', 'tuple', 'str',
  'int', 'float', 'bool', 'type', 'isinstance', 'issubclass', 'hasattr',
  'getattr', 'setattr', 'delattr', 'super', 'property', 'staticmethod',
  'classmethod', 'enumerate', 'zip', 'map', 'filter', 'sorted', 'reversed',
  'any', 'all', 'min', 'max', 'sum', 'abs', 'round', 'open', 'input',
  'repr', 'id', 'hash', 'callable', 'dir', 'vars', 'locals', 'globals',
]);

/** Встроенные типы Python (10 типов). */
export const PYTHON_BUILT_IN_TYPES = new Set([
  'str', 'int', 'float', 'bool', 'list', 'dict', 'set', 'tuple', 'bytes', 'NoneType',
]);

/** Встроенные методы Python (50+ методов). */
export const PYTHON_BUILT_IN_METHODS = new Set([
  'append', 'extend', 'insert', 'remove', 'pop', 'clear', 'index', 'count',
  'sort', 'reverse', 'copy', 'keys', 'values', 'items', 'get', 'setdefault',
  'update', 'popitem', 'fromkeys', 'add', 'discard', 'difference', 'union',
  'intersection', 'symmetric_difference', 'startswith', 'endswith', 'find',
  'rfind', 'rindex', 'replace', 'split', 'rsplit', 'join',
  'strip', 'lstrip', 'rstrip', 'lower', 'upper', 'capitalize', 'title',
  'swapcase', 'encode', 'decode', 'format', 'center', 'ljust', 'rjust',
  'zfill', 'translate', 'maketrans', 'isalnum', 'isalpha', 'isdigit',
  'islower', 'isupper', 'isspace', 'istitle', 'isnumeric', 'isdecimal',
  'isidentifier', 'isascii', 'casefold', 'expandtabs', 'partition', 'rpartition',
  'splitlines',
]);

// =============================================================================
// Go
// =============================================================================

/** Стандартные пакеты Go (65+ пакетов). */
export const GO_STDLIB_PACKAGES = new Set([
  'fmt', 'os', 'io', 'net', 'http', 'context', 'sync', 'time', 'strings',
  'strconv', 'sort', 'math', 'math/rand', 'math/big', 'encoding/json',
  'encoding/xml', 'encoding/csv', 'encoding/base64', 'encoding/hex',
  'errors', 'log', 'log/slog', 'path', 'path/filepath', 'bytes',
  'bufio', 'regexp', 'reflect', 'unsafe', 'runtime', 'runtime/debug',
  'runtime/pprof', 'debug/elf', 'debug/gosym', 'debug/macho', 'debug/pe',
  'go/ast', 'go/parser', 'go/token', 'go/types', 'go/importer',
  'go/build', 'go/doc', 'go/format', 'go/printer', 'go/scanner',
  'text/template', 'text/tabwriter', 'text/scanner', 'text/csv',
  'database/sql', 'crypto', 'crypto/aes', 'crypto/cipher', 'crypto/des',
  'crypto/dsa', 'crypto/ecdsa', 'crypto/ed25519', 'crypto/elliptic',
  'crypto/hmac', 'crypto/md5', 'crypto/rand', 'crypto/rc4', 'crypto/rsa',
  'crypto/sha1', 'crypto/sha256', 'crypto/sha512', 'crypto/subtle',
  'crypto/tls', 'crypto/x509', 'crypto/x509/pkix', 'compress/gzip',
  'compress/flate', 'compress/zlib', 'compress/lzw', 'compress/bzip2',
  'archive/tar', 'archive/zip', 'hash', 'hash/adler32', 'hash/crc32',
  'hash/crc64', 'hash/fnv', 'hash/maphash', 'unicode', 'unicode/utf8',
  'unicode/utf16', 'image', 'image/color', 'image/draw', 'image/gif',
  'image/jpeg', 'image/png', 'net/url', 'net/http/httptest',
  'net/http/httputil', 'net/textproto', 'net/rpc', 'net/smtp',
  'net/mail', 'mime', 'mime/multipart', 'mime/quotedprintable',
  'testing', 'testing/fstest', 'testing/iotest', 'testing/quick',
  'plugin',
]);

/** Встроенные символы Go (35+ символов). */
export const GO_BUILT_INS = new Set([
  'make', 'new', 'len', 'cap', 'append', 'copy', 'delete', 'close',
  'panic', 'recover', 'print', 'println', 'error', 'string', 'int',
  'int8', 'int16', 'int32', 'int64', 'uint', 'uint8', 'uint16', 'uint32',
  'uint64', 'float32', 'float64', 'complex64', 'complex128', 'bool',
  'byte', 'rune', 'uintptr', 'complex', 'real', 'imag', 'iota',
  'true', 'false', 'nil',
]);

// =============================================================================
// Pascal
// =============================================================================

/** Префиксы модулей Pascal (13 префиксов). */
export const PASCAL_UNIT_PREFIXES = new Set([
  'System', 'SysUtils', 'Classes', 'Graphics', 'Controls', 'Forms',
  'Dialogs', 'StdCtrls', 'ExtCtrls', 'Menus', 'Buttons', 'ComCtrls', 'ExtDlgs',
]);

/** Встроенные символы Pascal (50+ символов). */
export const PASCAL_BUILT_INS = new Set([
  'WriteLn', 'Write', 'ReadLn', 'Read', 'Halt', 'Exit', 'Dispose',
  'GetMem', 'FreeMem', 'New', 'Inc', 'Dec', 'Ord', 'Chr', 'Succ',
  'Pred', 'Round', 'Trunc', 'Floor', 'Ceil', 'Abs', 'Sqr', 'Sqrt',
  'Sin', 'Cos', 'ArcTan', 'Ln', 'Exp', 'Pi', 'Odd', 'High', 'Low',
  'SizeOf', 'Length', 'Copy', 'Delete', 'Insert', 'Pos', 'Concat',
  'Str', 'Val', 'UpCase', 'LowCase', 'Trim', 'TrimLeft', 'TrimRight',
  'AnsiLowerCase', 'AnsiUpperCase', 'AnsiCompareStr', 'AnsiCompareText',
  'SameStr', 'SameText', 'Format', 'FormatFloat', 'IntToStr', 'StrToInt',
  'StrToFloat', 'FloatToStr', 'TryStrToInt', 'TryStrToFloat', 'ChangeFileExt',
  'ExtractFilePath', 'ExtractFileName', 'ExtractFileDir', 'ExtractFileDrive',
  'ExtractFileExt', 'IncludeTrailingPathDelimiter',
  'ExcludeTrailingPathDelimiter', 'DirectoryExists', 'FileExists',
  'FileSearch', 'FileAge', 'FileSetDate', 'RenameFile', 'DeleteFile',
  'ForceDirectories', 'CreateDir', 'RemoveDir', 'GetDir', 'SetDir',
]);

// =============================================================================
// C
// =============================================================================

/** Встроенные символы C (70+ символов). */
export const C_BUILT_INS = new Set([
  'printf', 'fprintf', 'sprintf', 'snprintf', 'scanf', 'fscanf', 'sscanf',
  'puts', 'fputs', 'putchar', 'fputc', 'gets', 'fgets', 'getchar', 'fgetc',
  'malloc', 'calloc', 'realloc', 'free',
  'strlen', 'strcpy', 'strncpy', 'strcat', 'strncat', 'strcmp', 'strncmp',
  'strstr', 'strchr', 'strrchr', 'strtok', 'strspn', 'strcspn', 'strpbrk',
  'atoi', 'atol', 'atof', 'strtol', 'strtoul', 'strtod', 'strtold',
  'fopen', 'fclose', 'fread', 'fwrite', 'fseek', 'ftell', 'rewind',
  'feof', 'ferror', 'clearerr', 'fflush', 'setvbuf', 'setbuf',
  'remove', 'rename', 'tmpfile', 'tmpnam', 'fgetpos', 'fsetpos',
  'perror', 'exit', 'abort', 'atexit', 'system', 'getenv', 'setenv',
  'signal', 'raise', 'time', 'clock', 'difftime', 'strftime', 'localtime',
  'gmtime', 'mktime', 'asctime', 'ctime', 'rand', 'srand', 'qsort', 'bsearch',
  'memcpy', 'memmove', 'memset', 'memcmp', 'offsetof', 'va_start', 'va_arg',
  'va_end', 'va_copy', 'va_list', 'size_t', 'ptrdiff_t', 'intptr_t',
  'uintptr_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t',
  'uint16_t', 'uint32_t', 'uint64_t',
]);

// =============================================================================
// C++
// =============================================================================

/** Встроенные символы C++ (15 символов). */
export const CPP_BUILT_INS = new Set([
  'cout', 'cin', 'cerr', 'clog', 'endl', 'std', 'vector', 'string',
  'map', 'unordered_map', 'set', 'unordered_set', 'pair', 'tuple', 'shared_ptr',
]);

// =============================================================================
// Проверка встроенного символа
// =============================================================================

/**
 * Проверяет, является ли символ встроенным для данного языка.
 */
export function isBuiltInSymbol(name: string, language: string): boolean {
  const lang = language.toLowerCase();

  if (['typescript', 'javascript', 'tsx', 'jsx'].includes(lang)) {
    return JS_BUILT_INS.has(name) || REACT_HOOKS.has(name);
  }

  if (lang === 'python') {
    return (
      PYTHON_BUILT_INS.has(name) ||
      PYTHON_BUILT_IN_TYPES.has(name) ||
      PYTHON_BUILT_IN_METHODS.has(name)
    );
  }

  if (lang === 'go') {
    return GO_BUILT_INS.has(name) || GO_STDLIB_PACKAGES.has(name);
  }

  if (lang === 'pascal') {
    return PASCAL_BUILT_INS.has(name) || PASCAL_UNIT_PREFIXES.has(name);
  }

  if (lang === 'c') {
    return C_BUILT_INS.has(name);
  }

  if (lang === 'cpp') {
    return CPP_BUILT_INS.has(name) || C_BUILT_INS.has(name);
  }

  return false;
}
