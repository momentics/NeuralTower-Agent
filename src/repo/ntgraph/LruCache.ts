/**
 * LRU-кэш с ограниченным размером.
 *
 * Использует Map для отслеживания порядка доступа.
 * При превышении лимита старейший элемент удаляется.
 */

/** LRU-кэш с ограниченным размером. */
export class LRUCache<K, V> {
  private readonly max: number;
  private readonly store: Map<K, V>;

  /**
   * Создаёт LRU-кэш.
   * @param max — максимальное количество элементов (должно быть > 0).
   */
  constructor(max: number) {
    if (max <= 0) {
      throw new Error('Размер кэша должен быть больше 0');
    }
    this.max = max;
    this.store = new Map();
  }

  /** Текущее количество элементов в кэше. */
  get size(): number {
    return this.store.size;
  }

  /**
   * Получает значение по ключу. При попадании элемент перемещается в конец (свежий).
   * Различает «отсутствует» и «хранимый undefined» через has().
   * @returns значение или undefined, если ключ отсутствует.
   */
  get(key: K): V | undefined {
    const value = this.store.get(key);
    if (value === undefined) {
      // Различаем «отсутствует» и «хранимый undefined»
      return this.store.has(key) ? value : undefined;
    }
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  /** Проверяет наличие ключа в кэше. */
  has(key: K): boolean {
    return this.store.has(key);
  }

  /**
   * Устанавливает значение по ключу. При превышении лимита старейший элемент удаляется.
   */
  set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.max) {
      // Удаляем старейший элемент (первый в Map)
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, value);
  }

  /** Удаляет элемент по ключу. */
  delete(key: K): boolean {
    return this.store.delete(key);
  }

  /** Очищает кэш. */
  clear(): void {
    this.store.clear();
  }
}
