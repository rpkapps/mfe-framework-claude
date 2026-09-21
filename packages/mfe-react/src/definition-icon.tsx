/**
 * Draws a registry entry's icon. The framework owns this rather than any one host, because the
 * catalogue, the developer tools and a shell's own chrome all render the same entries.
 *
 * `IconData` arrives over the network from another origin, so the tag of every shape is checked
 * here as well as at the registry boundary: the boundary decides the record is well formed, this
 * decides what is allowed to reach the document.
 */

import { createElement, type ReactElement, type ReactNode, type SVGProps } from 'react'
import type { IconData, IconNode } from '@company/mfe-core'

/** What an icon may draw with. Anything else is dropped rather than rendered. */
const TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g'])

/** SVG attributes React spells in camel case; everything else passes through unchanged. */
const REACT_NAMES: Readonly<Record<string, string>> = {
  'clip-rule': 'clipRule',
  'fill-opacity': 'fillOpacity',
  'fill-rule': 'fillRule',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-dashoffset': 'strokeDashoffset',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-opacity': 'strokeOpacity',
  'stroke-width': 'strokeWidth',
  'vector-effect': 'vectorEffect',
}

export interface DefinitionIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  readonly icon: IconData
  /** Edge length in pixels; the icon's own `viewBox` decides what is drawn inside it. */
  readonly size?: number
  /** Naming the icon makes it content; without a label it is decoration and stays hidden. */
  readonly label?: string
}

export function DefinitionIcon({
  icon,
  size = 24,
  label,
  ...props
}: DefinitionIconProps): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={icon.viewBox}
      width={size}
      height={size}
      {...toReactAttributes(icon.attributes ?? {})}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      {...props}
    >
      {renderNodes(icon.node)}
    </svg>
  )
}

function renderNodes(nodes: readonly IconNode[]): readonly ReactNode[] {
  const rendered: ReactNode[] = []

  nodes.forEach(([tag, attributes, children], index) => {
    if (!TAGS.has(tag)) return
    rendered.push(
      createElement(
        tag,
        { key: `${tag}-${String(index)}`, ...toReactAttributes(attributes) },
        children === undefined ? undefined : renderNodes(children),
      ),
    )
  })

  return rendered
}

function toReactAttributes(
  attributes: Readonly<Record<string, string>>,
): Record<string, string | number> {
  const result: Record<string, string | number> = {}
  for (const [name, value] of Object.entries(attributes)) {
    result[REACT_NAMES[name] ?? name] = value
  }
  return result
}
