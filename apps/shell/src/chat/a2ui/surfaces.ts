/**
 * The conversation's A2UI surfaces, as one external store: the render tool writes the agent's
 * messages into it, an input writes the user's value into its surface's data model, and the
 * transcript draws a surface where the call that created it sits.
 */

import { Store } from '../panel.ts'

import {
  applyMessages,
  drawnCount,
  isReady,
  MAX_DRAWN,
  setAt,
  type A2uiError,
  type JsonValue,
  type Surface,
  type Surfaces,
} from './model.ts'

/** What one call did to a surface: enough to undo it. */
interface Change {
  readonly toolCallId: string
  readonly before: Surface | undefined
  readonly createdBy: string | undefined
}

export class A2uiSurfaces extends Store<Surfaces> {
  /** The call that created each surface, where the transcript draws it. */
  readonly #createdBy = new Map<string, string>()
  /** Each surface's changes, oldest first, so a call that leaves the history can be undone. */
  readonly #changes = new Map<string, Change[]>()

  constructor() {
    super(new Map())
  }

  /** The call a surface belongs to, so a later call that updates it is drawn as a note. */
  createdBy(surfaceId: string): string | undefined {
    return this.#createdBy.get(surfaceId)
  }

  /**
   * Applies the messages, or nothing when one is refused, `drawn` would be left without a root or
   * a surface they change would draw more than `MAX_DRAWN` components.
   */
  apply(
    toolCallId: string,
    messages: readonly unknown[],
    catalogue: ReadonlySet<string>,
    drawn?: string,
  ): A2uiError | undefined {
    const before = this.getSnapshot()
    const applied = applyMessages(before, messages, catalogue)
    if ('error' in applied) return applied.error
    const surface = drawn === undefined ? undefined : applied.surfaces.get(drawn)
    if (surface !== undefined && !isReady(surface)) {
      return {
        code: 'VALIDATION_FAILED',
        surfaceId: surface.surfaceId,
        path: '/components',
        message: 'One component must have the id "root".',
      }
    }
    for (const [surfaceId, next] of applied.surfaces) {
      if (before.get(surfaceId) === next || !isReady(next)) continue
      if (drawnCount(next) > MAX_DRAWN) {
        return {
          code: 'VALIDATION_FAILED',
          surfaceId,
          path: '/components',
          message: `The surface would draw more than ${String(MAX_DRAWN)} components. Name each id once in a list, and repeat a template over fewer items.`,
        }
      }
    }
    for (const surfaceId of new Set([...before.keys(), ...applied.surfaces.keys()])) {
      if (before.get(surfaceId) === applied.surfaces.get(surfaceId)) continue
      const changes = this.#changes.get(surfaceId) ?? []
      changes.push({
        toolCallId,
        before: before.get(surfaceId),
        createdBy: this.#createdBy.get(surfaceId),
      })
      this.#changes.set(surfaceId, changes)
    }
    // A surface is drawn where the call that created it sits: one created again moves to the
    // new call, and a deleted one is drawn nowhere.
    for (const surfaceId of this.#createdBy.keys()) {
      if (!applied.surfaces.has(surfaceId)) this.#createdBy.delete(surfaceId)
    }
    for (const surfaceId of applied.created) this.#createdBy.set(surfaceId, toolCallId)
    this.update(() => applied.surfaces)
    return undefined
  }

  /** A two-way input's value, written at once into its surface's data model. */
  write(surfaceId: string, path: string, value: JsonValue): void {
    this.update(surfaces => {
      const surface = surfaces.get(surfaceId)
      if (surface === undefined) return surfaces
      return new Map(surfaces).set(surfaceId, {
        ...surface,
        data: setAt(surface.data, path, value),
      })
    })
  }

  /**
   * Undoes what the calls no longer in the history did, once Ask again or an edit has cut them: a
   * surface such a call created goes, so the call that replaces it creates it anew, and one it
   * changed goes back to how it was before that call, with what the user entered in it since.
   */
  prune(calls: ReadonlySet<string>): void {
    const next = new Map(this.getSnapshot())
    let changed = false
    for (const [surfaceId, changes] of this.#changes) {
      const gone = changes.findIndex(change => !calls.has(change.toolCallId))
      const undone = changes[gone]
      if (undone === undefined) continue
      changed = true
      if (undone.before === undefined) next.delete(surfaceId)
      else next.set(surfaceId, undone.before)
      if (undone.createdBy === undefined) this.#createdBy.delete(surfaceId)
      else this.#createdBy.set(surfaceId, undone.createdBy)
      if (gone === 0) this.#changes.delete(surfaceId)
      else changes.splice(gone)
    }
    if (changed) this.update(() => next)
  }

  clear(): void {
    this.#createdBy.clear()
    this.#changes.clear()
    this.update(() => new Map())
  }
}
