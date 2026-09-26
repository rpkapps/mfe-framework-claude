/**
 * Mounting one definition into an element a host provides. Every host mounts every definition
 * this way, whichever adapter built it and whichever framework the host is written in, its own
 * included. So loading, retry, deadlines, the scope root, input equality, consumer output checks
 * and teardown are decided once, here, rather than again in each adapter.
 */

import {
  shallowEqual,
  toMfeError,
  outputPayloadSchema,
  validateAgainstContract,
  withoutUndefined,
  type MfeError,
  type MountHandle,
  type WidgetContract,
} from '@company/mfe-core'

import type { MfeRuntime } from '../runtime/create-runtime.ts'
import { createMountContext, type MountContext, type MountContextHandle } from './mount-context.ts'
import { MountController, type MountOperations } from './mount-controller.ts'
import type {
  MountableDefinition,
  MountableWidgetDefinition,
  MountedApp,
  MountedWidget,
} from './mountable-definition.ts'
import { resolveDefinition } from './resolve-definition.ts'

type Inputs = Readonly<Record<string, unknown>>
type Mounted = MountedApp | MountedWidget

interface MountRequestBase {
  readonly runtime: MfeRuntime
  /** Rendered and left childless by the host framework; one scope root is appended per attempt. */
  readonly element: HTMLElement
  readonly definitionId: string
  /** The enclosing mount: depth is its depth + 1, and this mount is disposed when its signal aborts. */
  readonly parent?: MountContext | null
}

export interface AppMountRequest extends MountRequestBase {
  readonly kind: 'app'
  /** The URL boundary the App owns. */
  readonly basePath: string
}

export interface WidgetMountRequest extends MountRequestBase {
  readonly kind: 'widget'
  readonly inputs: Inputs
  /** Called after the provider validated the payload and any consumer contract accepted it. */
  readonly onOutput: (output: string, payload: unknown) => void
  /** The host's own view of the outputs; a payload that fails it is reported and not delivered. */
  readonly consumerOutputs?: WidgetContract['outputSchema'] | undefined
  /** An update the Widget rejected, which the Widget has already reported. */
  readonly onInputRejected?: (error: MfeError) => void
}

export type MountRequest = AppMountRequest | WidgetMountRequest

export interface DefinitionMount extends MountHandle {
  /** The context of the attempt currently attached; `null` before the first and between two. */
  readonly context: MountContext | null
  /**
   * Resolves once the mounted definition has rendered what it was last given, through its own
   * `whenStable`; at once while nothing is mounted, or for a definition that offers none.
   */
  whenStable(): Promise<void>
}

export interface WidgetDefinitionMount extends DefinitionMount {
  /** The one place input equality is decided; a shallow-equal set is dropped. */
  update(inputs: Inputs): void
}

export function mountDefinition(request: AppMountRequest): DefinitionMount
export function mountDefinition(request: WidgetMountRequest): WidgetDefinitionMount
export function mountDefinition(request: MountRequest): DefinitionMount | WidgetDefinitionMount {
  const { runtime, definitionId, parent } = request
  const version = runtime.registry.entries.get(definitionId)?.version

  // The controller does not exist yet when the operations are built; nothing calls back into
  // it before `start()`, which is after both do.
  const operations = new DefinitionAttempts(request, error => {
    controller.fail(error)
  })

  const stopFollowingParent = followParent(parent, () => {
    void controller.dispose().catch(() => undefined)
  })

  const controller: MountController<MountableDefinition> = new MountController({
    id: definitionId,
    ...withoutUndefined({ definitionVersion: version }),
    operations,
    deadlines: runtime.deadlines,
    diagnostics: runtime.diagnostics,
    onDisposed: stopFollowingParent,
  })

  if (parent?.signal.aborted === true) void controller.dispose().catch(() => undefined)
  else void controller.start()

  const handle: DefinitionMount = {
    id: controller.id,
    get state() {
      return controller.getState()
    },
    getState: controller.getState,
    subscribe: controller.subscribe,
    retry: () => {
      controller.retry()
    },
    dispose: () => controller.dispose(),
    get context() {
      return operations.context
    },
    whenStable: () => operations.whenStable(),
  }

  if (request.kind === 'app') return handle
  return Object.assign(handle, {
    update: (inputs: Inputs) => {
      if (!controller.isDisposed) operations.update(inputs)
    },
  })
}

type HeldWidgetRequest = Omit<WidgetMountRequest, 'inputs'>
type HeldRequest = AppMountRequest | HeldWidgetRequest

