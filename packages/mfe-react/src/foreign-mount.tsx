/**
 * Hosting a definition another framework built. A React shell cannot render that framework's
 * tree, so React owns the scope root and an empty element inside it, and the definition mounts
 * itself into the element through the neutral contract. The provider validates what it is given
 * and what it emits; this side checks only what the consumer declared, as `WidgetMount` does.
 */

import {
  toMfeError,
  validateAgainstContract,
  type MfeError,
  type WidgetContract,
} from '@company/mfe-core'
import type {
  MountableAppDefinition,
  MountableWidgetDefinition,
  MountContext,
  MountedWidget,
} from '@company/mfe-host'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

import { MfeScopeRoot } from './scope-root.tsx'
import { inputsEqual } from './widget-mount.tsx'

/** Inline rather than a class, because the framework ships no stylesheet. */
const LAYOUT_NEUTRAL = { display: 'contents' } as const

interface Disposable {
  dispose(): Promise<void>
}

/**
 * One self-mount per effect run. A mount that settles after its effect was cleaned up — an
 * unmount, or StrictMode's rehearsal — is disposed the moment it arrives, so nothing it rendered
 * outlives the component. A rejection is kept to be thrown from render, where the retry boundary
 * a React host already has around every definition catches it.
 */
function useSelfMount<Handle extends Disposable>(
  host: RefObject<HTMLDivElement | null>,
  start: (element: HTMLElement) => Promise<Handle>,
  onMounted: (handle: Handle) => void,
  failed: (error: unknown) => MfeError,
  deps: readonly unknown[],
): { readonly mounted: RefObject<Handle | null>; readonly failure: MfeError | null } {
  const mounted = useRef<Handle | null>(null)
  const [failure, setFailure] = useState<MfeError | null>(null)

  useEffect(
    () => {
      const element = host.current
      if (element === null) return undefined

      let current = true
      let handle: Handle | null = null

      start(element).then(
        created => {
          if (!current) {
            void created.dispose()
            return
          }
          handle = created
          mounted.current = created
          onMounted(created)
        },
        (error: unknown) => {
          if (current) setFailure(failed(error))
        },
      )

      return () => {
        current = false
        mounted.current = null
        if (handle !== null) void handle.dispose()
      }
    },
    // `start`, `onMounted` and `failed` are rebuilt on every render and read only what `deps`
    // and the committed props hold, so `deps` alone names what the mount is derived from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  )

  return { mounted, failure }
}

function mountFailure(definitionId: string, operation: string): (error: unknown) => MfeError {
  return error =>
    toMfeError(error, {
      code: 'mount/failure',
      id: definitionId,
      operation,
      repair: 'Check the error the definition rejected its mount with, then use the retry action.',
    })
}

export interface ForeignAppMountProps {
  readonly definition: MountableAppDefinition
  readonly mount: MountContext
}

/** The App navigates through `mount.runtime.navigator`, which the context already carries. */
export function ForeignAppMount({ definition, mount }: ForeignAppMountProps): ReactNode {
  const host = useRef<HTMLDivElement>(null)

  const { failure } = useSelfMount(
    host,
    element => definition.mount({ element, context: mount }),
    () => undefined,
    mountFailure(definition.id, 'mount App'),
    [definition, mount],
  )

  if (failure !== null) throw failure

  return (
    <MfeScopeRoot
      definitionId={definition.id}
      mountToken={mount.mountToken}
      kind="app"
      overlayRoot={mount.overlayRoot}
    >
      <div ref={host} style={LAYOUT_NEUTRAL} />
    </MfeScopeRoot>
  )
}

export interface ForeignWidgetMountProps {
  readonly definition: MountableWidgetDefinition
  readonly mount: MountContext
  readonly inputs: Readonly<Record<string, unknown>>
  /** Latest committed handlers, keyed by event name (not by `onX` prop name). */
  readonly handlers: Readonly<Record<string, (payload: unknown) => void>>
  /** Consumer-declared event schemas, when a runtime contract was supplied. */
  readonly consumerEvents?: WidgetContract['events'] | undefined
}

export function ForeignWidgetMount({
  definition,
  mount,
  inputs,
  handlers,
  consumerEvents,
}: ForeignWidgetMountProps): ReactNode {
  const host = useRef<HTMLDivElement>(null)

  // Read through a ref by the channel the provider holds, so handler churn never remounts it;
  // assigned after commit, because a render React abandons must not publish its callbacks.
  // Declared before the mount, so a mount started in this commit reads this commit's props.
  const committed = useRef({ inputs, handlers, consumerEvents })
  useEffect(() => {
    committed.current = { inputs, handlers, consumerEvents }
  })

  // The inputs the provider was last handed, which is what a change is measured against.
  const sent = useRef(inputs)

  const emit = (event: string, payload: unknown): void => {
    const latest = committed.current
    const consumerSchema = latest.consumerEvents?.[event]
    if (consumerSchema === undefined) {
      latest.handlers[event]?.(payload)
      return
    }

    const accepted = validateAgainstContract(consumerSchema, payload, {
      id: definition.id,
      ...(definition.version === undefined ? {} : { definitionVersion: definition.version }),
      direction: 'event',
      side: 'consumer',
      eventName: event,
    })
    // A consumer-side mismatch is the consumer's to fix, so it is reported, never thrown into
    // the provider's stack.
    if (!accepted.ok) {
      mount.runtime.diagnostics.report(accepted.error, {
        context: { widget: definition.id, event },
      })
      return
    }

    latest.handlers[event]?.(accepted.value)
  }

  const push = (handle: MountedWidget): void => {
    const latest = committed.current.inputs
    if (Object.is(sent.current, latest) || inputsEqual(sent.current, latest)) return
    sent.current = latest
    handle.update(latest)
  }

  const { mounted, failure } = useSelfMount<MountedWidget>(
    host,
    element => {
      sent.current = committed.current.inputs
      // The provider reports a rejected update to the runtime itself; nothing here repeats it.
      return definition.mount({ element, context: mount, inputs: sent.current, emit })
    },
    // Inputs that changed while the mount was pending reach it as its first update.
    push,
    mountFailure(definition.id, 'mount Widget'),
    [definition, mount],
  )

  useEffect(() => {
    if (mounted.current !== null) push(mounted.current)
  })

  if (failure !== null) throw failure

  return (
    <MfeScopeRoot
      definitionId={definition.id}
      mountToken={mount.mountToken}
      kind="widget"
      overlayRoot={mount.overlayRoot}
    >
      <div ref={host} style={LAYOUT_NEUTRAL} />
    </MfeScopeRoot>
  )
}
