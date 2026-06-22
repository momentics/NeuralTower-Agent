import type { IBackend, IChatMessage } from "../core/IBackend"
import { estimateTokens } from "../core/TokenUtils"
import { loadDefaultCompactorConfig, type ICompactorConfig } from "../core/Config"
import { createDomainLogger } from "../core/Logger"
import { errorMessage } from "../core/Errors"

const log = createDomainLogger("Compactor")

const FALLBACK_SUMMARY_MAX_CHARS = 500

/**
 * Настройки сжатия контекста — алиас для ICompactorConfig.
 */
export type CompactorOptions = ICompactorConfig

/**
 * Настройки по умолчанию для сжатия контекста.
 */
const DEFAULT_OPTIONS: CompactorOptions = loadDefaultCompactorConfig()

/**
 * Шаблон для структурированной сводки при сжатии истории.
 */
const SUMMARY_TEMPLATE = `Сожми историю разговора в структурированную сводку.

Выполни точно структуру внутри <template>:

<template>
## Цель
{основная цель задачи}

## Ограничения и предпочтения
{технические ограничения, требования к стилю и т.д.}

## Прогресс
- Выполнено: {список завершённых действий}
- В процессе: {что сейчас делается}
- Заблокировано: {проблемы, которые требуют внимания}

## Ключевые решения
{архитектурные и технические решения, которые были приняты}

## Следующие шаги
{что нужно сделать дальше}

## Критический контекст
{важная информация, которую нужно сохранить}

## Релевантные файлы
{список файлов с кратким описанием роли каждого}
</template>

Ответь ТОЛЬКО содержимым шаблона, без дополнительных слов.`

/**
 * Результат сжатия контекста.
 */
export interface ICompactionResult {
  /** Нужно ли выполнять сжатие. */
  needsCompaction: boolean

  /** Сжатая история (если сжатие выполнено). */
  compactedHistory?: IChatMessage[]

  /** Текст сводки. */
  summary?: string

  /** Оценка токенов до сжатия. */
  tokensBefore: number

  /** Оценка токенов после сжатия. */
  tokensAfter: number
}

/**
 * Compactor управляет сжатием контекста разговора при приближении
 * к лимиту контекстного окна модели.
 *
 * Алгоритм сжатия:
* 1. Оценивает токены всей истории
 * 2. Если tokens > contextLimit - buffer, запускает сжатие
 * 3. Делит историю на head (старые) и recent (новые keepTokens)
 * 4. Просит LLM создать структурированную сводку head
 * 5. Возвращает [system, summary, ...recent]
 */
export class Compactor {
  private options: CompactorOptions

  constructor(
    private readonly backend: IBackend | null,
    options?: Partial<CompactorOptions>,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Обновить настройки.
   */
  setOptions(partial: Partial<CompactorOptions>): void {
    this.options = { ...this.options, ...partial }
  }

  /**
   * Проверить, нужно ли сжатие, и выполнить при необходимости.
   */
  async compactIfNeeded(
    messages: IChatMessage[],
    systemPrompt: string,
  ): Promise<ICompactionResult> {
    const tokensBefore = estimateConversationTokens(messages, systemPrompt)
    const threshold = this.options.contextLimit - this.options.bufferTokens

    if (tokensBefore < threshold) {
      return {
        needsCompaction: false,
        tokensBefore,
        tokensAfter: tokensBefore,
      }
    }

    return await this.compact(messages, systemPrompt)
  }

  /**
   * Выполнить сжатие явно.
   */
  async compact(
    messages: IChatMessage[],
    systemPrompt: string,
  ): Promise<ICompactionResult> {
    const tokensBefore = estimateConversationTokens(messages, systemPrompt)

    const { head, recent } = this.splitMessages(messages)

    if (head.length === 0) {
      return {
        needsCompaction: true,
        tokensBefore,
        tokensAfter: tokensBefore,
      }
    }

    const summary = await this.summarize(head)

    const compacted: IChatMessage[] = [
      { role: "user", content: summary, timestamp: Date.now() },
      ...recent,
    ]

    const tokensAfter = estimateConversationTokens(compacted, systemPrompt)

    return {
      needsCompaction: true,
      compactedHistory: compacted,
      summary,
      tokensBefore,
      tokensAfter,
    }
  }

  private splitMessages(messages: IChatMessage[]): {
    head: IChatMessage[]
    recent: IChatMessage[]
  } {
    let recentTokens = 0
    let splitIndex = 0

    for (let i = messages.length - 1; i >= 0; i--) {
      const msgTokens = estimateMessageTokens(messages[i])
      if (recentTokens + msgTokens > this.options.keepTokens) {
        if (recentTokens > 0) {
          splitIndex = i + 1
          break
        }
      }
      recentTokens += msgTokens
      splitIndex = i
    }

    return {
      head: messages.slice(0, splitIndex),
      recent: messages.slice(splitIndex),
    }
  }

  private async summarize(messages: IChatMessage[]): Promise<string> {
    if (!this.backend) {
      return this.fallbackSummary(messages)
    }

    const truncated = messages.map((m) => ({
      ...m,
      content:
        m.content.length > this.options.maxToolOutputChars
          ? m.content.slice(0, this.options.maxToolOutputChars) + "..."
          : m.content,
    }))

    try {
      const summary = await this.backend.chatJson<{ summary: string }>([
        { role: "system", content: SUMMARY_TEMPLATE, timestamp: Date.now() },
        ...truncated,
        {
          role: "user",
          content: "Сожми историю выше в структурированную сводку.",
          timestamp: Date.now(),
        },
      ])
      return summary.summary || this.fallbackSummary(messages)
    } catch (err: unknown) {
      const msg = errorMessage(err)
      log.error(`Компактизация не выполнена: ${msg}`)
      return this.fallbackSummary(messages)
    }
  }

  private fallbackSummary(messages: IChatMessage[]): string {
    const userMsgs = messages.filter((m) => m.role === "user")
    const lastUser = userMsgs[userMsgs.length - 1]
    return `## Цель\n${lastUser?.content.slice(0, FALLBACK_SUMMARY_MAX_CHARS) ?? "Неизвестно"}\n\n## Прогресс\nОбработано ${messages.length} сообщений. Контекст сжат.`
  }
}

// ── Утилиты ───────────────────────────────────────────────

function estimateMessageTokens(message: IChatMessage): number {
  return estimateTokens(message.content)
}

function estimateConversationTokens(
  messages: IChatMessage[],
  systemPrompt: string,
): number {
  let total = estimateTokens(systemPrompt)
  for (const msg of messages) {
    total += estimateMessageTokens(msg)
  }
  return total
}
