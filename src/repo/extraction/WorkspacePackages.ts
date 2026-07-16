/**
 * Разрешение импортов в monorepo.
 *
 * Чтение workspaces из package.json и pnpm-workspace.yaml.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface WorkspacePackages {
  /** Имя пакета → директория (относительно projectRoot). */
  byName: Map<string, string>;
  /** Имя пакета → файл входа (относительно projectRoot). */
  entryByName?: Map<string, string>;
}

/**
 * Загрузка пакетов workspace для projectRoot.
 */
export function loadWorkspacePackages(projectRoot: string): WorkspacePackages | null {
  const byName = new Map<string, string>();

  const patterns = readWorkspaceGlobs(projectRoot);
  for (const pattern of patterns) {
    for (const dir of expandWorkspaceGlob(projectRoot, pattern)) {
      const pkgName = readPackageName(path.join(projectRoot, dir));
      if (pkgName && !byName.has(pkgName)) byName.set(pkgName, dir);
    }
  }

  if (byName.size === 0) return null;

  return { byName };
}

/**
 * Разрешение workspace-импорта.
 */
export function resolveWorkspaceImport(
  importPath: string,
  ws: WorkspacePackages
): string | null {
  let bestName: string | null = null;
  for (const name of ws.byName.keys()) {
    if (importPath === name || importPath.startsWith(name + '/')) {
      if (!bestName || name.length > bestName.length) bestName = name;
    }
  }
  if (!bestName) return null;
  const dir = ws.byName.get(bestName)!;
  const subpath = importPath.slice(bestName.length);
  if (!subpath) {
    const entry = ws.entryByName?.get(bestName);
    if (entry) return entry;
  }
  return (dir + subpath).replace(/\/{2,}/g, '/');
}

function readWorkspaceGlobs(projectRoot: string): string[] {
  const out: string[] = [];

  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8')
    );
    const ws = pkg?.workspaces;
    if (Array.isArray(ws)) {
      out.push(...ws.filter((w: unknown): w is string => typeof w === 'string'));
    } else if (ws && Array.isArray(ws.packages)) {
      out.push(...ws.packages.filter((w: unknown): w is string => typeof w === 'string'));
    }
  } catch {
    /* нет / некорректный package.json */
  }

  try {
    const yaml = fs.readFileSync(path.join(projectRoot, 'pnpm-workspace.yaml'), 'utf-8');
    out.push(...parsePnpmPackages(yaml));
  } catch {
    /* нет pnpm-workspace.yaml */
  }

  return out;
}

function parsePnpmPackages(yaml: string): string[] {
  const out: string[] = [];
  const lines = yaml.split(/\r?\n/);
  let inPackages = false;
  for (const line of lines) {
    if (/^\s*packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const item = line.match(/^\s*-\s*(.+?)\s*$/);
      if (item) {
        out.push(item[1]!.replace(/^['"]|['"]$/g, ''));
        continue;
      }
      if (line.trim() !== '' && !/^\s/.test(line)) inPackages = false;
    }
  }
  return out;
}

function expandWorkspaceGlob(projectRoot: string, pattern: string): string[] {
  const norm = pattern.replace(/\\/g, '/').replace(/\/+$/, '');
  const star = norm.indexOf('*');
  if (star === -1) return [norm];

  const base = norm.slice(0, star).replace(/\/+$/, '');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(projectRoot, base), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
    out.push(base ? `${base}/${e.name}` : e.name);
  }
  return out;
}

function readPackageName(dirAbs: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dirAbs, 'package.json'), 'utf-8'));
    return typeof pkg?.name === 'string' && pkg.name ? pkg.name : null;
  } catch {
    return null;
  }
}
