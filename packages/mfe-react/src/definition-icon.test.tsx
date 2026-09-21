/** The renderer is the last gate before another origin's data reaches the document. */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { IconData } from '@company/mfe-core'

import { DefinitionIcon } from './definition-icon.tsx'

const OUTLINE: IconData = {
  viewBox: '0 0 32 20',
  attributes: { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' },
  node: [
    ['path', { d: 'M2 18 L16 2 L30 18' }],
    [
      'g',
      { transform: 'translate(0 1)' },
      [['rect', { x: '12', y: '10', width: '8', height: '8' }]],
    ],
  ],
}

function draw(icon: IconData, props: { readonly label?: string; readonly size?: number } = {}) {
  const { container } = render(<DefinitionIcon icon={icon} {...props} />)
  const svg = container.querySelector('svg')
  if (svg === null) throw new Error('nothing was drawn')
  return svg
}

describe('DefinitionIcon', () => {
  it('draws the icon’s own viewBox, not a size the host assumed', () => {
    expect(draw(OUTLINE).getAttribute('viewBox')).toBe('0 0 32 20')
  })

  it('sizes the box without touching what is drawn inside it', () => {
    const svg = draw(OUTLINE, { size: 40 })
    expect(svg.getAttribute('width')).toBe('40')
    expect(svg.getAttribute('viewBox')).toBe('0 0 32 20')
  })

  it('passes the root’s paint through, hyphenated the way SVG spells it', () => {
    const svg = draw(OUTLINE)
    expect(svg.getAttribute('stroke-width')).toBe('1.5')
    expect(svg.getAttribute('fill')).toBe('none')
  })

  it('keeps a group and the shapes it wraps', () => {
    const rect = draw(OUTLINE).querySelector('g > rect')
    expect(rect?.getAttribute('x')).toBe('12')
  })

  it('is decoration until it is named', () => {
    expect(draw(OUTLINE).getAttribute('aria-hidden')).toBe('true')

    const labelled = draw(OUTLINE, { label: 'Well head' })
    expect(labelled.getAttribute('aria-hidden')).toBeNull()
    expect(labelled.getAttribute('aria-label')).toBe('Well head')
  })

  it('drops a tag that is not a shape, wherever it is nested', () => {
    const svg = draw({
      viewBox: '0 0 24 24',
      node: [
        ['script', { d: 'ignored' }] as unknown as IconData['node'][number],
        ['g', {}, [['foreignObject', {}] as unknown as IconData['node'][number]]],
        ['circle', { cx: '12', cy: '12', r: '9' }],
      ],
    })

    expect(svg.querySelector('script')).toBeNull()
    expect(svg.querySelector('foreignObject')).toBeNull()
    expect(svg.querySelector('circle')).not.toBeNull()
  })
})
