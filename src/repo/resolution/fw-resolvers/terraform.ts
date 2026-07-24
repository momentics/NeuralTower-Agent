/**
 * Фреймворк-резолвер для Terraform.
 *
 * Обрабатывает ресурсы, данные, модули, провайдеры,
 * локальные значения и переменные из .tf файлов.
 */

import type {
  IFrameworkResolver,
  IUnresolvedReference,
  IResolvedRef,
  IResolutionContext,
  INode,
  IFrameworkExtractionResult,
  Language,
} from '../../ntgraph/Types';
import { NodeKind } from '../../ntgraph/Types';
import { registerFrameworkResolver } from '../Frameworks';
import * as crypto from 'crypto';

/** Языки, к которым применим резолвер. */
const LANGUAGES: Language[] = ['unknown'];

/** Встроенные провайдеры Terraform. */
const BUILTIN_PROVIDERS = new Set([
  'aws', 'azurerm', 'google', 'kubernetes', 'helm', 'null', 'local',
  'random', 'tls', 'template', 'time', 'archive', 'http',
]);

/** Обнаружение Terraform проекта. */
function detectTerraform(context: IResolutionContext): boolean {
  const files = context.getAllFiles();

  // Проверяем наличие .tf файлов
  if (files.some((f) => f.endsWith('.tf'))) return true;

  // Проверяем наличие .terraform/ директории
  if (files.some((f) => f.startsWith('.terraform/'))) return true;

  return false;
}

/** Извлечение resource-узлов. */
function extractResources(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // resource "aws_s3_bucket" "my_bucket" { ... } — объявление ресурса
  const resourceRe = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = resourceRe.exec(content))) {
    const type_ = m[1];
    const name = m[2];
    const lineNum = content.substring(0, m.index).split('\n').length;

    const node: INode = {
      id: crypto.createHash('sha256').update(`resource:${filePath}:${type_}:${name}`).digest('hex'),
      kind: NodeKind.Component,
      name: name,
      qualifiedName: `${type_}.${name}`,
      filePath,
      language: 'unknown' as Language,
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(node);
  }

  return { nodes, references };
}

/** Извлечение data-узлов. */
function extractDataSources(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // data "aws_ami" "example" { ... } — источник данных
  const dataRe = /data\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = dataRe.exec(content))) {
    const type_ = m[1];
    const name = m[2];
    const lineNum = content.substring(0, m.index).split('\n').length;

    const node: INode = {
      id: crypto.createHash('sha256').update(`data:${filePath}:${type_}:${name}`).digest('hex'),
      kind: NodeKind.Constant,
      name: name,
      qualifiedName: `data.${type_}.${name}`,
      filePath,
      language: 'unknown' as Language,
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(node);
  }

  return { nodes, references };
}

/** Извлечение module-узлов. */
function extractModules(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // module "network" { source = "./network" } — объявление модуля
  const moduleRe = /module\s+"([^"]+)"\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = moduleRe.exec(content))) {
    const name = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    const node: INode = {
      id: crypto.createHash('sha256').update(`module:${filePath}:${name}`).digest('hex'),
      kind: NodeKind.Module,
      name: name,
      qualifiedName: `module.${name}`,
      filePath,
      language: 'unknown' as Language,
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    };
    nodes.push(node);
  }

  return { nodes, references };
}

/** Извлечение provider-узлов. */
function extractProviders(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // provider "aws" { region = "us-east-1" } — объявление провайдера
  const providerRe = /provider\s+"([^"]+)"\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = providerRe.exec(content))) {
    const name = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`provider:${filePath}:${name}`).digest('hex'),
      kind: NodeKind.Component,
      name: name,
      qualifiedName: `provider.${name}`,
      filePath,
      language: 'unknown' as Language,
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Извлечение variable и output узлов. */
function extractVariablesAndOutputs(filePath: string, content: string): IFrameworkExtractionResult {
  const nodes: INode[] = [];
  const references: IUnresolvedReference[] = [];

  // variable "region" { type = string } — объявление переменной
  const varRe = /variable\s+"([^"]+)"\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = varRe.exec(content))) {
    const name = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`variable:${filePath}:${name}`).digest('hex'),
      kind: NodeKind.Variable,
      name: name,
      qualifiedName: `var.${name}`,
      filePath,
      language: 'unknown' as Language,
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });
  }

  // output "bucket_name" { value = aws_s3_bucket.my_bucket.id } — выходное значение
  const outputRe = /output\s+"([^"]+)"\s*\{/g;
  while ((m = outputRe.exec(content))) {
    const name = m[1];
    const lineNum = content.substring(0, m.index).split('\n').length;

    nodes.push({
      id: crypto.createHash('sha256').update(`output:${filePath}:${name}`).digest('hex'),
      kind: NodeKind.Export,
      name: name,
      qualifiedName: `output.${name}`,
      filePath,
      language: 'unknown' as Language,
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      updatedAt: Date.now(),
    });
  }

  return { nodes, references };
}

