import { describe, it, expect } from 'vitest';
import { getFrameworkResolver } from '../Frameworks';
import './cargo-workspace';
import './aspnet-core';
import './react-native';

function makeContext(files: Record<string, string>) {
  return {
    getAllFiles: () => Object.keys(files),
    getFileContent: (f: string) => files[f] ?? null,
  } as any;
}

describe('Cargo Workspace', () => {
  it('detect: корневой Cargo.toml с [workspace]', () => {
    const resolver = getFrameworkResolver('Cargo Workspace')!;
    expect(
      resolver.detect(makeContext({ 'Cargo.toml': '[workspace]\nmembers = ["crates/a"]\n' })),
    ).toBe(true);
    expect(resolver.detect(makeContext({ 'Cargo.toml': '[package]\nname = "a"\n' }))).toBe(false);
  });

  it('postExtract: module-узел для каждого crate', () => {
    const resolver = getFrameworkResolver('Cargo Workspace')!;
    const files = {
      'Cargo.toml': '[workspace]\nmembers = ["crates/a"]\n',
      'crates/a/Cargo.toml': '[package]\nname = "crate-a"\n',
    };
    const nodes = resolver.postExtract!(makeContext(files));
    expect(nodes.map((n) => n.name)).toContain('crate-a');
    expect(nodes.every((n) => n.kind === 'module')).toBe(true);
  });
});

describe('ASP.NET Core', () => {
  it('extract: route-атрибуты → route-узлы', () => {
    const resolver = getFrameworkResolver('ASP.NET Core')!;
    const content =
      '[Route("api/[controller]")]\npublic class GreeterController { }\n' +
      '[HttpGet("hello")]\npublic string Hello() => "hi";\n';
    const result = resolver.extract!('Controllers/GreeterController.cs', content);
    const names = result.nodes.map((n) => n.name);
    expect(names).toContain('ROUTE api/[controller]');
    expect(names).toContain('GET hello');
    expect(result.nodes.every((n) => n.kind === 'route')).toBe(true);
  });
});

describe('React Native', () => {
  it('extract: AppRegistry.registerComponent → component-узлы', () => {
    const resolver = getFrameworkResolver('React Native')!;
    const result = resolver.extract!('index.js', 'AppRegistry.registerComponent("MainApp", () => App);\n');
    expect(result.nodes.map((n) => n.name)).toEqual(['MainApp']);
    expect(result.nodes[0].kind).toBe('component');
  });

  it('detect: react-native в package.json', () => {
    const resolver = getFrameworkResolver('React Native')!;
    expect(
      resolver.detect(
        makeContext({ 'package.json': JSON.stringify({ dependencies: { 'react-native': '0.73.0' } }) }),
      ),
    ).toBe(true);
  });
});
