/**
 * Фреймворк-резолвер для Rust Cargo workspace (monorepo).
 *
 * postExtract создаёт module-узел для каждого crate'а workspace
 * (имя пакета из Cargo.toml) — per-file extract() этого не видит,
 * поскольку имя пакета и структура workspace описаны в соседних файлах.
 */

import type {
  IFrameworkResolver,
  IUnresolvedReference,
  IResolvedRef,
  IResolutionContext,
  INode,
  Language,
} from '../../ntgraph/Types';
import { NodeKind } from '../../ntgraph/Types';
import { registerFrameworkResolver } from '../Frameworks';
import * as crypto from 'crypto';

/** Языки, к которым применим резолвер. */
const LANGUAGES: Language[] = ['rust'];

function sha256hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Обнаружение Cargo workspace: корневой Cargo.toml с секцией [workspace]. */
function detectCargoWorkspace(context: IResolutionContext): boolean {
  const allFiles = context.getAllFiles();
  const rootCargo = allFiles.find((f) => f === 'Cargo.toml');
  if (!rootCargo) return false;
  const content = context.getFileContent(rootCargo);
  return !!content && /\[workspace\]/.test(content);
}

/** Кросс-файловая финализация: module-узел для каждого crate'а. */
function postExtractWorkspace(context: IResolutionContext): INode[] {
  const nodes: INode[] = [];
  const allFiles = context.getAllFiles();
  const cargoFiles = allFiles.filter((f) => f === 'Cargo.toml' || f.endsWith('/Cargo.toml'));
  for (const f of cargoFiles) {
    const content = context.getFileContent(f);
    if (!content) continue;
    const m = content.match(/\[package\][\s\S]*?^name\s*=\s*"([^"]+)"/m);
    if (!m) continue;
    const name = m[1];
    const line = content.slice(0, content.indexOf(m[0])).split('\n').length;
    nodes.push({
      id: sha256hex(`cargo-pkg:${f}:${name}`),
      kind: NodeKind.Module,
      name,
      qualifiedName: name,
      filePath: f,
      language: 'rust',
      startLine: line,
      endLine: line,
      startColumn: 0,
      endColumn: name.length,
      updatedAt: Date.now(),
    });
  }
  return nodes;
}

/** Резолвер Cargo Workspace. */
const cargoWorkspaceResolver: IFrameworkResolver = {
  name: 'Cargo Workspace',
  languages: LANGUAGES,
  detect: detectCargoWorkspace,
  resolve: (_ref: IUnresolvedReference, _context: IResolutionContext): IResolvedRef | null => null,
  postExtract: postExtractWorkspace,
};

registerFrameworkResolver(cargoWorkspaceResolver);
