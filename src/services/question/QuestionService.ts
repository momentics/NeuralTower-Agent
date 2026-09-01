/**
 * Сервис уточняющих вопросов: агент задаёт вопрос пользователю
 * и ждёт ответа (через UI чата).
 */
export interface IQuestionService {
  /**
   * Задать вопрос и дождаться ответа.
   * @returns ответ пользователя или null (таймаут / отмена / UI недоступен)
   */
  ask(question: string, options: string[], signal?: AbortSignal): Promise<string | null>
}

/**
 * Держатель реализации сервиса вопросов.
 *
 * Инструмент `question` создаётся до появления UI чата; реализация
 * привязывается, когда создаётся обработчик webview (и отвязывается
 * при его уничтожении). Без привязанной реализации вопрос считается
 * недоступным.
 */
export class QuestionServiceHolder implements IQuestionService {
  private impl: IQuestionService | null = null

  setImpl(impl: IQuestionService | null): void {
    this.impl = impl
  }

  get isAvailable(): boolean {
    return this.impl !== null
  }

  async ask(question: string, options: string[], signal?: AbortSignal): Promise<string | null> {
    if (!this.impl) return null
    return this.impl.ask(question, options, signal)
  }
}
