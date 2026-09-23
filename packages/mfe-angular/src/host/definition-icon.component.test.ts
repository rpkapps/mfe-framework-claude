import { Component } from '@angular/core'
import type { IconData } from '@company/mfe-core'
import { describe, expect, it } from 'vitest'

import { createHostApplication, renderInHost } from '../testing/index.ts'
import { MfeDefinitionIconComponent } from './definition-icon.component.ts'

const chart: IconData = {
  viewBox: '0 0 16 16',
  attributes: { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' },
  node: [
    ['path', { d: 'M2 14h12' }],
    ['g', { 'stroke-linecap': 'round' }, [['rect', { x: '3', y: '6', width: '2', height: '6' }]]],
  ],
}

let shown: IconData = chart
let label: string | undefined

@Component({
  selector: 'test-icon-host',
  imports: [MfeDefinitionIconComponent],
  template: '<mfe-definition-icon [icon]="icon" [size]="20" [label]="label" />',
})
class IconHostComponent {
  readonly icon = shown
  readonly label = label
}

async function draw(icon: IconData, name?: string): Promise<SVGSVGElement> {
  shown = icon
  label = name
  const appRef = await createHostApplication(null)
  const { element } = await renderInHost(appRef, IconHostComponent)
  const svg = element.querySelector('svg')
  if (!svg) throw new Error('no svg was drawn')
  return svg
}

describe('<mfe-definition-icon>', () => {
  it('draws the icon’s own view box at the requested size, with its attributes as written', async () => {
    const svg = await draw(chart)

    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(svg.getAttribute('width')).toBe('20')
    expect(svg.getAttribute('height')).toBe('20')
    expect(svg.getAttribute('stroke-width')).toBe('1.5')
    expect(svg.querySelector('g')?.getAttribute('stroke-linecap')).toBe('round')
    expect(svg.querySelector('g > rect')?.getAttribute('height')).toBe('6')
  })

  it('stays decoration until it is named', async () => {
    expect((await draw(chart)).getAttribute('aria-hidden')).toBe('true')

    const named = await draw(chart, 'Reports')
    expect(named.getAttribute('role')).toBe('img')
    expect(named.getAttribute('aria-label')).toBe('Reports')
    expect(named.hasAttribute('aria-hidden')).toBe(false)
  })

  it('drops any shape outside the allowlist, at any depth', async () => {
    const svg = await draw({
      viewBox: '0 0 16 16',
      node: [
        ['script', { src: 'https://evil.example/x.js' }],
        [
          'g',
          {},
          [
            ['foreignObject', {}],
            ['circle', { r: '2' }],
          ],
        ],
      ],
    })

    expect(svg.querySelector('script')).toBeNull()
    expect(svg.querySelector('foreignObject')).toBeNull()
    expect(svg.querySelector('g > circle')?.getAttribute('r')).toBe('2')
  })

  it('drops attributes that would run or fetch something, and names the DOM would refuse', async () => {
    const svg = await draw({
      viewBox: '0 0 16 16',
      node: [
        ['path', { d: 'M0 0', onload: 'alert(1)', href: 'javascript:alert(1)', 'bad name': 'x' }],
      ],
    })

    const path = svg.querySelector('path')
    expect(path?.getAttribute('d')).toBe('M0 0')
    expect(path?.getAttributeNames()).toEqual(['d'])
  })
})
