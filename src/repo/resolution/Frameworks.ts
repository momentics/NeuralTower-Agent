/**
 * Регистратор фреймворк-резолверов.
 *
 * Управляет фреймворк-специфичными резолверами.
 */

import type { IFrameworkResolver, IResolutionContext } from '../ntgraph/Types';
import type { Language } from '../ntgraph/Types';



/** Все зарегистрированные фреймворк-резолверы */
const FRAMEWORK_RESOLVERS: IFrameworkResolver[] = [];

/** Получить все фреймворк-резолверы */
export function getAllFrameworkResolvers(): IFrameworkResolver[] {
  return FRAMEWORK_RESOLVERS;
}

/** Получить резолвер по имени */
export function getFrameworkResolver(name: string): IFrameworkResolver | undefined {
  return FRAMEWORK_RESOLVERS.find((r) => r.name === name);
}

/**
 * Обнаружение фреймворков по контексту разрешения.
 * Возвращает резолверы, применимые к проекту.
 */
export function detectFrameworks(context: IResolutionContext): IFrameworkResolver[] {
  return FRAMEWORK_RESOLVERS.filter((resolver) => {
    try {
      return resolver.detect(context);
    } catch {
      return false;
    }
  });
}

/**
 * Фильтрация обнаруженных фреймворков по языку.
 * Фреймворки без явного списка языков считаются универсальными.
 */
export function getApplicableFrameworks(
  detected: IFrameworkResolver[],
  language: Language
): IFrameworkResolver[] {
  return detected.filter(
    (fw) => !fw.languages || fw.languages.includes(language)
  );
}

/** Зарегистрировать пользовательский фреймворк-резолвер */
export function registerFrameworkResolver(resolver: IFrameworkResolver): void {
  const index = FRAMEWORK_RESOLVERS.findIndex((r) => r.name === resolver.name);
  if (index !== -1) {
    FRAMEWORK_RESOLVERS.splice(index, 1);
  }
  FRAMEWORK_RESOLVERS.push(resolver);
}
