import * as fs from "fs/promises"
import * as path from "path"
import { Mutex } from "../../shared/Mutex"
import { createDomainLogger } from "../../core/Logger"
import { errorMessage } from "../../core/Errors"

const log = createDomainLogger("Memory")

/** Данные проектной памяти. */
export interface IProjectMemoryData {
  /** Название репозитория. */
  repo: string
  /** Языки проекта. */
  languages: string[]
  /** Команды: имя → команда (build, test и т. п.). */
  commands: Record<string, string>
  /** Архитектурные заметки. */
  notes: string[]
  /** Конвенции и правила проекта. */
  conventions: string[]
  /** Момент последнего обновления, unix ms. */
  updatedAt: number
}

/** Пустые данные памяти. */
export function emptyMemoryData(): IProjectMemoryData {
  return { repo: "", languages: [], commands: {}, notes: [], conventions: [], updatedAt: Date.now() }
}

/**
 * Дисковое хранилище проектной памяти: один JSON-файл на workspace
 * в глобальном хранилище расширения.
 *
 * Запись под мютексом (чтение-модификация-запись). Ошибки чтения
 * не бросаются: повреждённый файл трактуется как отсутствующий,
 * память — вспомогательный компонент.
 */
export class MemoryStore {
  private readonly mutex = new Mutex()

  constructor(private readonly filePath: string) {}

  /** Загрузить память (null, если файла нет или он повреждён). */
  async load(): Promise<IProjectMemoryData | null> {
    return this.read()
  }

  /**
   * Загрузить → изменить → сохранить под мютексом.
   * Ошибки логируются, не бросаются.
   */
  async update(mutator: (data: IProjectMemoryData) => void): Promise<void> {
    try {
      await this.mutex.withLock(async () => {
        const data = (await this.read()) ?? emptyMemoryData()
        mutator(data)
        data.updatedAt = Date.now()
        await this.write(data)
      })
    } catch (err: unknown) {
      log.warn(`Не удалось обновить память проекта: ${errorMessage(err)}`)
    }
  }

  private async read(): Promise<IProjectMemoryData | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8")
      return normalize(JSON.parse(raw) as Partial<IProjectMemoryData>)
    } catch {
      return null
    }
  }

  private async write(data: IProjectMemoryData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf-8")
  }
}

/** Заполнить отсутствующие поля значениями по умолчанию. */
function normalize(data: Partial<IProjectMemoryData>): IProjectMemoryData {
  return {
    repo: typeof data.repo === "string" ? data.repo : "",
    languages: Array.isArray(data.languages) ? data.languages.map(String) : [],
    commands:
      data.commands && typeof data.commands === "object"
        ? Object.fromEntries(
            Object.entries(data.commands).filter(([, v]) => typeof v === "string"),
          )
        : {},
    notes: Array.isArray(data.notes) ? data.notes.map(String) : [],
    conventions: Array.isArray(data.conventions) ? data.conventions.map(String) : [],
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
  }
}
