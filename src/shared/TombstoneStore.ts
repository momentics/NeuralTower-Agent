/**
 * Общий паттерн tombstone для O(1) удаления без перестроения индекса.
 * Переиспользуется InMemoryVectorStore и FullTextSearch.
 *
 * @typeParam T — тип хранимых элементов
 */
export class TombstoneStore<T> {
  protected items: (T | null)[] = []
  protected deleted = new Set<number>()
  private freeSlots: number[] = []

  /**
   * Найти свободный слот для нового элемента.
   * Сначала пытается переиспользовать удалённый слот (O(1) через стек), иначе создаёт новый.
   */
  acquireSlot(): number {
    const idx = this.freeSlots.pop()
    if (idx !== undefined) {
      this.deleted.delete(idx)
      return idx
    }
    const newIdx = this.items.length
    this.items.push(null)
    return newIdx
  }

  /**
   * Поместить элемент в слот.
   */
  put(idx: number, item: T): void {
    this.items[idx] = item
  }

  /**
   * Удалить элемент по индексу (tombstone).
   */
  tombstone(idx: number): void {
    this.items[idx] = null
    this.deleted.add(idx)
    this.freeSlots.push(idx)
  }

  /**
   * Получить элемент по индексу (null если удалён).
   */
  get(idx: number): T | null {
    return this.items[idx]
  }

  /**
   * Проверить, удалён ли элемент по индексу.
   */
  isDeleted(idx: number): boolean {
    return this.deleted.has(idx)
  }

  /**
   * Вернуть массив элементов (с null для удалённых).
   */
  getItems(): (T | null)[] {
    return this.items
  }

  /**
   * Число активных элементов.
   */
  count(): number {
    return this.items.length - this.deleted.size
  }

  /**
   * Очистить хранилище.
   */
  clear(): void {
    this.items = []
    this.deleted.clear()
    this.freeSlots = []
  }

  /**
   * Compaction — сжать хранилище, удалив все tombstone-слоты.
   * Вызывается при превышении порога раздутия.
   * @returns true если compaction был выполнен
   */
  compact(threshold = 0.5): boolean {
    const activeCount = this.count()
    const totalSlots = this.items.length
    if (totalSlots === 0 || activeCount / totalSlots >= 1 - threshold) {
      return false
    }

    const compacted: T[] = []
    for (let i = 0; i < this.items.length; i++) {
      if (!this.deleted.has(i) && this.items[i] !== null) {
        compacted.push(this.items[i]!)
      }
    }

    this.items = compacted
    this.deleted.clear()
    this.freeSlots = []
    return true
  }
}
