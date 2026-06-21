import * as fs from "fs/promises"
import * as path from "path"
import type { PlanSerialized } from "./Plan"
import { Plan } from "./Plan"
import { PlanError, errorMessage } from "../core/errors"

/**
 * Репозиторий для сохранения и загрузки планов.
 *
 * Выносит файловый ввод-вывод из доменного класса Plan,
 * чтобы Plan не зависел от fs напрямую (SRP, DIP).
 */
export class PlanRepository {
  constructor(private readonly workspaceDir: string) {}

  /**
   * Сохранить план в файл.
   */
  async save(plan: Plan): Promise<string> {
    const planDir = path.join(this.workspaceDir, ".neuraltower", "plans")
    await fs.mkdir(planDir, { recursive: true })
    const safeId = path.basename(plan.id)
    const filePath = path.join(planDir, `${safeId}.json`)
    await fs.writeFile(filePath, JSON.stringify(plan.toJSON(), null, 2), "utf-8")
    return filePath
  }

  /**
   * Загрузить план из файла.
   */
  async load(filePath: string): Promise<Plan> {
    const raw = await fs.readFile(filePath, "utf-8")
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch (err: unknown) {
      const msg = errorMessage(err)
      throw new PlanError(`Невалидный файл плана: ${filePath} (${msg})`)
    }

    if (!data || typeof data !== "object" || !Array.isArray((data as any).steps)) {
      throw new PlanError(`Невалидный файл плана: ${filePath}`)
    }

    const plan = Plan.fromJSON(data as PlanSerialized)
    return plan
  }

  /**
   * Найти последний план (по имени файла, сортировка обратная).
   */
  async findLatest(): Promise<string | null> {
    const planDir = path.join(this.workspaceDir, ".neuraltower", "plans")
    try {
      const entries = await fs.readdir(planDir)
      const jsonFiles = entries.filter((e) => e.endsWith(".json")).sort().reverse()
      if (jsonFiles.length === 0) return null
      return path.join(planDir, jsonFiles[0])
    } catch {
      return null
    }
  }
}
