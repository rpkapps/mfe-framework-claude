/** Compile syntax, never evaluate author modules or accept JSON-schema metadata overrides. */
import { isValidDefinitionId } from '@company/mfe-core'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  assertJson,
  normalize,
  stableJson,
  stateCapabilities,
  type Json,
  type UserContextManifest,
  type StateContract,
  type StateNode,
} from '@company/mfe-core/user-context'
import { findExportedExpression, resolveRelativeModule } from '../discovery/local-modules.ts'
import { standaloneSources, type ContainerSources } from '../discovery/sources.ts'
import {
  collectImportedBindings,
  collectTopLevelBindings,
  propertyName,
  positionOf,
  ts,
  unwrapExpression,
} from '../discovery/ts-ast.ts'

export interface ContractDiagnostic {
  readonly rule: string
  readonly id: string
  readonly path: string
  readonly oldShape?: StateNode
  readonly newShape?: StateNode
  readonly message: string
  readonly repair: string
}
export class UserContextBuildError extends Error {
  readonly code = 'user-context/unsupported-schema'
  constructor(
    readonly file: string,
    readonly path: string,
    readonly line: number,
    readonly column: number,
    message: string,
  ) {
    super(
      `${file}:${line}:${column} user-context/unsupported-schema ${path}: ${message}. Use the supported JSON schema subset or a precompiled contract package.`,
    )
  }
}
export function contractFor(id: string, node: StateNode): StateContract {
  return {
    formatVersion: 1,
    id,
    node,
    revision: createHash('sha256')
      .update(stableJson({ formatVersion: 1, id, node }))
      .digest('hex'),
  }
}
export function requirementsFor(manifest: UserContextManifest, ownerId: string) {
  return {
    protocolVersion: 1 as const,
    ownerId,
    contracts: manifest.contracts.map(({ id, revision, node }) => ({
      id,
      revision,
      capabilities: stateCapabilities(node),
    })),
  }
}

export function compileUserContext(
  ownerId: string,
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  sources: ContainerSources = standaloneSources(),
): UserContextManifest {
  const root = readNode(expression, sourceFile, sources, 'userContextSchema', new Set())
  if (root.kind !== 'object')
    throw new Error(
      'user-context/unsupported-schema: userContextSchema must be a fixed-shape z.object',
    )
  return {
    formatVersion: 1,
    contracts: [contractFor(ownerId, root)],
  }
}

/** Explicit compatibility requirements grant read access only; the runtime derives write ownership. */
export function compileUserContextReads(
  definitionId: string,
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  sources: ContainerSources = standaloneSources(),
): readonly StateContract[] {
  const shape = unwrapExpression(expression)
  if (!ts.isObjectLiteralExpression(shape))
    throw new Error(
      'user-context/unsupported-schema: userContextReads must be an inline owner-to-schema object',
    )
  const owners = new Set([definitionId])
  return shape.properties.flatMap(property => {
    const ownerId = propertyName(property)
    const schema = ts.isPropertyAssignment(property)
      ? property.initializer
      : ts.isShorthandPropertyAssignment(property)
        ? property.name
        : undefined
    if (!ownerId || !isValidDefinitionId(ownerId) || !schema || owners.has(ownerId))
      throw new Error(
        'user-context/unsupported-schema: read declarations require unique other-owner IDs and schemas',
      )
    owners.add(ownerId)
    return compileUserContext(ownerId, schema, sourceFile, sources).contracts
  })
}

