/**
 * Реестр экстракторов: единый источник правды «язык → экстрактор».
 *
 * Используется и основным потоком (Orchestrator), и воркером парсинга
 * (ParserWorkerEntry через extractFromSource).
 */

import { IExtractor } from '../ExtractorBase';
import { IExtractionResult } from '../../ntgraph/Types';
import { TypeScriptExtractor } from './TypeScript';
import { PythonExtractor } from './Python';
import { GoExtractor } from './Go';
import { RustExtractor } from './Rust';
import { JavaExtractor } from './Java';
import { CppExtractor } from './Cpp';
import { CSharpExtractor } from './CSharp';
import { RazorExtractor } from './Razor';
import { KotlinExtractor } from './Kotlin';
import { SwiftExtractor } from './Swift';
import { VueExtractor } from './Vue';
import { SvelteExtractor } from './Svelte';
import { AstroExtractor } from './Astro';
import { LiquidExtractor } from './Liquid';
import { PhpExtractor } from './Php';
import { RubyExtractor } from './Ruby';
import { CfmlExtractor } from './Cfml';
import { DfmExtractor } from './Dfm';
import { MybatisExtractor } from './Mybatis';
import { DefaultExtractor } from './Default';
import { GenericAstExtractor, YamlExtractor } from './GenericAst';
import { GENERIC_SPECS } from './generic-specs';

const EXTRACTOR_MAP = new Map<string, IExtractor>();

function ensureExtractors(): void {
  if (EXTRACTOR_MAP.size > 0) return;
  EXTRACTOR_MAP.set('typescript', new TypeScriptExtractor());
  EXTRACTOR_MAP.set('javascript', new TypeScriptExtractor());
  EXTRACTOR_MAP.set('tsx', new TypeScriptExtractor());
  EXTRACTOR_MAP.set('jsx', new TypeScriptExtractor());
  EXTRACTOR_MAP.set('python', new PythonExtractor());
  EXTRACTOR_MAP.set('go', new GoExtractor());
  EXTRACTOR_MAP.set('rust', new RustExtractor());
  EXTRACTOR_MAP.set('java', new JavaExtractor());
  EXTRACTOR_MAP.set('cpp', new CppExtractor());
  EXTRACTOR_MAP.set('c', new CppExtractor());
  EXTRACTOR_MAP.set('csharp', new CSharpExtractor());
  EXTRACTOR_MAP.set('razor', new RazorExtractor());
  EXTRACTOR_MAP.set('swift', new SwiftExtractor());
  EXTRACTOR_MAP.set('kotlin', new KotlinExtractor());
  EXTRACTOR_MAP.set('vue', new VueExtractor());
  EXTRACTOR_MAP.set('svelte', new SvelteExtractor());
  EXTRACTOR_MAP.set('astro', new AstroExtractor());
  EXTRACTOR_MAP.set('liquid', new LiquidExtractor());
  EXTRACTOR_MAP.set('php', new PhpExtractor());
  EXTRACTOR_MAP.set('ruby', new RubyExtractor());
  EXTRACTOR_MAP.set('cfml', new CfmlExtractor());
  EXTRACTOR_MAP.set('cfscript', new CfmlExtractor());
  EXTRACTOR_MAP.set('pascal', new DfmExtractor());
  EXTRACTOR_MAP.set('xml', new MybatisExtractor());
  EXTRACTOR_MAP.set('dart', new GenericAstExtractor(GENERIC_SPECS.dart));
  EXTRACTOR_MAP.set('scala', new GenericAstExtractor(GENERIC_SPECS.scala));
  EXTRACTOR_MAP.set('solidity', new GenericAstExtractor(GENERIC_SPECS.solidity));
  EXTRACTOR_MAP.set('lua', new GenericAstExtractor(GENERIC_SPECS.lua));
  EXTRACTOR_MAP.set('luau', new GenericAstExtractor(GENERIC_SPECS.lua));
  EXTRACTOR_MAP.set('objc', new GenericAstExtractor(GENERIC_SPECS.objc));
  EXTRACTOR_MAP.set('elixir', new GenericAstExtractor(GENERIC_SPECS.elixir));
  EXTRACTOR_MAP.set('ocaml', new GenericAstExtractor(GENERIC_SPECS.ocaml));
  EXTRACTOR_MAP.set('rescript', new GenericAstExtractor(GENERIC_SPECS.rescript));
  EXTRACTOR_MAP.set('zig', new GenericAstExtractor(GENERIC_SPECS.zig));
  EXTRACTOR_MAP.set('shell', new GenericAstExtractor(GENERIC_SPECS.shell));
  EXTRACTOR_MAP.set('css', new GenericAstExtractor(GENERIC_SPECS.css));
  EXTRACTOR_MAP.set('json', new GenericAstExtractor(GENERIC_SPECS.json));
  EXTRACTOR_MAP.set('toml', new GenericAstExtractor(GENERIC_SPECS.toml));
  EXTRACTOR_MAP.set('yaml', new YamlExtractor());
  EXTRACTOR_MAP.set('default', new DefaultExtractor());
}

/** Экстрактор для языка (фолбэк — DefaultExtractor). */
export function getExtractor(language: string): IExtractor {
  ensureExtractors();
  return EXTRACTOR_MAP.get(language) ?? EXTRACTOR_MAP.get('default')!;
}

/** Языки, для которых есть выделенный экстрактор (без 'default'). */
export function getSupportedLanguages(): string[] {
  ensureExtractors();
  return [...EXTRACTOR_MAP.keys()].filter((k) => k !== 'default');
}

/** Диспетчер: извлечение через соответствующий экстрактор. */
export function extractFromSource(
  filePath: string,
  content: string,
  language: string,
  frameworkNames?: string[],
): IExtractionResult {
  const extractor = getExtractor(language);
  const start = Date.now();
  const result = extractor.extract(content, filePath, frameworkNames);
  result.durationMs = Date.now() - start;
  return result;
}
