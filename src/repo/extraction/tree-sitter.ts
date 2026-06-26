import { IExtractionResult } from '../ntgraph/Types';
import { IExtractor } from './ExtractorBase';
import { TypeScriptExtractor } from './extractors/TypeScript';
import { PythonExtractor } from './extractors/Python';
import { GoExtractor } from './extractors/Go';
import { RustExtractor } from './extractors/Rust';
import { JavaExtractor } from './extractors/Java';
import { CppExtractor } from './extractors/Cpp';
import { CSharpExtractor } from './extractors/CSharp';
import { DefaultExtractor } from './extractors/Default';

const EXTRACTOR_MAP = new Map<string, IExtractor>();

function ensureExtractors(): void {
  if (EXTRACTOR_MAP.size === 0) {
    EXTRACTOR_MAP.set('typescript', new TypeScriptExtractor());
    EXTRACTOR_MAP.set('python', new PythonExtractor());
    EXTRACTOR_MAP.set('go', new GoExtractor());
    EXTRACTOR_MAP.set('rust', new RustExtractor());
    EXTRACTOR_MAP.set('java', new JavaExtractor());
    EXTRACTOR_MAP.set('cpp', new CppExtractor());
    EXTRACTOR_MAP.set('csharp', new CSharpExtractor());
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

  const extractor = EXTRACTOR_MAP.get(language);

  if (!extractor) {
    return {
      nodes: [],
      edges: [],
      unresolvedReferences: [],
      errors: [
        {
          message: `Экстрактор для языка ${language} не найден`,
          filePath,
          severity: 'warning',
          code: 'parse_error',
        },
      ],
      durationMs: 0,
    };
  }

  const start = Date.now();
  const result = extractor.extract(filePath, content, frameworkNames);
  result.durationMs = Date.now() - start;

  return result;
}
