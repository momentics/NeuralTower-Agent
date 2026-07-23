/**
 * Тесты LRUCache — обработка undefined.
 */

import { describe, it, expect } from 'vitest';
import { LRUCache } from './LruCache';

describe('LRUCache', () => {
  it('distinguishes missing key from stored undefined', () => {
    const cache = new LRUCache<string, string | undefined>(10);

    // Ключ отсутствует — get возвращает undefined, has — false
    expect(cache.get('missing')).toBeUndefined();
    expect(cache.has('missing')).toBe(false);

    // Храним undefined — get возвращает undefined, но has — true
    cache.set('key', undefined as any);
    expect(cache.get('key')).toBeUndefined();
    expect(cache.has('key')).toBe(true);
  });

  it('evicts oldest entry when capacity exceeded', () => {
    const cache = new LRUCache<number, string>(3);

    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.set(3, 'c');

    // Кэш полон, добавляем 4-й — старейший (1) вытесняется
    cache.set(4, 'd');
    expect(cache.has(1)).toBe(false);
    expect(cache.get(2)).toBe('b');
    expect(cache.get(3)).toBe('c');
    expect(cache.get(4)).toBe('d');
  });

  it('refreshes recency on get', () => {
    const cache = new LRUCache<number, string>(3);

    cache.set(1, 'a');
    cache.set(2, 'b');
    // Доступ к 1 — делает его свежим
    cache.get(1);
    cache.set(3, 'c');

    // Теперь 2 — старейший, вытесняется
    cache.set(5, 'e');
    expect(cache.has(2)).toBe(false);
    expect(cache.has(1)).toBe(true);
  });
});
