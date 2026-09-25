/**
 * The conversation's A2UI surfaces, as one external store: the render tool writes the agent's
 * messages into it, an input writes the user's value into its surface's data model, and the
 * transcript draws a surface where the call that created it sits.
 */

import { applyMessages, setAt, type A2uiError, type JsonValue, type Surfaces } from './model.ts'

export class A2uiSurfaces {
  #surfaces: Surfaces = new Map()
  /** The call that created each surface, where the transcript draws it. */
  readonly #createdBy = new Map<string, string>()
  readonly #listeners = new Set<() => void>()

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  readonly getSnapshot = (): Surfaces => this.#surfaces

  /** The call a surface belongs to, so a later call that updates it is drawn as a note. */
  createdBy(surfaceId: string): string | undefined {
    return this.#createdBy.get(surfaceId)
  }

  /** Applies the messages, or nothing when one is refused or `drawn` would be left without a root. */
  apply(
    toolCallId: string,
    messages: readonly unknown[],
    catalogue: ReadonlySet<string>,
    drawn?: string,
  ): A2uiError | undefined {
    const applied = applyMessages(this.#surfaces, messages, catalogue)
    if ('error' in applied) return applied.error
    const surface = drawn === undefined ? undefined : applied.surfaces.get(drawn)
    if (surface !== undefined && !surface.components.has('root')) {
      return {
        code: 'VALIDATION_FAILED',
        surfaceId: surface.surfaceId,
        path: '/components',
        message: 'One component must have the id "root".',
      }
    }
    for (const surfaceId of applied.surfaces.keys()) {
      if (!this.#createdBy.has(surfaceId)) this.#createdBy.set(surfaceId, toolCallId)
    }
    this.#set(applied.surfaces)
    return undefined
  }

  /** A two-way input's value, written at once into its surface's data model. */
  write(surfaceId: string, path: string, value: JsonValue): void {
    const surface = this.#surfaces.get(surfaceId)
    if (surface === undefined) return
    this.#set(
      new Map(this.#surfaces).set(surfaceId, {
        ...surface,
        data: setAt(surface.data, path, value),
      }),
    )
  }

  clear(): void {
    this.#createdBy.clear()
    this.#set(new Map())
  }

  #set(surfaces: Surfaces): void {
    this.#surfaces = surfaces
    for (const listener of this.#listeners) listener()
  }
}
