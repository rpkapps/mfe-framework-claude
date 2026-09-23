/**
 * Placing a definition from React: the runtime's `mountDefinition`, driven by effects. Every host
 * component goes through here, and nothing here asks which framework built the definition, because
 * every definition mounts itself into the element this returns a ref to.
 */

import type { MountState, WidgetContract } from '@company/mfe-core'
import {
  mountDefinition,
  type DefinitionMount,
  type MountContext,
  type MfeRuntime,
  type WidgetDefinitionMount,
} from '@company/mfe-runtime'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'

import { useOptionalMfeMount } from './mount-context.tsx'
import { useMfeRuntime } from './runtime-context.tsx'

type Inputs = Readonly<Record<string, unknown>>

export interface AppPlacement {
  readonly kind: 'app'
  readonly definitionId: string
  readonly basePath: string
}

export interface WidgetPlacement {
  readonly kind: 'widget'
  readonly definitionId: string
  readonly inputs: Inputs
  /** Read when an event arrives rather than when the mount is made, so it may change freely. */
  readonly onEvent: (event: string, payload: unknown) => void
  /** The consumer's own view of the events, when it imported the Widget's contract. */
  readonly consumerEvents?: WidgetContract['events'] | undefined
}

export type Placement = AppPlacement | WidgetPlacement

export interface DefinitionMountView {
  /** Attach to an empty element the host renders for the mount's whole life. */
  readonly element: RefObject<HTMLDivElement | null>
  readonly state: MountState
  readonly retry: () => void
}

/** What the host shows before the effect has made the mount. */
const NOT_STARTED: MountState = { status: 'pending', attempt: 0 }

function isWidgetMount(mount: DefinitionMount): mount is WidgetDefinitionMount {
  return typeof (mount as Partial<WidgetDefinitionMount>).update === 'function'
}

/** The placement is read through the ref, so what the effect passes on is this commit's. */
function open(
  runtime: MfeRuntime,
  element: HTMLElement,
  parent: MountContext | null,
  committed: RefObject<Placement>,
): DefinitionMount {
  const placement = committed.current
  const base = { runtime, element, definitionId: placement.definitionId, parent }

  if (placement.kind === 'app') {
    return mountDefinition({ ...base, kind: 'app', basePath: placement.basePath })
  }

  const { consumerEvents } = placement
  return mountDefinition({
    ...base,
    kind: 'widget',
    inputs: placement.inputs,
    onEvent: (event, payload) => {
      const latest = committed.current
      if (latest.kind === 'widget') latest.onEvent(event, payload)
    },
    ...(consumerEvents === undefined ? {} : { consumerEvents }),
  })
}

/**
 * One effect makes the mount and disposes it, so a StrictMode rehearsal disposes the first mount
 * before its load settles and the definition's `mount` runs once. A second effect hands the mount
 * each render's inputs; `update` drops a set equal to the last one, so it is called freely.
 */
export function useDefinitionMount(placement: Placement, consumer: string): DefinitionMountView {
  const runtime = useMfeRuntime(consumer)
  const parent = useOptionalMfeMount()
  const element = useRef<HTMLDivElement>(null)
  const [mount, setMount] = useState<DefinitionMount | null>(null)

  // Assigned after commit, because a render React abandons must not reach the mount. Declared
  // before the mount effect, so a mount made in this commit reads this commit's placement.
  const committed = useRef(placement)
  useEffect(() => {
    committed.current = placement
  })

  const { kind, definitionId } = placement
  const basePath = placement.kind === 'app' ? placement.basePath : undefined
  const consumerEvents = placement.kind === 'widget' ? placement.consumerEvents : undefined

  useEffect(() => {
    const host = element.current
    if (host === null) return undefined

    // Published from the effect that made it: mounting during render is what React forbids,
    // since it starts a load and appends to the page.
    const created = open(runtime, host, parent, committed)
    setMount(created)

    return () => {
      // A failed disposal is reported by the runtime; nothing here can act on it.
      void created.dispose().catch(() => undefined)
    }
    // `kind`, `definitionId`, `basePath` and `consumerEvents` reach `open` through `committed`;
    // they are listed because they are what the mount is derived from, and a change of any of
    // them is a different mount.
  }, [runtime, parent, kind, definitionId, basePath, consumerEvents])

  const inputs = placement.kind === 'widget' ? placement.inputs : null
  useEffect(() => {
    if (inputs !== null && mount !== null && isWidgetMount(mount)) mount.update(inputs)
  }, [mount, inputs])

  const subscribe = useCallback(
    (listener: () => void) => (mount === null ? () => undefined : mount.subscribe(listener)),
    [mount],
  )
  const getState = useCallback(() => (mount === null ? NOT_STARTED : mount.getState()), [mount])
  const state = useSyncExternalStore(subscribe, getState)

  const retry = useCallback(() => {
    mount?.retry()
  }, [mount])

  return { element, state, retry }
}
