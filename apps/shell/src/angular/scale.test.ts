// @vitest-environment jsdom
/**
 * The scale rules read only the attributes the runtime puts on a mount's roots, so plain elements
 * carrying them stand in for mounts. jsdom computes no `zoom`, so each element is matched against
 * the sheet's own selectors instead.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

const styles = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'scale.css'), 'utf8')

function page(html: string): void {
  document.head.innerHTML = `<style>${styles}</style>`
  document.body.innerHTML = html
}

/** The `zoom` of the rule that matches, or `''` when none does. */
function zoom(id: string): string {
  const element = document.getElementById(id) as HTMLElement
  const rules = [...(document.styleSheets[0]?.cssRules ?? [])] as CSSStyleRule[]
  const matching = rules.filter(rule => element.matches(rule.selectorText))
  expect(matching.length).toBeLessThanOrEqual(1)
  return matching[0]?.style.getPropertyValue('zoom') ?? ''
}

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

describe('Angular scale', () => {
  it('scales an Angular mount and leaves a React one alone', () => {
    page(`<div id="angular" data-mfe-adapter="angular"></div>
      <div id="react" data-mfe-adapter="react"></div>`)

    expect(zoom('angular')).toBe('0.875')
    expect(zoom('react')).toBe('')
  })

  it('scales an Angular Widget inside an Angular App only once', () => {
    page(`<div id="app" data-mfe-adapter="angular">
      <div id="widget" data-mfe-adapter="angular"></div></div>`)

    expect(zoom('app')).toBe('0.875')
    expect(zoom('widget')).toBe('')
  })

  it('scales a React Widget inside an Angular App back, and nothing inside that', () => {
    page(`<div data-mfe-adapter="angular"><div id="widget" data-mfe-adapter="react">
      <div id="nested" data-mfe-adapter="react"></div></div></div>`)

    // The value as jsdom serialises `calc(1 / 0.875)`.
    expect(zoom('widget')).toBe('calc(1.14286)')
    expect(zoom('nested')).toBe('')
  })

  it('leaves an Angular overlay root at full scale', () => {
    page(`<div id="overlay" data-mfe-adapter="angular" data-mfe-overlay-root></div>`)

    expect(zoom('overlay')).toBe('')
  })
})
