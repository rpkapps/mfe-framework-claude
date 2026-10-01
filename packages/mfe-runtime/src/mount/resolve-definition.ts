import { SharedStateError } from '@company/mfe-core/shared-state'
/**
 * Resolving the definition one mount attempt places. Nothing is cached here: the runtime's loader
 * already shares a load in flight and keeps one that resolved, and a rejection is never kept, so
 * the attempt after a failed load is a genuinely fresh one.
 */

import {
  createMfeError,
  isBrandedDefinition,
  withoutUndefined,
  type DefinitionKind,
  type MfeError,
  type RegistryEntry,
} from '@company/mfe-core'
import { assertRuntimeCompatibility } from '@company/mfe-core/runtime-compatibility'

import type { MfeRuntime } from '../runtime/create-runtime.ts'
import { isMountableDefinition, type MountableDefinition } from './mountable-definition.ts'

const LABELS: Readonly<Record<DefinitionKind, string>> = { app: 'App', widget: 'Widget' }

export async function resolveDefinition(
  runtime: MfeRuntime,
  id: string,
  kind: DefinitionKind,
  signal: AbortSignal,
): Promise<MountableDefinition> {
  const entry = runtime.registry.entries.get(id)
  if (entry === undefined) {
    throw createMfeError({
      code: 'registry/invalid-entry',
      id,
      operation: `resolve ${LABELS[kind]}`,
      observed: 'no registry entry with this id',
      repair:
        'Check the id against the generated registry entry, or add a localStorage override pointing at your dev server.',
    })
  }

  // Refused before anything is downloaded: the registry already says what the id is.
  if (entry.definitionKind !== kind) throw placedAsTheWrongKind(entry, kind)

  assertRuntimeCompatibility(runtime, entry)

  const { module: definition } = await runtime.loader.load(entry, { signal })

  if (!isMountableDefinition(definition) || definition.kind !== kind) {
    throw createMfeError({
      code: 'load/entry-failure',
      id,
      ...withoutUndefined({ definitionVersion: entry.version }),
      operation: `resolve ${LABELS[kind]}`,
      expected: `a definition created with create${LABELS[kind]}`,
      observed: describeUnmountable(definition),
      repair: `Export the ${LABELS[kind]} from src/mfe.ts and rebuild the container.`,
    })
  }

  // The registry may have remained cached while the deployed container changed. Check the
  // loaded adapter's requirement as well before any mount-owned service is used.
  assertRuntimeCompatibility(runtime, definition)
  if (definition.sharedState) {
    if (!runtime.sharedState)
      throw new SharedStateError(
        'unsupported-contract',
        id,
        'Shell requires shared-state protocol 1, a deployment contracts and persistence adapter',
      )
    await runtime.sharedState.prepare(definition.sharedState, signal)
  }
  return definition
}

function placedAsTheWrongKind(entry: RegistryEntry, kind: DefinitionKind): MfeError {
  return createMfeError({
    code: 'registry/invalid-entry',
    id: entry.id,
    ...withoutUndefined({ definitionVersion: entry.version }),
    operation: `resolve ${LABELS[kind]}`,
    expected: kind === 'app' ? 'an entry for an App' : 'an entry for a Widget',
    observed:
      entry.definitionKind === 'widget'
        ? 'an entry for a Widget, which owns no URL boundary'
        : 'an entry for an App',
    repair: 'Place an App with an App host and a Widget with a Widget host.',
  })
}

/** Names what arrived instead, so the message says which of the two checks failed. */
function describeUnmountable(value: unknown): string {
  if (isMountableDefinition(value)) {
    return value.kind === 'app' ? 'an App definition' : 'a Widget definition'
  }
  return isBrandedDefinition(value)
    ? `a definition from the ${value.framework} adapter that cannot mount itself`
    : 'a module that is not a framework definition'
}
