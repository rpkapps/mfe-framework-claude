/**
 * The style root: the seam a container's own bundle has into its mounts.
 *
 * A design system whose overlays portal out of the subtree needs a component
 * rendered by the *container's* copy of it. The components a mount renders read
 * their portal target from that copy's React context, and a shell running
 * another version holds a different module instance with a different context,
 * so an overlay wired up by the shell's copy would land outside the container's
 * scope and lose every utility that styles it.
 *
 * The framework cannot import that component itself: it does not know which
 * design system, and a framework package that depended on one would oblige
 * every container to. So the container's build generates it and attaches it to
 * the definition it exposes, and the mount renders it directly inside the scope
 * root with that mount's overlay container. It is generated plumbing at both
 * ends — an author neither writes it nor reads it.
 */

import type { ComponentType, ReactNode } from 'react'

import type { MfeDefinition } from './definition.ts'

export interface StyleRootProps {
  /** The mount's body-level overlay root, which overlays portal into. */
  readonly overlayContainer: HTMLElement
  readonly children: ReactNode
}

export type MfeStyleRoot = ComponentType<StyleRootProps>

/**
 * Keyed by symbol, so it is neither part of the definition's public shape nor
 * something a serialized descriptor or an `Object.keys` walk ever sees.
 */
const STYLE_ROOT = Symbol.for('@company/mfe.styleRoot')

/** The definition shape `withStyleRoot` produces, which only this file reads. */
interface StyleRootCarrier {
  readonly [STYLE_ROOT]?: MfeStyleRoot
}

/**
 * Returns a definition with the style root attached, leaving the original
 * alone: the generated entry exposes the result, and everything that recognises
 * a definition — the brand, the id, the kind — is carried over unchanged.
 */
export function withStyleRoot<Definition extends MfeDefinition>(
  definition: Definition,
  styleRoot: MfeStyleRoot,
): Definition {
  return { ...definition, [STYLE_ROOT]: styleRoot }
}

/** The attached style root, or nothing for a container that ships no CSS. */
export function styleRootOf(definition: MfeDefinition): MfeStyleRoot | undefined {
  return (definition as StyleRootCarrier)[STYLE_ROOT]
}
