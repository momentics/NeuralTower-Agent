/**
 * Асинхронный мютекс для предотвращения параллельных гонок чтения-модификации-записи.
 */
export class Mutex {
  private promise: Promise<void> = Promise.resolve()

  acquire(): Promise<() => void> {
    let releaseResolve: () => void
    const prev = this.promise
    this.promise = new Promise((resolve) => { releaseResolve = resolve })
    return prev.then(() => () => { releaseResolve!() })
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }
}
