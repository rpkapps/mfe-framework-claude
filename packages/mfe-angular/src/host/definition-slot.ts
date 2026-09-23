/**
 * Hosting one definition at a time in an element an Angular host renders: resolve it, derive its
 * mount context, give it a scope root of its own and let it mount itself. Because the definition
 * mounts itself, the same slot hosts an Angular definition and one any other adapter built.
 *
 * Every attempt is numbered, so an attempt a retry or a change of id has overtaken never mounts
 * over its successor; one that finishes mounting anyway is disposed as soon as it does.
 */

import { signal, type Signal } from '@angular/core'
import { toMfeError, type DefinitionKind, type MfeError } from '@company/mfe-core'
import {
  applyScopeAttributes,
  createMountContext,
  type MfeHostRuntime,
  type MountableDefinition,
  type MountContext,
  type MountContextHandle,
} from '@company/mfe-runtime'

export type SlotStatus = 'loading' | 'mounted' | 'failed'

interface Disposable {
  dispose(): Promise<void>
}

export interface SlotRequest<D extends MountableDefinition, M extends Disposable> {
  readonly id: string
  readonly kind: DefinitionKind
  readonly depth: number
  /** The App's boundary; a Widget has none. */
  readonly basePath?: string
  readonly load: () => Promise<D>
  readonly mount: (definition: D, element: HTMLElement, context: MountContext) => Promise<M>
  /** Runs once the definition has mounted, for state that changed while it was mounting. */
  readonly mounted?: (mounted: M) => void
}

interface Attempt<M extends Disposable> {
  readonly handle: MountContextHandle
  readonly scope: HTMLElement
  /** Inside the scope root; the definition renders into it. */
  readonly element: HTMLElement
  mounted: M | null
  closed: boolean
}

export class DefinitionSlot<M extends Disposable> {
  readonly #runtime: MfeHostRuntime
  readonly #container: HTMLElement
  readonly #onFailed: (error: MfeError) => void
  readonly #status = signal<SlotStatus>('loading')
  readonly status: Signal<SlotStatus> = this.#status.asReadonly()
  #generation = 0
  #current: Attempt<M> | null = null

  constructor(
    runtime: MfeHostRuntime,
    container: HTMLElement,
    onFailed: (error: MfeError) => void,
  ) {
    this.#runtime = runtime
    this.#container = container
    this.#onFailed = onFailed
  }

  /** The live mount, once there is one. */
  get mounted(): M | null {
    return this.#current?.mounted ?? null
  }

  /** Tears down whatever is hosted and starts a fresh attempt. */
  start<D extends MountableDefinition>(request: SlotRequest<D, M>): void {
    this.#generation += 1
    void this.#close()
    void this.#run(this.#generation, request)
  }

  stop(): void {
    this.#generation += 1
    void this.#close()
  }

  async #run<D extends MountableDefinition>(
    generation: number,
    request: SlotRequest<D, M>,
  ): Promise<void> {
    this.#status.set('loading')

    try {
      const definition = await request.load()
      if (generation !== this.#generation) return

      const attempt = this.#open(definition, request)
      const mounted = await request.mount(definition, attempt.element, attempt.handle.context)

      if (attempt.closed) {
        await mounted.dispose()
        return
      }
      attempt.mounted = mounted
      this.#status.set('mounted')
      request.mounted?.(mounted)
    } catch (error) {
      if (generation !== this.#generation) return
      await this.#close()
      this.#status.set('failed')
      this.#onFailed(
        toMfeError(error, {
          code: 'mount/failure',
          id: request.id,
          operation: `mount ${request.kind === 'app' ? 'App' : 'Widget'}`,
        }),
      )
    }
  }

  #open(
    definition: MountableDefinition,
    request: Pick<SlotRequest<MountableDefinition, M>, 'kind' | 'basePath' | 'depth'>,
  ): Attempt<M> {
    const handle = createMountContext({
      runtime: this.#runtime,
      definitionId: definition.id,
      ...(definition.version === undefined ? {} : { definitionVersion: definition.version }),
      kind: request.kind,
      ...(request.basePath === undefined ? {} : { basePath: request.basePath }),
      depth: request.depth,
      document: this.#container.ownerDocument,
    })

    // The scope root is ours; the element inside it is the one the definition renders into.
    const scope = this.#container.ownerDocument.createElement('div')
    applyScopeAttributes(scope, {
      definitionId: definition.id,
      mountToken: handle.context.mountToken,
      kind: request.kind,
    })
    const element = this.#container.ownerDocument.createElement('div')
    element.style.display = 'contents'
    scope.appendChild(element)
    this.#container.appendChild(scope)

    const attempt: Attempt<M> = { handle, scope, element, mounted: null, closed: false }
    this.#current = attempt
    return attempt
  }

  /** The mount empties its element first, then the context goes, then the scope root. */
  async #close(): Promise<void> {
    const attempt = this.#current
    if (attempt === null) return
    this.#current = null
    attempt.closed = true

    await attempt.mounted?.dispose()
    await attempt.handle.dispose()
    attempt.scope.remove()
  }
}
