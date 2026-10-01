import {
  EMPTY_SHARED_STATE,
  SharedStateError,
  type SharedStateRequirements,
  type SharedStateService,
  type SharedStateStore,
} from '@company/mfe-core/shared-state'
import type { MountContext } from '../mount/mount-context.ts'

export interface SharedStateDefinition {
  readonly id: string
  readonly sharedState?: SharedStateRequirements
  /** Authoring-only. A mounted schema means the build transform did not run. */
  readonly sharedStateSchema?: unknown
}
/** Called by adapters as well as neutral resolution, so an old shell fails before rendering. */
export async function prepareSharedStateMount(
  definition: SharedStateDefinition,
  context: MountContext,
): Promise<MountContext> {
  if (definition.sharedStateSchema !== undefined)
    throw new SharedStateError(
      'unsupported-contract',
      definition.id,
      'Authoring schema reached runtime. Build this definition with the shared-state transform',
    )
  const requirements = definition.sharedState ?? EMPTY_SHARED_STATE
  if (requirements.protocolVersion !== 1)
    throw new SharedStateError(
      'unsupported-contract',
      definition.id,
      'Unsupported shared-state protocol; upgrade the shell',
    )
  const service = (context.runtime as { sharedState?: SharedStateService }).sharedState
  if (!service && requirements.contracts.length)
    throw new SharedStateError(
      'unsupported-contract',
      definition.id,
      'Shell lacks shared-state protocol 1. Configure the shell catalog, scope and persistence adapter before mounting',
    )
  if (service) {
    if (
      service.protocolVersion !== 1 ||
      typeof service.prepare !== 'function' ||
      typeof service.bind !== 'function'
    )
      throw new SharedStateError(
        'unsupported-contract',
        definition.id,
        'Unsupported shell shared-state ABI; upgrade the shell',
      )
    await service.prepare(requirements, context.signal)
    return { ...context, sharedState: service.bind(requirements, context.signal) }
  }
  return { ...context, sharedState: emptySharedStateStore() }
}
export function emptySharedStateStore(): SharedStateStore {
  const fail = (key: string): never => {
    throw new SharedStateError(
      'unsupported-contract',
      key,
      'This definition has no shared-state contract',
    )
  }
  return {
    get: fail,
    set: key =>
      Promise.reject(
        new SharedStateError(
          'unsupported-contract',
          key,
          'This definition has no shared-state contract',
        ),
      ),
    subscribe: fail,
  }
}