function readNode(
  expression: ts.Expression,
  file: ts.SourceFile,
  sources: ContainerSources,
  path: string,
  seen: Set<ts.Node>,
): StateNode {
  const node = unwrapExpression(expression)
  const fail = (message: string): never => {
    const { line, column } = positionOf(file, node)
    throw new UserContextBuildError(file.fileName, path, line, column, message)
  }
  if (seen.has(node)) fail('Recursive schemas are unsupported')
  const visited = new Set(seen).add(node)
  if (ts.isIdentifier(node)) {
    const local = collectTopLevelBindings(file).get(node.text)
    if (local) return readNode(local, file, sources, path, visited)
    const imported = collectImportedBindings(file).get(node.text)
    if (imported) {
      const target = resolveRelativeModule(file.fileName, imported.moduleSpecifier)
      if (target) {
        const external = sources.parse(target)
        const exported = findExportedExpression(external, imported.imported)
        if (exported) return readNode(exported, external, sources, path, visited)
      } else {
        // A domain package publishes this immutable, build-only export keyed by source export.
        try {
          const manifestPath = createRequire(file.fileName).resolve(
            `${imported.moduleSpecifier}/user-context.manifest.json`,
          )
          const packageManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
            schemas: Record<string, UserContextManifest>
          }
          const manifest = packageManifest.schemas[imported.imported]
          if (!manifest || manifest.formatVersion !== 1)
            return fail('Unreadable precompiled contract export')
          const contract = manifest.contracts[0]
          if (manifest.contracts.length !== 1 || !contract)
            return fail('Precompiled schema must contain exactly one owner contract')
          validateArtifact(contract)
          return contract.node
        } catch (error) {
          return fail(
            `Cannot resolve precompiled contract '${imported.imported}': ${String(error)}`,
          )
        }
      }
    }
    return fail(`Cannot statically resolve '${node.text}'`)
  }
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression))
    return fail('Schema must use statically readable Zod constructors')
  const access = node.expression
  const method = access.name.text
  const receiver = unwrapExpression(access.expression)
  const imported = ts.isIdentifier(receiver)
    ? collectImportedBindings(file).get(receiver.text)
    : undefined
  const isZod =
    imported?.moduleSpecifier === 'zod' && (imported.imported === 'z' || imported.imported === '*')
  const first = node.arguments[0]
  const child = (): StateNode => readNode(access.expression, file, sources, path, visited)
  const argument = (): Json =>
    first === undefined
      ? fail(`${method} needs a literal argument`)
      : readLiteral(first, file, path)
  const numeric = (): number => {
    const value = argument()
    if (typeof value !== 'number' || value < 0)
      return fail(`${method} needs a nonnegative finite literal`)
    return value
  }
  if (isZod) {
    switch (method) {
      case 'string':
      case 'number':
      case 'boolean':
      case 'null':
        if (node.arguments.length) return fail('Custom constructor parameters are unsupported')
        return { kind: method }
      case 'literal': {
        const value = argument()
        if (value !== null && typeof value === 'object')
          return fail('Only primitive literals are supported')
        return { kind: 'literal', value }
      }
      case 'enum': {
        const values = argument()
        if (
          !Array.isArray(values) ||
          values.length === 0 ||
          !values.every(value => typeof value === 'string')
        )
          return fail('enum needs a nonempty literal string array')
        return { kind: 'enum', values: [...new Set(values)].sort() }
      }
      case 'array':
        if (!first || node.arguments.length !== 1) return fail('array needs one schema')
        return { kind: 'array', item: readNode(first, file, sources, `${path}[]`, visited) }
      case 'object':
      case 'strictObject': {
        if (!first || node.arguments.length !== 1) return fail('object needs one literal shape')
        const shape = unwrapExpression(first)
        if (!ts.isObjectLiteralExpression(shape)) return fail('Object shapes must be literal')
        const fields: Record<string, StateNode> = {}
        for (const property of shape.properties) {
          const key = propertyName(property)
          const value = ts.isPropertyAssignment(property)
            ? property.initializer
            : ts.isShorthandPropertyAssignment(property)
              ? property.name
              : undefined
          if (key === null || !value || Object.hasOwn(fields, key))
            return fail('Spreads, computed and duplicate fields are unsupported')
          Object.defineProperty(fields, key, {
            value: readNode(value, file, sources, `${path}.${key}`, visited),
            enumerable: true,
          })
        }
        return {
          kind: 'object',
          strict: method === 'strictObject',
          fields: Object.fromEntries(Object.entries(fields).sort()),
        }
      }
      default:
        return fail(`Unsupported Zod constructor '${method}'`)
    }
  }
  // Only chain methods with faithfully implemented validation and normalization semantics.
  const inner = child()
  switch (method) {
    case 'nullable':
    case 'optional':
      if (node.arguments.length) return fail(`Custom ${method} parameters are unsupported`)
      return { kind: method, inner }
    case 'default': {
      const value = argument()
      normalize(inner, value, path)
      return { kind: 'default', inner, value }
    }
    case 'strict':
      if (inner.kind !== 'object' || node.arguments.length) return fail('strict requires an object')
      return { ...inner, strict: true }
    case 'min':
    case 'max': {
      if (!['number', 'string', 'array'].includes(inner.kind) || node.arguments.length !== 1)
        return fail(`${method} requires a number, string or array`)
      const value = inner.kind === 'number' ? argument() : numeric()
      if (typeof value !== 'number' || !Number.isFinite(value))
        return fail('Bounds must be finite number literals')
      const existing = (inner as { min?: number; max?: number })[method]
      const bound =
        existing === undefined
          ? value
          : method === 'min'
            ? Math.max(existing, value)
            : Math.min(existing, value)
      return { ...inner, [method]: bound }
    }
    case 'int':
      if (inner.kind !== 'number' || node.arguments.length) return fail('int requires a number')
      return { ...inner, integer: true }
    default:
      return fail(
        `Unsupported '${method}'; transforms, coercion, refinements, dynamic defaults, unions and records cannot silently weaken validation`,
      )
  }
}
function readLiteral(expression: ts.Expression, file: ts.SourceFile, path: string): Json {
  const node = unwrapExpression(expression)
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  )
    return -Number(node.operand.text)
  if (ts.isArrayLiteralExpression(node))
    return node.elements.map(value => readLiteral(value, file, path))
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, Json> = {}
    for (const property of node.properties) {
      const key = propertyName(property)
      if (key === null || !ts.isPropertyAssignment(property) || Object.hasOwn(result, key)) break
      Object.defineProperty(result, key, {
        value: readLiteral(property.initializer, file, path),
        enumerable: true,
      })
    }
    if (Object.keys(result).length === node.properties.length) return result
  }
  const { line, column } = positionOf(file, node)
  throw new UserContextBuildError(
    file.fileName,
    path,
    line,
    column,
    'Defaults and parameters must be deterministic JSON literals',
  )
}
export function validateArtifact(contract: StateContract): void {
  assertJson(contract)
  if (
    contract.formatVersion !== 1 ||
    contractFor(contract.id, contract.node).revision !== contract.revision
  )
    throw new Error(`user-context/invalid-artifact: ${contract.id} fingerprint or format mismatch`)
  // Recompile metadata through a fail-closed structural validator.
  validateNode(contract.node)
}
function validateNode(node: StateNode): void {
  const keys: Record<StateNode['kind'], readonly string[]> = {
    string: ['kind', 'min', 'max'],
    number: ['kind', 'min', 'max', 'integer'],
    boolean: ['kind'],
    null: ['kind'],
    literal: ['kind', 'value'],
    enum: ['kind', 'values'],
    array: ['kind', 'item', 'min', 'max'],
    object: ['kind', 'fields', 'strict'],
    nullable: ['kind', 'inner'],
    optional: ['kind', 'inner'],
    default: ['kind', 'inner', 'value'],
  }
  const allowed = keys[node.kind]
  if (!allowed || Object.keys(node).some(key => !allowed.includes(key)))
    throw new Error('user-context/invalid-artifact: unsupported node metadata')
  if ('inner' in node) {
    validateNode(node.inner)
    if (node.kind === 'default') normalize(node.inner, node.value, '<default>')
  }
  if (node.kind === 'object') {
    if (typeof node.strict !== 'boolean') throw new Error('Invalid object strictness')
    Object.values(node.fields).forEach(validateNode)
  }
  if (node.kind === 'array') validateNode(node.item)
  if (
    node.kind === 'enum' &&
    (!Array.isArray(node.values) ||
      !node.values.length ||
      !node.values.every(value => typeof value === 'string'))
  )
    throw new Error('Invalid enum')
  for (const key of ['min', 'max'] as const)
    if (key in node) {
      const value = (node as { min?: number; max?: number })[key]
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid bound')
    }
}

