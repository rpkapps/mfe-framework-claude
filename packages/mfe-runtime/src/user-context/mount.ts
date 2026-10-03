import {
  UserContextError,
  type PreparedUserContext,
  type UserContextDeclaration,
  type UserContextReader,
  type UserContextService,
  type UserContextStore,
} from '@company/mfe-core/user-context'
import type { MountContext } from '../mount/mount-context.ts'

export interface UserContextDefinition {
  readonly id: string
  /** The definition's own slice and the foreign subsets it reads, validated at run time. */
  readonly userContext?: UserContextDeclaration
}
/** Called by adapters as well as neutral resolution, so hydration finishes before rendering. */
export async function prepareUserContextMount(
  definition: UserContextDefinition,
  context: MountContext,
): Promise<MountContext> {
  if (definition.id !== context.definitionId)
    throw new UserContextError(
      'unauthorized-owner',
      definition.id,
      'Definition differs from the trusted mounted identity',
    )
  // A definition without user context never touches the service, so it mounts while signed out.
  const declaration = definition.userContext
  if (declaration === undefined) return { ...context, userContext: emptyUserContextStore() }
  const service = context.runtime.userContext
  if (!service)
    throw new UserContextError(
      'not-ready',
      definition.id,
      'The shell has no user-context persistence. Pass userContext.adapter to createMfeRuntime before mounting this definition',
    )
  return { ...context, ...(await prepareUserContext(service, definition, context.signal)) }
}
/** Hydrate a declaration's owners, then bind them for as long as `signal` and the user last. */
export async function prepareUserContext(
  service: UserContextService,
  definition: UserContextDefinition,
  signal: AbortSignal,
): Promise<PreparedUserContext> {
  await service.prepare(definition, signal)
  // A user change resets the service; a binding made after it would read the next user's data.
  const generation = service.inspection.getSnapshot().generation
  const readers = new Map<string, UserContextReader>()
  signal.addEventListener('abort', () => readers.clear(), { once: true })
  return {
    userContext:
      definition.userContext?.schema === undefined
        ? emptyUserContextStore()
        : service.bind(definition, signal),
    resolveUserContext: ownerId => {
      if (signal.aborted || service.inspection.getSnapshot().generation !== generation)
        throw new UserContextError(
          'scope-disposed',
          ownerId,
          'This binding belongs to a previous signed-in user',
        )
      let reader = readers.get(ownerId)
      if (!reader) {
        reader = service.bindReadOnly(definition, ownerId, signal)
        readers.set(ownerId, reader)
      }
      return reader
    },
  }
}
export function emptyUserContextStore(): UserContextStore {
  const error = (key: string): UserContextError =>
    new UserContextError(
      'undeclared',
      key,
      'This definition declares no userContext.schema; declare one to read or write its own slice',
    )
  const fail = (key: string): never => {
    throw error(key)
  }
  return {
    get: fail,
    getSnapshot: () => fail('<owner>'),
    observe: () => fail('<owner>'),
    set: key => Promise.resolve({ ok: false, error: error(key) }),
    subscribe: fail,
  }
}
