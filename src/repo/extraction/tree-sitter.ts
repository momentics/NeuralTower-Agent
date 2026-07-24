import { IExtractionResult } from '../ntgraph/Types';
import { IExtractor } from './ExtractorBase';
import { TypeScriptExtractor } from './extractors/TypeScript';
import { PythonExtractor } from './extractors/Python';
import { GoExtractor } from './extractors/Go';
import { RustExtractor } from './extractors/Rust';
import { JavaExtractor } from './extractors/Java';
import { CppExtractor } from './extractors/Cpp';
import { CSharpExtractor } from './extractors/CSharp';
import { RazorExtractor } from './extractors/Razor';
import { KotlinExtractor } from './extractors/Kotlin';
import { AstroExtractor } from './extractors/Astro';
import { DefaultExtractor } from './extractors/Default';
import { VueExtractor } from './extractors/Vue';

const EXTRACTOR_MAP = new Map<string, IExtractor>();

function ensureExtractors(): void {
  if (EXTRACTOR_MAP.size === 0) {
    EXTRACTOR_MAP.set('typescript', new TypeScriptExtractor());
    EXTRACTOR_MAP.set('python', new PythonExtractor());
    EXTRACTOR_MAP.set('go', new GoExtractor());
    EXTRACTOR_MAP.set('rust', new RustExtractor());
    EXTRACTOR_MAP.set('java', new JavaExtractor());
    EXTRACTOR_MAP.set('cpp', new CppExtractor());
    EXTRACTOR_MAP.set('c', new CppExtractor());
    EXTRACTOR_MAP.set('csharp', new CSharpExtractor());
    EXTRACTOR_MAP.set('razor', new RazorExtractor());
    EXTRACTOR_MAP.set('kotlin', new KotlinExtractor());
    EXTRACTOR_MAP.set('astro', new AstroExtractor());
    EXTRACTOR_MAP.set('vue', new VueExtractor());
    EXTRACTOR_MAP.set('default', new DefaultExtractor());
  }
}

export function extractFromSource(
  filePath: string,
  content: string,
  language: string,
  frameworkNames?: string[],
): IExtractionResult {
  ensureExtractors();

  let extractor = EXTRACTOR_MAP.get(language);

  if (!extractor) {
    extractor = EXTRACTOR_MAP.get('default') ?? new DefaultExtractor();
  }

  const start = Date.now();
  const result = extractor.extract(content, filePath, frameworkNames);
  result.durationMs = Date.now() - start;

  return result;
}