/** Резолвер Terraform. */
const terraformResolver: IFrameworkResolver = {
  name: 'Terraform',
  languages: LANGUAGES,

  detect: detectTerraform,

  claimsReference(name: string): boolean {
    // Ссылки вида aws_s3_bucket.my_bucket, var.region, data.aws_ami.example
    return name.includes('.') && (
      name.startsWith('var.') ||
      name.startsWith('output.') ||
      name.startsWith('module.') ||
      name.startsWith('data.') ||
      name.startsWith('local.') ||
      /^[a-z_]+\.[a-z_]+\./.test(name)
    );
  },

  resolve(ref: IUnresolvedReference, context: IResolutionContext): IResolvedRef | null {
    const name = ref.referenceName;

    // Ссылки вида aws_s3_bucket.my_bucket.id — ресурсы
    if (name.includes('.') && !name.startsWith('var.') && !name.startsWith('output.')) {
      const parts = name.split('.');
      if (parts.length >= 2) {
        const qualifiedName = `${parts[0]}.${parts[1]}`;
        const nodes = context.getNodesByQualifiedName(qualifiedName);
        if (nodes.length === 1) {
          return {
            original: ref,
            targetNodeId: nodes[0]!.id,
            confidence: 0.9,
            provenance: 'terraform-resource',
          };
        }

        // Ищем по имени
        const byName = context.getNodesByName(parts[1]);
        if (byName.length === 1) {
          return {
            original: ref,
            targetNodeId: byName[0]!.id,
            confidence: 0.8,
            provenance: 'terraform-resource',
          };
        }
      }
    }

    // var.region — переменные
    if (name.startsWith('var.')) {
      const varName = name.slice(4);
      const nodes = context.getNodesByName(varName).filter(
        (n) => n.kind === 'variable'
      );
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.9,
          provenance: 'terraform-variable',
        };
      }
    }

    // data.aws_ami.example — источники данных
    if (name.startsWith('data.')) {
      const parts = name.split('.');
      if (parts.length >= 3) {
        const qualifiedName = `data.${parts[1]}.${parts[2]}`;
        const nodes = context.getNodesByQualifiedName(qualifiedName);
        if (nodes.length === 1) {
          return {
            original: ref,
            targetNodeId: nodes[0]!.id,
            confidence: 0.9,
            provenance: 'terraform-data',
          };
        }
      }
    }

    // module.network — модули
    if (name.startsWith('module.')) {
      const moduleName = name.slice(7);
      const nodes = context.getNodesByName(moduleName).filter(
        (n) => n.kind === 'module'
      );
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.9,
          provenance: 'terraform-module',
        };
      }
    }

    // local.name — локальные значения
    if (name.startsWith('local.')) {
      const localName = name.slice(6);
      const nodes = context.getNodesByName(localName);
      if (nodes.length === 1) {
        return {
          original: ref,
          targetNodeId: nodes[0]!.id,
          confidence: 0.85,
          provenance: 'terraform-local',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): IFrameworkExtractionResult {
    const allNodes: INode[] = [];
    const allRefs: IUnresolvedReference[] = [];

    if (!filePath.endsWith('.tf')) return { nodes: allNodes, references: allRefs };

    // Ресурсы
    const resResult = extractResources(filePath, content);
    allNodes.push(...resResult.nodes);
    allRefs.push(...resResult.references);

    // Источники данных
    const dataResult = extractDataSources(filePath, content);
    allNodes.push(...dataResult.nodes);
    allRefs.push(...dataResult.references);

    // Модули
    const modResult = extractModules(filePath, content);
    allNodes.push(...modResult.nodes);
    allRefs.push(...modResult.references);

    // Провайдеры
    const provResult = extractProviders(filePath, content);
    allNodes.push(...provResult.nodes);
    allRefs.push(...provResult.references);

    // Переменные и выходы
    const varResult = extractVariablesAndOutputs(filePath, content);
    allNodes.push(...varResult.nodes);
    allRefs.push(...varResult.references);

    return { nodes: allNodes, references: allRefs };
  },
};

registerFrameworkResolver(terraformResolver);
