/**
 * Универсальная обёртка для выполнения асинхронной функции с таймаутом
 * и возможностью отмены через AbortSignal.
 * Переиспользуется UrlFetcher, LspClient, ProcessRunner.
 */
export async function withTimeoutAndSignal<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  label: string = "operation",
  externalSignal?: AbortSignal,
): Promise<T> {
  if (externalSignal?.aborted) {
    throw new Error(`${label}: отменено`)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`${label}: таймаут ${timeoutMs}ms`)), timeoutMs)

  const signals: AbortSignal[] = [controller.signal]
  if (externalSignal) signals.push(externalSignal)
  const combined = AbortSignal.any(signals)

  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        if (combined.aborted) {
          reject(combined.reason ?? new Error(`${label}: отменено`))
          return
        }
        combined.addEventListener("abort", () => {
          reject(combined.reason ?? new Error(`${label}: отменено`))
        }, { once: true })
      }),
    ])
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}
