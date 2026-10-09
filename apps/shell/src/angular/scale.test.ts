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

/**
 * What the sheet sets `property` to on the element, or `''` when nothing does. The last matching
 * rule wins, which is the cascade here: every later rule is also the more specific one.
 */
function declared(id: string, property: string): string {
  const element = document.getElementById(id) as HTMLElement
  const rules = [...(document.styleSheets[0]?.cssRules ?? [])] as CSSStyleRule[]
  const values = rules
    .filter(rule => element.matches(rule.selectorText))
    .map(rule => rule.style.getPropertyValue(property))
    .filter(value => value !== '')
  return values.at(-1) ?? ''
}

function zoom(id: string): string {
  return declared(id, 'zoom')
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

  it('scales a popup in an Angular overlay root from the corner PrimeNG positioned', () => {
    page(`<div id="overlay" data-mfe-adapter="angular" data-mfe-overlay-root>
      <div id="below" style="transform-origin: center top; top: 300px; left: 40px"></div>
      <div id="above" style="transform-origin: center bottom; top: 200px; left: 40px"></div>
    </div>`)

    expect(zoom('overlay')).toBe('')
    expect(zoom('below')).toBe('')
    expect(declared('below', 'scale')).toBe('0.875')
    expect(declared('below', 'transform-origin')).toBe('left top')
    expect(declared('above', 'scale')).toBe('0.875')
    expect(declared('above', 'transform-origin')).toBe('left bottom')
  })

  it('zooms a dialog inside its mask, and scales it from its corner once dragged', () => {
    page(`<div data-mfe-adapter="angular" data-mfe-overlay-root>
      <div id="mask" class="p-dialog-mask"><div id="dialog"></div></div>
      <div class="p-dialog-mask"><div id="dragged" style="position: fixed; left: 90px"></div></div>
    </div>`)

    expect(declared('mask', 'scale')).toBe('')
    expect(zoom('mask')).toBe('')
    expect(zoom('dialog')).toBe('0.875')
    expect(zoom('dragged')).toBe('normal')
    expect(declared('dragged', 'scale')).toBe('0.875')
    expect(declared('dragged', 'transform-origin')).toBe('left top')
  })

  it('leaves a React overlay root alone', () => {
    page(`<div data-mfe-adapter="react" data-mfe-overlay-root><div id="popup"></div></div>`)

    expect(declared('popup', 'scale')).toBe('')
  })
})
