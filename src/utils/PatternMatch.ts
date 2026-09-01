/**
 * Соответствие паттернов для правил разрешений:
 * паттерны команд (префикс с опциональным хвостом *) и
 * паттерны путей файлов (glob с **).
 */

/**
 * Соответить команду оболочки паттерну.
 *
 * Паттерн — префикс команды: "git status" совпадает с "git status"
 * и "git status --short"; "git *" совпадает с любой командой,
 * начинающейся с "git" (включая саму "git").
 */
export function matchCommandPattern(pattern: string, command: string): boolean {
  const p = pattern.trim()
  const c = command.trim()
  if (!p || !c) return false

  if (p.endsWith("*")) {
    const prefix = p.slice(0, -1).trimEnd()
    if (!prefix) return true
    return c === prefix || c.startsWith(prefix + " ")
  }
  return c === p || c.startsWith(p + " ")
}

/**
 * Соответить путь к файлу glob-паттерну.
 *
 * Поддерживаются: * (в пределах сегмента), ** (через сегменты),
 * ? (один символ). Паттерн сопоставляется с относительным путём
 * через прямые слэши. Примеры: "src/**" + "*.ts" совпадает
 * с "src/a/b.ts"; ".env*" — с ".env.local".
 */
export function matchPathPattern(pattern: string, filePath: string): boolean {
  const p = pattern.trim().replace(/\\/g, "/")
  const f = filePath.replace(/\\/g, "/").replace(/^\.\//, "")
  if (!p || !f) return false
  return globToRegex(p).test(f)
}

/** Преобразовать glob-паттерн в регулярное выражение. */
function globToRegex(glob: string): RegExp {
  let out = ""
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*"
        i++
        if (glob[i + 1] === "/") i++
      } else {
        out += "[^/]*"
      }
    } else if (ch === "?") {
      out += "[^/]"
    } else if (".+^${}()|[]\\".includes(ch)) {
      out += `\\${ch}`
    } else {
      out += ch
    }
  }
  return new RegExp(`^${out}$`)
}
