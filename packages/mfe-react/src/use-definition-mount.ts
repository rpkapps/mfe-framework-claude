/**
 * Placing a definition from React: the runtime's `mountDefinition`, driven by effects. Every host
 * component goes through here, and nothing here asks which framework built the definition, because
 * every definition mounts itself into the element this returns a ref to.
 */

import {
  shallowEqual,
  withoutUndefined,
  type MfeError,
  type MountState,
  type WidgetContract,
} from '@company/mfe-core'
import {
  mountDefinition,
  type DefinitionMount,
  type MountContext,
  type MfeRuntime,
  type WidgetDefinitionMount,
  type WidgetInputState,
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
  readonly instanceId?: string | undefined
  /** Read when an output arrives rather than when the mount is made, so it may change freely. */
  readonly onOutput: (output: string, payload: unknown) => void
  readonly consumerContract?: WidgetContract | undefined
  /** Called only for a rejected update; the previous valid render stays mounted. */
  readonly onInputRejected?: ((error: MfeError) => void) | undefined
}

export type Placement = AppPlacement | WidgetPlacement

export interface DefinitionMountView {
  /** Attach to an empty element the host renders for the mount's whole life. */
  readonly element: RefObject<HTMLDivElement | null>
  readonly state: MountState
  readonly attempt: number
  readonly inputState: WidgetInputState
  readonly retry: () => void
  readonly reload: () => void
}

/** What the host shows before the effect has made the mount. */
const NOT_STARTED: MountState = { status: 'pending', attempt: 0 }
const ACCEPTED: WidgetInputState = { status: 'accepted' }

function isWidgetMount(mount: DefinitionMount): mount is WidgetDefinitionMount {
  return typeof (mount as Partial<WidgetDefinitionMount>).update === 'function'
}

/**
 * The inputs object of the last render whose set differed. A host builds a new one from its props
 * on every render, so without this each parent render re-ran the update effect only for the mount
 * to find the set unchanged. Held in state, adjusted during render, because a ref written there
 * could describe a render React abandons.
 */
function useStableInputs(inputs: Inputs | null): Inputs | null {
  const [stable, setStable] = useState(inputs)
  if (inputs === stable) return stable
  if (inputs !== null && stable !== null && shallowEqual(stable, inputs)) return stable

  setStable(inputs)
  return inputs
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

  const { consumerContract, instanceId } = placement
  return mountDefinition({
    ...base,
    kind: 'widget',
    inputs: placement.inputs,
    onOutput: (output, payload) => {
      const latest = committed.current
      if (latest.kind === 'widget') latest.onOutput(output, payload)
    },
    onInputRejected: error => {
      const latest = committed.current
      if (latest.kind === 'widget') latest.onInputRejected?.(error)
    },
    ...withoutUndefined({ consumerContract, instanceId }),
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
  const consumerContract = placement.kind === 'widget' ? placement.consumerContract : undefined
  const instanceId = placement.kind === 'widget' ? placement.instanceId : undefined

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
    // `kind`, `definitionId`, `basePath` and `consumerContract` reach `open` through `committed`;
    // they are listed because they are what the mount is derived from, and a change of any of
    // them is a different mount.
  }, [runtime, parent, kind, definitionId, basePath, consumerContract, instanceId])

  const inputs = useStableInputs(placement.kind === 'widget' ? placement.inputs : null)
  useEffect(() => {
    if (inputs !== null && mount !== null && isWidgetMount(mount)) mount.update(inputs)
  }, [mount, inputs])

  const subscribe = useCallback(
    (listener: () => void) => (mount === null ? () => undefined : mount.subscribe(listener)),
    [mount],
  )
  const getState = useCallback(() => (mount === null ? NOT_STARTED : mount.getState()), [mount])
  const state = useSyncExternalStore(subscribe, getState)

  const subscribeInputs = useCallback(
    (listener: () => void) =>
      mount !== null && isWidgetMount(mount) ? mount.subscribeInput(listener) : () => undefined,
    [mount],
  )
  const getInputState = useCallback(
    () => (mount !== null && isWidgetMount(mount) ? mount.getInputState() : ACCEPTED),
    [mount],
  )
  const inputState = useSyncExternalStore(subscribeInputs, getInputState)

  const retry = useCallback(() => {
    mount?.retry()
  }, [mount])

  const reload = useCallback(() => {
    element.current?.ownerDocument.defaultView?.location.reload()
  }, [])

  return { element, state, attempt: mount?.attempt ?? 0, inputState, retry, reload }
}
