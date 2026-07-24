/**
 * Резолвер моста Swift-Objective-C.
 *
 * Обеспечивает разрешение кросс-языковых ссылок между Swift и Objective-C:
 * - Swift → ObjC: сопоставление селекторов (playWithSong:)
 * - ObjC → Swift: @selector ссылки на методы Swift
 * - Переименование свойств (camelCase с префиксом ключевого слова)
 * - Сопоставление типов (Swift → ObjC)
 */

import type {
  IFrameworkResolver,
  IUnresolvedReference,
  IResolvedRef,
  IResolutionContext,
  INode,
  Language,
} from '../ntgraph/Types';
import { registerFrameworkResolver } from './Frameworks';

// =============================================================================
// Сопоставление типов Swift → ObjC
// =============================================================================

/** Сопоставление типов Swift к ObjC. */
const SWIFT_TO_OBJC_TYPE: ReadonlyMap<string, string> = new Map([
  ['Int', 'NSInteger'],
  ['UInt', 'NSUInteger'],
  ['Float', 'float'],
  ['Double', 'double'],
  ['Bool', 'BOOL'],
  ['String', 'NSString'],
  ['Data', 'NSData'],
  ['Date', 'NSDate'],
  ['URL', 'NSURL'],
  ['Array', 'NSArray'],
  ['Dictionary', 'NSDictionary'],
  ['Set', 'NSSet'],
  ['Any', 'id'],
  ['AnyObject', 'id'],
  ['Optional', 'nullable'],
  ['Void', 'void'],
]);

// =============================================================================
// Построение селекторов ObjC из сигнатур Swift
// =============================================================================

/**
 * Разбирает сигнатуру метода Swift и извлекает имя и параметры.
 * Пример: "play(song: String)" → { name: "play", params: [{ label: "song", type: "String" }] }
 */
function parseSwiftMethodSignature(signature: string): {
  name: string;
  params: Array<{ label: string; type: string }>;
} {
  const match = signature.match(/^(\w+)\((.*)\)$/);
  if (!match) {
    return { name: signature, params: [] };
  }

  const name = match[1];
  const paramsStr = match[2].trim();
  const params: Array<{ label: string; type: string }> = [];

  if (paramsStr) {
    const parts = paramsStr.split(',');
    for (const part of parts) {
      const trimmed = part.trim();
      const pm = trimmed.match(/^(\w+):\s*(.+)$/);
      if (pm) {
        params.push({ label: pm[1], type: pm[2].trim() });
      }
    }
  }

  return { name, params };
}

/**
 * Генерирует селектор ObjC из Swift-метода.
 * - play(song: String) → playWithSong:
 * - play() → play
 * - insert(item: Item, at: Index) → insertItem:at:
 */
function swiftToObjCSelector(
  name: string,
  params: Array<{ label: string; type: string }>
): string {
  if (params.length === 0) {
    return name;
  }

  let selector = name;
  for (const param of params) {
    const label = param.label;
    if (label === '_') {
      // Подчёркивание означает отсутствие ключевого слова в селекторе
      selector += ':';
    } else {
      const capitalized = label.charAt(0).toUpperCase() + label.slice(1);
      selector += capitalized + ':';
    }
  }

  return selector;
}

/**
 * Извлекает имя Swift-метода из селектора ObjC.
 * - playWithSong: → { name: "play", labels: ["song"] }
 * - insertItem:at: → { name: "insert", labels: ["item", "at"] }
 */
function objcSelectorToSwift(selector: string): {
  name: string;
  labels: string[];
} {
  const parts = selector.split(':');
  if (parts.length === 1) {
    return { name: parts[0], labels: [] };
  }

  const withIndex = parts[0].indexOf('With');
  if (withIndex !== -1) {
    const baseName = parts[0].slice(0, withIndex);
    const firstLabel = parts[0].slice(withIndex + 4).toLowerCase();
    const labelList: string[] = [firstLabel];

    for (let i = 1; i < parts.length; i++) {
      if (parts[i]) {
        labelList.push(parts[i]);
      }
    }

    return { name: baseName, labels: labelList };
  }

  return { name: parts[0], labels: [] };
}