/** One engine for editor, container builds and publishing; no suppression option exists. */
export function compareContracts(
  previous: StateContract,
  candidate: StateContract,
): readonly ContractDiagnostic[] {
  const diagnostics: ContractDiagnostic[] = []
  const compare = (old: StateNode, next: StateNode, path: string, atomic = false): void => {
    if (stableJson(old) === stableJson(next)) return
    const reject = (rule: string, message: string, repair: string): void => {
      diagnostics.push({
        rule,
        id: candidate.id,
        path,
        oldShape: old,
        newShape: next,
        message,
        repair,
      })
    }
    if (old.kind !== next.kind || atomic) {
      reject(
        'user-context/incompatible-change',
        'Type, constraint or atomic value changed',
        'Use a new key or explicitly retire incompatible consumers',
      )
      return
    }
    if (old.kind === 'object' && next.kind === 'object' && old.strict === next.strict) {
      for (const [key, field] of Object.entries(old.fields)) {
        const newer = next.fields[key]
        if (!newer)
          reject(
            'user-context/removed-field',
            `Removed or renamed ${path}.${key}`,
            'Keep the field or use a new key',
          )
        else compare(field, newer, `${path}.${key}`)
      }
      for (const [key, field] of Object.entries(next.fields)) {
        if (Object.hasOwn(old.fields, key)) continue
        try {
          normalize(field, undefined, candidate.id)
        } catch {
          diagnostics.push({
            rule: 'user-context/incompatible-addition',
            id: candidate.id,
            path: `${path}.${key}`,
            newShape: field,
            message: 'Required property added without a default',
            repair: 'Make it optional or supply a deterministic default',
          })
        }
      }
      return
    }
    if ('inner' in old && 'inner' in next) {
      if (
        old.kind === 'default' &&
        next.kind === 'default' &&
        stableJson(old.value) !== stableJson(next.value)
      )
        reject(
          'user-context/changed-default',
          'Default changed',
          'Require explicit compatibility analysis or use a new key',
        )
      else compare(old.inner, next.inner, path)
      return
    }
    reject(
      'user-context/incompatible-change',
      'Constraints, enum members, nullability or atomic array items changed',
      'Use a new key or explicitly retire incompatible consumers',
    )
  }
  if (previous.id !== candidate.id) throw new Error('Cannot compare different user-context IDs')
  compare(previous.node, candidate.node, candidate.id)
  return diagnostics
}
export interface UserContextReleasePolicy {
  /** Immutable published history for build-time compatibility checks. Empty declares a first release. */
  readonly baselines: readonly UserContextManifest[]
  readonly schema: UserContextManifest
}
export function checkUserContextRelease(
  manifests: readonly UserContextManifest[],
  policy: UserContextReleasePolicy,
): void {
  if (!policyIsAvailable(policy))
    throw new Error(
      'user-context/missing-baseline: Release requires baselines and the current schema',
    )
  for (const manifest of [policy.schema, ...policy.baselines, ...manifests])
    manifest.contracts.forEach(validateArtifact)
  for (const canonical of policy.schema.contracts)
    for (const baseline of policy.baselines) {
      const old = baseline.contracts.find(item => item.id === canonical.id)
      if (old) {
        const diagnostics = compareContracts(old, canonical)
        if (diagnostics.length)
          throw new Error(
            diagnostics
              .map(item => `${item.rule} ${item.path}: ${item.message}. ${item.repair}`)
              .join('\n'),
          )
      }
    }
  for (const manifest of manifests)
    for (const contract of manifest.contracts) {
      const canonical = policy.schema.contracts.find(item => item.id === contract.id)
      if (!canonical) throw new Error(`user-context/missing-contract: ${contract.id}`)
      const diagnostics = [...compareContracts(contract, canonical)]
      for (const baseline of policy.baselines) {
        const old = baseline.contracts.find(item => item.id === contract.id)
        if (old && canonical.revision === contract.revision)
          diagnostics.push(...compareContracts(old, contract))
      }
      if (diagnostics.length)
        throw new Error(
          diagnostics
            .map(item => `${item.rule} ${item.path}: ${item.message}. ${item.repair}`)
            .join('\n'),
        )
    }
  for (const baseline of policy.baselines)
    for (const old of baseline.contracts) {
      if (!policy.schema.contracts.some(item => item.id === old.id))
        throw new Error(`user-context/removed-key: ${old.id}`)
    }
}

function policyIsAvailable(policy: UserContextReleasePolicy): boolean {
  return Array.isArray(policy.baselines) && !!policy.schema
}
