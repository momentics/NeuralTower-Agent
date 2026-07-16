/**
 * Определение сгенерированных файлов для понижения ранга в поиске.
 *
 * Когда запрос совпадает с множеством символов в сгенерированных файлах
 * и в ручных реализациях, FTS-ранжер часто ставит сгенерированные первым.
 * Этот модуль — чистый классификатор на основе пути, используемый при
 * неоднозначности, а не жёсткий фильтр — сгенерированные узлы остаются
 * в графе, но ранжируются последними.
 */

const GENERATED_PATTERNS: ReadonlyArray<RegExp> = [
  // Go — protobuf / gRPC / pulsar
  /\.pb\.go$/,
  /\.pulsar\.go$/,
  /_grpc\.pb\.go$/,
  // Go — mockgen
  /_mock\.go$/,
  /_mocks\.go$/,
  /^mock_[^/]+\.go$/,
  // TypeScript / JavaScript — codegen
  /\.generated\.[jt]sx?$/,
  /\.gen\.[jt]sx?$/,
  /\.pb\.[jt]s$/,
  /_pb\.[jt]s$/,
  /_grpc_pb\.[jt]s$/,
  // Минифицированные бандлы
  /\.min\.m?js$/,
  // Python — protobuf / gRPC
  /_pb2(_grpc)?\.py$/,
  /_pb2\.pyi$/,
  // C++ — protobuf
  /\.pb\.(cc|h)$/,
  // C# — protobuf / gRPC
  /\.g\.cs$/,
  /Grpc\.cs$/,
  // Java — protobuf / gRPC
  /OuterClass\.java$/,
  /Grpc\.java$/,
  // Swift — protobuf
  /\.pb\.swift$/,
  // Dart — build_runner / freezed / json_serializable / chopper
  /\.g\.dart$/,
  /\.freezed\.dart$/,
  /\.pb\.dart$/,
  /\.pbgrpc\.dart$/,
  /\.chopper\.dart$/,
  // Rust — сгенерированные файлы
  /\.generated\.rs$/,
];

/**
 * Является ли файл сгенерированным по имени пути.
 * Используется для понижения ранга при неоднозначности.
 */
export function isGeneratedFile(filePath: string): boolean {
  return GENERATED_PATTERNS.some((p) => p.test(filePath));
}