// =============================================================================
// Класс резолвера
// =============================================================================

/**
 * Резолвер моста Swift-Objective-C.
 *
 * Разрешает кросс-языковые ссылки между Swift и Objective-C,
 * сопоставляя селекторы, имена методов и типы.
 */
export class SwiftObjcBridge implements IFrameworkResolver {
  public readonly name = 'swift-objc-bridge';
  public readonly languages: Language[] = ['swift', 'objc'];

  /**
   * Возвращает true, если проект содержит файлы .swift и .m/.mm.
   */
  detect(context: IResolutionContext): boolean {
    const files = context.getAllFiles();
    const hasSwift = files.some((f) => f.endsWith('.swift'));
    const hasObjC = files.some((f) => f.endsWith('.m') || f.endsWith('.mm'));
    return hasSwift && hasObjC;
  }

  /**
   * Разрешение кросс-языковых ссылок Swift ↔ ObjC.
   */
  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const lang = ref.language;
    if (!lang) return null;

    if (lang === 'swift') {
      return this.resolveSwiftToObjC(ref, context);
    }

    if (lang === 'objc') {
      return this.resolveObjCToSwift(ref, context);
    }

    return null;
  }

  /**
   * Заявляет ссылки на селекторы ObjC (с двоеточием) и @selector(...).
   */
  claimsReference(name: string): boolean {
    if (name.includes(':')) {
      return true;
    }

    if (name.startsWith('@selector')) {
      return true;
    }

    return false;
  }

  // ===================================================================
  // Swift → ObjC
  // ===================================================================

  /**
   * Разрешение ссылки из Swift на метод ObjC.
   *
   * Связывает Swift-метод с его ObjC-аналогом по селектору.
   */
  private resolveSwiftToObjC(
    ref: IUnresolvedReference,
    context: IResolutionContext
  ): IResolvedRef | null {
    const refName = ref.referenceName;

    // Поиск метода ObjC по имени Swift
    const swiftNodes = context.getNodesByName(refName).filter(
      (n) => n.language === 'swift' && (n.kind === 'method' || n.kind === 'function')
    );

    for (const swiftNode of swiftNodes) {
      if (swiftNode.signature) {
        const sig = parseSwiftMethodSignature(swiftNode.name);
        const selector = swiftToObjCSelector(sig.name, sig.params);

        // Ищем метод ObjC с таким селектором
        const objcMatches = context.getNodesByName(selector).filter(
          (n) => n.language === 'objc' && n.kind === 'method'
        );

        if (objcMatches.length === 1) {
          return {
            original: ref,
            targetNodeId: objcMatches[0]!.id,
            confidence: 0.9,
            provenance: 'swift-objc-bridge',
          };
        }

        if (objcMatches.length > 1) {
          return {
            original: ref,
            targetNodeId: objcMatches[0]!.id,
            confidence: 0.5,
            provenance: 'swift-objc-bridge',
          };
        }
      }

      // Прямое сопоставление по имени
      const directMatches = context.getNodesByName(refName).filter(
        (n) => n.language === 'objc' && (n.kind === 'method' || n.kind === 'function')
      );

      if (directMatches.length === 1) {
        return {
          original: ref,
          targetNodeId: directMatches[0]!.id,
          confidence: 0.7,
          provenance: 'swift-objc-bridge',
        };
      }
    }

    // Поиск по селектору (если ссылка содержит двоеточие)
    if (refName.includes(':')) {
      const objcMatches = context.getNodesByName(refName).filter(
        (n) => n.language === 'objc' && n.kind === 'method'
      );

      if (objcMatches.length === 1) {
        return {
          original: ref,
          targetNodeId: objcMatches[0]!.id,
          confidence: 0.95,
          provenance: 'swift-objc-bridge',
        };
      }
    }

    // Сопоставление по типу
    const typeMatch = SWIFT_TO_OBJC_TYPE.get(refName);
    if (typeMatch) {
      const typeNodes = context.getNodesByName(typeMatch).filter(
        (n) => n.language === 'objc'
      );

      if (typeNodes.length === 1) {
        return {
          original: ref,
          targetNodeId: typeNodes[0]!.id,
          confidence: 0.8,
          provenance: 'swift-objc-bridge',
        };
      }
    }

    return null;
  }

  // ===================================================================
  // ObjC → Swift
  // ===================================================================

  /**
   * Разрешение ссылки из ObjC на метод Swift.
   *
   * Связывает селектор ObjC или @selector с методом Swift.
   */
  private resolveObjCToSwift(
    ref: IUnresolvedReference,
    context: IResolutionContext
  ): IResolvedRef | null {
    const refName = ref.referenceName;

    // Обработка @selector(...)
    const selectorMatch = refName.match(/@selector\(([^)]+)\)/);
    if (selectorMatch) {
      const selector = selectorMatch[1];
      return this.resolveSelectorToSwift(selector, ref, context);
    }

    // Селектор ObjC (содержит двоеточие)
    if (refName.includes(':')) {
      return this.resolveSelectorToSwift(refName, ref, context);
    }

    // Прямое сопоставление по имени
    const directSwift = context.getNodesByName(refName).filter(
      (n) => n.language === 'swift' && (n.kind === 'method' || n.kind === 'function')
    );

    if (directSwift.length === 1) {
      return {
        original: ref,
        targetNodeId: directSwift[0]!.id,
        confidence: 0.8,
        provenance: 'swift-objc-bridge',
      };
    }

    return null;
  }

  /**
   * Разрешение селектора ObjC на метод Swift.
   */
  private resolveSelectorToSwift(
    selector: string,
    ref: IUnresolvedReference,
    context: IResolutionContext
  ): IResolvedRef | null {
    // Ищем точное совпадение селектора
    const exactNodes = context.getNodesByName(selector).filter(
      (n) => n.language === 'swift' && (n.kind === 'method' || n.kind === 'function')
    );

    if (exactNodes.length === 1) {
      return {
        original: ref,
        targetNodeId: exactNodes[0]!.id,
        confidence: 0.95,
        provenance: 'swift-objc-bridge',
      };
    }

    // Разбираем селектор и ищем по имени Swift
    const parsed = objcSelectorToSwift(selector);

    if (parsed.name) {
      const swiftMatches = context.getNodesByName(parsed.name).filter(
        (n) => n.language === 'swift' && (n.kind === 'method' || n.kind === 'function')
      );

      if (swiftMatches.length === 1) {
        return {
          original: ref,
          targetNodeId: swiftMatches[0]!.id,
          confidence: 0.85,
          provenance: 'swift-objc-bridge',
        };
      }

      if (swiftMatches.length > 1) {
        // Пытаемся уточнить по меткам параметров
        for (const node of swiftMatches) {
          if (node.signature) {
            const sig = parseSwiftMethodSignature(node.name);
            const paramLabels = sig.params
              .map((p) => (p.label === '_' ? '' : p.label))
              .join('');

            const selectorLabels = parsed.labels.join('');
            if (paramLabels === selectorLabels) {
              return {
                original: ref,
                targetNodeId: node.id,
                confidence: 0.95,
                provenance: 'swift-objc-bridge',
              };
            }
          }
        }

        // Возвращаем первый с пониженным доверием
        return {
          original: ref,
          targetNodeId: swiftMatches[0]!.id,
          confidence: 0.5,
          provenance: 'swift-objc-bridge',
        };
      }
    }

    return null;
  }
}

registerFrameworkResolver(new SwiftObjcBridge());
