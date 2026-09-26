/**
 * Action registration as a hook, so scoping falls out of component lifetime: an action belongs
 * to its mount, or to the host page outside one (§26). Two effects, deliberately: one owns the
 * registration, the other publishes the latest callbacks, so inline closures stay current.
 *
 * A `shortcut` travels with the registration: the host reads every key once and runs the action
 * through the palette's path, while this mount's App is where the page is. A Widget's is ignored.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionInputSchema, ActionRegistration } from '@company/mfe-core'
import type {
  ActionExecutionResult,
  ActionRegistrationHandle,
  ActionRun,
} from '@company/mfe-runtime'

import { useOptionalMfeMount } from '../mount-context.tsx'
import { useMfeRuntime } from '../runtime-context.tsx'

type Latest = () => ActionRegistrationHandle

/**
 * Settled by the component's first registration with a reader of its latest one, so a run that
 * waited runs the registration current when it resumes: under StrictMode the first is already
 * removed and replaced by then.
 */
interface FirstRegistration {
  readonly settled: Promise<Latest>
  readonly settle: (latest: Latest) => void
}

function firstRegistration(): FirstRegistration {
  let settle: (latest: Latest) => void = () => {}
  const settled = new Promise<Latest>(resolve => {
    settle = resolve
  })
  return { settled, settle }
}

/**
 * Returns a stable run with the caller `'ui'`, for the App's own button: a click then shares
 * validation, approval and audit with the palette, the keys and the agent. It runs this
 * component's registration, never another mount's of the same name; called after the component
 * unmounted, it resolves `unavailable`.
 */
export function useAction<Input extends ActionInputSchema = ActionInputSchema, Output = unknown>(
  registration: ActionRegistration<Input, Output>,
): ActionRun<Input, Output> {
  const mount = useOptionalMfeMount()
  const { actions } = useMfeRuntime('useAction()')
  const handle = useRef<ActionRegistrationHandle | null>(null)
  const [first] = useState(firstRegistration)

  // The newest committed registration, so a re-registration picks it up after a remount.
  const committed = useRef<ActionRegistration<Input, Output>>(registration)

  // Keyed by what identifies the owner rather than by the context object, so a provider that
  // hands down a fresh object with the same mount does not re-register.
  const definitionId = mount?.definitionId
  const mountToken = mount?.mountToken
  const kind = mount?.kind
  const basePath = mount?.basePath

  useEffect(() => {
    const registered =
      definitionId === undefined ||
      mountToken === undefined ||
      kind === undefined ||
      basePath === undefined
        ? actions.registerHost(committed.current)
        : actions.register({ definitionId, mountToken, kind, basePath }, committed.current)
    handle.current = registered
    first.settle(() => handle.current ?? registered)

    // The handle outlives its removal, so a run after unmount resolves `unavailable` rather than
    // reaching another mount's action of the same name.
    return () => {
      registered.remove()
    }
  }, [actions, definitionId, mountToken, kind, basePath, first])

  // The registry compares the visible result and publishes nothing when only identity changed.
  useEffect(() => {
    committed.current = registration
    handle.current?.update(registration)
  })

  return useCallback(
    async (input?: unknown): Promise<ActionExecutionResult<Output>> => {
      // A child's layout effect, or its passive effect, runs before this component registers, and
      // with a concurrent root the passive effects wait for a later task. The run waits for the
      // registration rather than guessing an id, because `<definitionId>:<name>` may be another
      // mount's action. The registration effect runs before any unmount's cleanup, so the wait
      // ends: with this component's action, or `unavailable` once it is removed.
      const own = handle.current ?? (await first.settled)()
      // The registry parsed the value with this registration's `outputSchema`, or it is what this
      // registration's `execute` returned.
      return (await own.execute({ caller: 'ui', input })) as ActionExecutionResult<Output>
    },
    [first],
  )
}
