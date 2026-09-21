/** The framework cannot import the design system, so the container's build attaches this (§17). */

import type { ComponentType, ReactNode } from 'react'

import type { MfeDefinition } from './definition.ts'

export interface StyleRootProps {
  readonly overlayContainer: HTMLElement
  readonly children: ReactNode
}

export type MfeStyleRoot = ComponentType<StyleRootProps>

/** A symbol key, so no serialized descriptor or `Object.keys` walk ever sees it. */
const STYLE_ROOT = Symbol.for('@company/mfe.styleRoot')

interface StyleRootCarrier {
  readonly [STYLE_ROOT]?: MfeStyleRoot
}

/** Returns a copy with the style root attached, leaving the original definition alone. */
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