/**
 * The request without its first inputs, which `#inputs` and each attempt's `delivered` replace:
 * holding the request itself would keep that first set alive for the mount's whole life. Copied
 * by descriptor rather than by value, because a host may pass a field as a getter that follows
 * its own state, as the Angular host does with `consumerOutputs`.
 */
function withoutFirstInputs(request: MountRequest): HeldRequest {
  if (request.kind === 'app') return request
  const descriptors = Object.getOwnPropertyDescriptors(request)
  Reflect.deleteProperty(descriptors, 'inputs')
  return Object.create(Object.getPrototypeOf(request) as object | null, descriptors) as HeldRequest
}

/** The parent's signal aborts when it is disposed, which takes every mount inside it along. */
function followParent(parent: MountContext | null | undefined, onAbort: () => void): () => void {
  if (parent === null || parent === undefined || parent.signal.aborted) return () => undefined
  parent.signal.addEventListener('abort', onAbort, { once: true })
  return () => {
    parent.signal.removeEventListener('abort', onAbort)
  }
}

/**
 * One attach: the context it created, whose scope root it placed, and the definition's own
 * mount. Once `detached`, nothing the definition calls back with reaches the host again.
 */
class Attempt {
  readonly context: MountContextHandle
  /** What the definition's `mount` returned, awaited by the attach and again by teardown. */
  readonly mounting: Promise<Mounted>
  /** Set once `mounting` resolved while the attempt was still attached. */
  mounted: Mounted | null = null
  detached = false
  /** The Widget inputs this attempt's definition was last given. */
  delivered: Inputs

  constructor(
    context: MountContextHandle,
    delivered: Inputs,
    mount: (attempt: Attempt) => Promise<Mounted>,
  ) {
    this.context = context
    this.delivered = delivered
    // Last, so every field a definition's synchronous callback reads already exists.
    this.mounting = mount(this)
  }
}

function isMountedWidget(mounted: Mounted): mounted is MountedWidget {
  return typeof (mounted as Partial<MountedWidget>).update === 'function'
}

/**
 * The operations one `MountController` drives: each attach builds a fresh attempt, `detach`
 * takes the current one off the page and queues its teardown, and `cleanup` waits for every
 * teardown still running. A superseded attempt, a mount disposed while pending and a failed
 * attach all leave through that one path.
 */
class DefinitionAttempts implements MountOperations<MountableDefinition> {
  readonly #request: HeldRequest
  readonly #fail: (error: unknown) => void
  readonly #teardowns = new Set<Promise<void>>()
  #attempt: Attempt | null = null
  /** The latest Widget inputs the host passed, whether or not a definition has them yet. */
  #inputs: Inputs

  constructor(request: MountRequest, fail: (error: unknown) => void) {
    this.#request = withoutFirstInputs(request)
    this.#fail = fail
    this.#inputs = request.kind === 'widget' ? request.inputs : {}
  }

  get context(): MountContext | null {
    return this.#attempt?.context.context ?? null
  }

  whenStable(): Promise<void> {
    return this.#attempt?.mounted?.whenStable?.() ?? Promise.resolve()
  }

  load(signal: AbortSignal): Promise<MountableDefinition> {
    const { runtime, definitionId, kind } = this.#request
    return resolveDefinition(runtime, definitionId, kind, signal)
  }

  async attach(definition: MountableDefinition, signal: AbortSignal): Promise<void> {
    // Never from inside the caller's stack: a retry after a mount failure reuses the loaded
    // definition and would otherwise mount synchronously from a host's render or commit.
    await Promise.resolve()
    signal.throwIfAborted()

    const attempt = this.#open(definition)
    const mounted = await attempt.mounting
    // Torn down while it mounted; its teardown disposes what just resolved.
    if (attempt.detached) return

    attempt.mounted = mounted
    // Inputs that changed while the mount was pending reach it once, as its first update.
    if (isMountedWidget(mounted) && !shallowEqual(this.#inputs, attempt.delivered)) {
      attempt.delivered = this.#inputs
      mounted.update(this.#inputs)
    }
  }

  detach(): void {
    const attempt = this.#attempt
    if (attempt === null) return
    this.#attempt = null

    attempt.detached = true
    attempt.context.context.scopeRoot.remove()

    const teardown = this.#tearDown(attempt).then(() => {
      this.#teardowns.delete(teardown)
    })
    this.#teardowns.add(teardown)
  }

