import * as fs from "fs/promises"
import * as path from "path"
import { Plan } from "./Plan"
import { createDomainLogger } from "../core/Logger"

const log = createDomainLogger("PlanRepository")

/**
 * Репозиторий для сохранения планов.
 *
 * Выносит файловый ввод-вывод из доменного класса Plan,
 * чтобы Plan не зависел от fs напрямую (SRP, DIP).
 * Файл плана — артефакт наблюдения за статусом: загрузка
 * плана из него запрещена, восстановление идёт только
 * из сообщений сессии.
 */
export class PlanRepository {
  constructor(private readonly workspaceDir: string) {}

  /**
   * Сохранить план в файл.
   */
  async save(plan: Plan): Promise<string> {
    if (!this.workspaceDir) {
      log.warn("План не сохранён: рабочая директория не задана")
      return ""
    }
    const planDir = path.join(this.workspaceDir, ".neuraltower", "plans")
    await fs.mkdir(planDir, { recursive: true })
    const safeId = path.basename(plan.id)
    const filePath = path.join(planDir, `${safeId}.json`)
    await fs.writeFile(filePath, JSON.stringify(plan.toJSON(), null, 2), "utf-8")
    return filePath
  }
}
