import {
  emptyUserContextRequirements,
  UserContextError,
  type UserContextRequirements,
  type UserContextService,
  type UserContextStore,
  type UserContextReader,
} from '@company/mfe-core/user-context'
import type { MountContext } from '../mount/mount-context.ts'

export interface UserContextDefinition {
  readonly id: string
  readonly userContext?: UserContextRequirements
  /** Authoring-only. A mounted schema means the build transform did not run. */
  readonly userContextSchema?: unknown
  readonly userContextReads?: unknown
}
/** Called by adapters as well as neutral resolution, so an old shell fails before rendering. */
export async function prepareUserContextMount(
  definition: UserContextDefinition,
  context: MountContext,
): Promise<MountContext> {
  if (definition.userContextSchema !== undefined || definition.userContextReads !== undefined)
    throw new UserContextError(
      'unsupported-contract',
      definition.id,
      'Authoring schema reached runtime. Build this definition with the user-context transform',
    )
  if (definition.id !== context.definitionId)
    throw new UserContextError(
      'unauthorized-owner',
      definition.id,
      'Definition differs from the trusted mounted identity',
    )
  const requirements = definition.userContext ?? emptyUserContextRequirements(definition.id)
  if (requirements.protocolVersion !== 1)
    throw new UserContextError(
      'unsupported-contract',
      definition.id,
      'Unsupported user-context protocol; upgrade the shell',
    )
  const service = (context.runtime as { userContext?: UserContextService }).userContext
  if (!service && requirements.contracts.length)
    throw new UserContextError(
      'unsupported-contract',
      definition.id,
      'Shell lacks user-context protocol 1. Configure the shell contracts, scope and persistence adapter before mounting',
    )
  if (service) {
    if (
      service.protocolVersion !== 1 ||
      typeof service.prepare !== 'function' ||
      typeof service.bind !== 'function' ||
      typeof service.bindReadOnly !== 'function'
    )
      throw new UserContextError(
        'unsupported-contract',
        definition.id,
        'Unsupported shell user-context ABI; upgrade the shell',
      )
    await service.prepare(requirements, context.signal)
    const readers = new Map<string, UserContextReader>()
    const generation = service.inspection?.getSnapshot().generation
    let invalidated = false
    const stopInspection = service.inspection?.subscribe(() => {
      const next = service.inspection?.getSnapshot().generation
      if (next !== generation) {
        readers.clear()
        invalidated = true
      }
    })
    context.signal.addEventListener(
      'abort',
      () => {
        readers.clear()
        stopInspection?.()
      },
      { once: true },
    )
    return {
      ...context,
      userContext: service.bind(context.definitionId, requirements, context.signal),
      resolveUserContext: ownerId => {
        if (invalidated || context.signal.aborted)
          throw new UserContextError(
            'scope-disposed',
            ownerId,
            'This mount belongs to a disposed scope',
          )
        let reader = readers.get(ownerId)
        if (!reader) {
          reader = service.bindReadOnly(context.definitionId, requirements, ownerId, context.signal)
          readers.set(ownerId, reader)
        }
        return reader
      },
    }
  }
  return { ...context, userContext: emptyUserContextStore() }
}
export function emptyUserContextStore(): UserContextStore {
  const fail = (key: string): never => {
    throw new UserContextError(
      'unsupported-contract',
      key,
      'This definition has no user-context contract',
    )
  }
  return {
    get: fail,
    getSnapshot: () => fail('<owner>'),
    observe: () => fail('<owner>'),
    set: key =>
      Promise.resolve({
        ok: false,
        error: new UserContextError(
          'unsupported-contract',
          key,
          'This definition has no user-context contract',
        ),
      }),
    subscribe: fail,
  }
}