  /** Teardowns report their own failures, so this only waits. */
  async cleanup(): Promise<void> {
    await Promise.all([...this.#teardowns])
  }

  update(inputs: Inputs): void {
    if (shallowEqual(inputs, this.#inputs)) return
    this.#inputs = inputs

    // A detached attempt is never the current one, so there is no `detached` to check here.
    const attempt = this.#attempt
    if (attempt === null || attempt.mounted === null) return
    if (!isMountedWidget(attempt.mounted)) return

    attempt.delivered = inputs
    try {
      attempt.mounted.update(inputs)
    } catch (error) {
      // `update` reports a rejected set through `onInputRejected`; a throw is a Widget that
      // can no longer run.
      this.#fail(error)
    }
  }

  #open(definition: MountableDefinition): Attempt {
    const { runtime, element, parent } = this.#request
    const ownerDocument = element.ownerDocument

    const context = createMountContext({
      runtime,
      definitionId: definition.id,
      ...withoutUndefined({ definitionVersion: definition.version }),
      kind: definition.kind,
      ...(this.#request.kind === 'app' ? { basePath: this.#request.basePath } : {}),
      depth: (parent?.depth ?? 0) + 1,
      document: ownerDocument,
    })

    // Inline rather than a class, because the framework ships no stylesheet.
    const target = ownerDocument.createElement('div')
    target.style.display = 'contents'
    const { scopeRoot } = context.context
    scopeRoot.appendChild(target)
    element.appendChild(scopeRoot)

    // Async, so a definition whose `mount` throws synchronously still yields a rejection.
    const attempt = new Attempt(
      context,
      this.#inputs,
      async current => await this.#mount(definition, target, current),
    )
    this.#attempt = attempt
    return attempt
  }

  #mount(
    definition: MountableDefinition,
    element: HTMLElement,
    attempt: Attempt,
  ): Promise<Mounted> {
    const { context } = attempt.context
    const onFailure = (error: unknown): void => {
      if (!attempt.detached) this.#fail(error)
    }

    if (definition.kind === 'app') return definition.mount({ element, context, onFailure })

    // A Widget definition, so a Widget request: `resolveDefinition` refused the other kind.
    const request = this.#request as HeldWidgetRequest
    const { onInputRejected } = request
    return definition.mount({
      element,
      context,
      inputs: attempt.delivered,
      emit: (output, payload) => {
        if (!attempt.detached) deliverOutput(request, definition, output, payload)
      },
      onFailure,
      ...(onInputRejected === undefined
        ? {}
        : {
            onInputRejected: (error: MfeError) => {
              if (!attempt.detached) onInputRejected(error)
            },
          }),
    })
  }

  /**
   * The definition empties its element before its context goes, and each step is attempted
   * whatever the other did. A mount that rejected has nothing to dispose, and its failure was
   * reported when the attempt failed. Never rejects: a failure is reported where it happens.
   */
  async #tearDown(attempt: Attempt): Promise<void> {
    // A definition still mounting is waited on below, and only its signal can end a mount that
    // would otherwise never settle; one already mounted is disposed before its signal aborts.
    if (attempt.mounted === null) attempt.context.abort()
    const mounted = await attempt.mounting.catch(() => null)

    try {
      if (mounted !== null) await mounted.dispose()
    } catch (error) {
      this.#reportTeardown(error, 'the teardown the definition runs when it is disposed')
    }

    try {
      await attempt.context.dispose()
    } catch (error) {
      this.#reportTeardown(error, 'the mount context disposal: registrations, telemetry, roots')
    }
  }

  #reportTeardown(error: unknown, where: string): void {
    const { runtime, definitionId, kind } = this.#request
    runtime.diagnostics.report(
      toMfeError(error, {
        code: 'dispose/failure',
        id: definitionId,
        operation: `dispose ${kind === 'app' ? 'App' : 'Widget'}`,
        repair: `Check ${where}. Other mounts are unaffected.`,
      }),
    )
  }
}

/** The provider already validated the payload; this checks only what the host declared. */
function deliverOutput(
  request: HeldWidgetRequest,
  definition: MountableWidgetDefinition,
  output: string,
  payload: unknown,
): void {
  const schema = outputPayloadSchema(request.consumerOutputs, output)
  if (schema === undefined) {
    request.onOutput(output, payload)
    return
  }

  const accepted = validateAgainstContract(schema, payload, {
    id: definition.id,
    ...withoutUndefined({ definitionVersion: definition.version }),
    direction: 'output',
    side: 'consumer',
    outputName: output,
  })
  // The consumer's contract is the consumer's to fix, so a mismatch is reported rather than
  // thrown into the provider's stack.
  if (!accepted.ok) {
    request.runtime.diagnostics.report(accepted.error, {
      context: { widget: definition.id, output },
    })
    return
  }
  request.onOutput(output, accepted.value)
}
