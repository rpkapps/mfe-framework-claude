/**
 * The shell/container protocol, independent of package versions: registry format, mounting and
 * runtime services. Compatible additions raise the minor; incompatible changes raise the major.
 */
import type { DefinitionIdentity } from './definition.ts'
import { createMfeError, describeValue } from './errors.ts'

export const RUNTIME_API_VERSION = '1.2.0'
/** Conservative baseline for adapters built with this framework release. */
export const RUNTIME_API_REQUIREMENT = '>=1.2.0 <2.0.0'

type Version = readonly [number, number, number]
type Operator = '=' | '>' | '>=' | '<' | '<='
interface Comparator {
  readonly operator: Operator
  readonly version: Version
}

// Stable SemVer only. Build metadata does not participate in precedence. Reject pre-releases:
// they are never stable production API promises, and supporting npm's full range grammar would
// add code that generated metadata never uses.
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const COMPARATOR = /^(>=|<=|>|<|=)?(.+)$/

function parseVersion(value: unknown): Version | undefined {
  if (typeof value !== 'string') return undefined
  const match = VERSION.exec(value)
  if (!match) return undefined
  const major = Number(match[1]),
    minor = Number(match[2]),
    patch = Number(match[3])
  return [major, minor, patch].every(Number.isSafeInteger) ? [major, minor, patch] : undefined
}

function parseRequirement(value: string): readonly Comparator[] | undefined {
  if (typeof value !== 'string') return undefined
  const source = value.trim()
  if (source === '') return undefined
  const comparators: Comparator[] = []
  for (const token of source.split(/\s+/)) {
    const match = COMPARATOR.exec(token)
    const version = match?.[2] === undefined ? undefined : parseVersion(match[2])
    if (!version) return undefined
    comparators.push({ operator: (match?.[1] ?? '=') as Operator, version })
  }
  return comparators
}

/** The generated subset of SemVer ranges: whitespace-separated stable-version comparators. */
export function isRuntimeRequirement(value: unknown): value is string {
  return typeof value === 'string' && parseRequirement(value) !== undefined
}

export function satisfiesRuntimeRequirement(version: string, requirement: string): boolean {
  const actual = parseVersion(version)
  const comparators = parseRequirement(requirement)
  if (!actual || !comparators) return false
  return comparators.every(({ operator, version: expected }) => {
    const comparison = actual[0] - expected[0] || actual[1] - expected[1] || actual[2] - expected[2]
    switch (operator) {
      case '=':
        return comparison === 0
      case '>':
        return comparison > 0
      case '>=':
        return comparison >= 0
      case '<':
        return comparison < 0
      case '<=':
        return comparison <= 0
    }
  })
}

/** Explicit metadata is mandatory at both registry/loading and provider mount boundaries. */
export function assertRuntimeCompatibility(
  runtime: { readonly apiVersion?: unknown },
  definition: Pick<DefinitionIdentity, 'id' | 'version'> & { readonly requiresRuntime?: unknown },
): void {
  const requirement = definition.requiresRuntime
  if (!isRuntimeRequirement(requirement)) {
    throw createMfeError({
      code: 'registry/invalid-entry',
      id: definition.id,
      ...(definition.version === undefined ? {} : { definitionVersion: definition.version }),
      operation: 'read runtime compatibility metadata',
      path: ['requiresRuntime'],
      expected: 'an explicit stable SemVer comparator range, such as ">=1.1.0 <2.0.0"',
      observed: requirement === undefined ? 'no requiresRuntime' : describeValue(requirement),
      repair: 'Rebuild the container with generated requiresRuntime metadata.',
    })
  }
  const version = runtime.apiVersion
  if (typeof version !== 'string' || !parseVersion(version)) {
    throw createMfeError({
      code: version === undefined ? 'config/missing' : 'config/invalid',
      id: definition.id,
      ...(definition.version === undefined ? {} : { definitionVersion: definition.version }),
      operation: 'read shell runtime API version',
      path: ['apiVersion'],
      expected: 'an explicit stable SemVer apiVersion on the shell-owned runtime',
      observed: version === undefined ? 'no apiVersion' : describeValue(version),
      repair: 'Create the shell runtime with createMfeRuntime, then reload the page.',
    })
  }
  if (satisfiesRuntimeRequirement(version, requirement)) return
  throw createMfeError({
    code: 'contract/runtime-incompatible',
    id: definition.id,
    ...(definition.version === undefined ? {} : { definitionVersion: definition.version }),
    operation: 'check shell runtime compatibility',
    expected: `runtime API ${requirement}`,
    observed: `runtime API ${version}`,
    repair:
      'Reload after the shell is upgraded, or rebuild the container against the shell’s supported runtime API. Retrying the same versions cannot resolve this mismatch.',
  })
}
