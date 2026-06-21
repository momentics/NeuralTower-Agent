import * as fs from "fs/promises"
import * as path from "path"
import type { ContextProvider, ContextItem } from "./types"
import { errorMessage } from "../../errors"

const CONTEXT_TREE_MAX_DEPTH = 4

async function buildTree(
  root: string,
  current: string,
  prefix: string,
  isLast: boolean,
  depth: number,
  maxDepth = CONTEXT_TREE_MAX_DEPTH,
): Promise<string> {
  if (depth > maxDepth) return `${prefix}${isLast ? "" : ""}...\n`

  let result = ""
  let entries: { name: string; isDirectory(): boolean }[]
  try {
    entries = await fs.readdir(current, { withFileTypes: true })
  } catch (err: unknown) {
    if (current === root) throw err
    entries = []
  }
  const dirs: { name: string; full: string }[] = []
  const files: { name: string; full: string }[] = []

  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue
    const full = path.join(current, e.name)
    if (e.isDirectory()) dirs.push({ name: e.name, full })
    else files.push({ name: e.name, full })
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))

  const all = [...dirs.map((d) => ({ ...d, isDir: true as const })), ...files.map((f) => ({ ...f, isDir: false as const }))]

  for (let i = 0; i < all.length; i++) {
    const item = all[i]
    const last = i === all.length - 1
    const branch = last ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 "
    const childPrefix = prefix + (last ? "     " : "    |")

    if (item.isDir) {
      result += `${prefix}${branch}${item.name}/\n`
      if (depth < maxDepth) {
        result += await buildTree(root, item.full, childPrefix, last, depth + 1, maxDepth)
      }
    } else {
      result += `${prefix}${branch}${item.name}\n`
    }
  }

  return result
}

export function makeTreeProvider(
  getWorkDir: () => string,
): ContextProvider {
  return {
    description: {
      name: "tree",
      displayTitle: "Дерево",
      description: "Дерево директорий проекта",
      type: "query",
    },
    async resolve(query: string): Promise<ContextItem[]> {
      const targetDir = query.trim()
        ? (path.isAbsolute(query.trim()) ? query.trim() : path.join(getWorkDir(), query.trim()))
        : getWorkDir()

      try {
        const lines = await buildTree(targetDir, targetDir, "", true, 0)
        return [{
          content: `Дерево: ${targetDir}\n\n${lines}`,
          name: `Tree: ${path.basename(targetDir) || targetDir}`,
          description: `${lines.split("\n").length} строк`,
        }]
      } catch (err: unknown) {
        const msg = errorMessage(err)
        return [{ content: `Не удалось построить дерево для ${targetDir}: ${msg}`, name: "tree", description: "error" }]
      }
    },
  }
}
