/**
 * Определение Go-модуля.
 *
 * Чтение go.mod для определения пути модуля.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface GoModule {
  /** Путь модуля из go.mod. */
  modulePath: string;
  /** Абсолютный путь к директории с go.mod. */
  rootDir: string;
}

/**
 * Чтение go.mod из корня проекта.
 */
export function loadGoModule(projectRoot: string): GoModule | null {
  const goModPath = path.join(projectRoot, 'go.mod');
  let content: string;
  try {
    content = fs.readFileSync(goModPath, 'utf-8');
  } catch {
    return null;
  }
  const stripped = content.replace(/\/\/[^\n]*/g, '');
  const match = stripped.match(/^\s*module\s+(\S+)\s*$/m);
  if (!match) return null;
  const modulePath = match[1]!.replace(/^["']|["']$/g, '');
  if (!modulePath) return null;
  return { modulePath, rootDir: projectRoot };
}
