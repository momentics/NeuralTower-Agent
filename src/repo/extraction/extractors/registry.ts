import { IExtractor } from '../ExtractorBase';
import { IExtractionResult } from '../../ntgraph/Types';
import { TypeScriptExtractor } from './TypeScript';
import { PythonExtractor } from './Python';
import { GoExtractor } from './Go';
import { RustExtractor } from './Rust';
import { JavaExtractor } from './Java';
import { CppExtractor } from './Cpp';
import { CSharpExtractor } from './CSharp';
import { KotlinExtractor } from './Kotlin';
import { SwiftExtractor } from './Swift';
import { PhpExtractor } from './Php';
import { RubyExtractor } from './Ruby';
import { VueExtractor } from './Vue';
import { SvelteExtractor } from './Svelte';
import { AstroExtractor } from './Astro';
import { DefaultExtractor } from './Default';

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
  EXTRACTOR_MAP.set('kotlin', new KotlinExtractor());
  EXTRACTOR_MAP.set('swift', new SwiftExtractor());
  EXTRACTOR_MAP.set('php', new PhpExtractor());
  EXTRACTOR_MAP.set('ruby', new RubyExtractor());
  EXTRACTOR_MAP.set('vue', new VueExtractor());
  EXTRACTOR_MAP.set('svelte', new SvelteExtractor());
  EXTRACTOR_MAP.set('astro', new AstroExtractor());
  EXTRACTOR_MAP.set('default', new DefaultExtractor());
}

export function getExtractor(language: string): IExtractor {
  ensureExtractors();
  return EXTRACTOR_MAP.get(language) ?? EXTRACTOR_MAP.get('default')!;
}

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
