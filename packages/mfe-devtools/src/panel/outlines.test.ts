/**
 * What the outline overlay draws. jsdom measures nothing — every box is 0×0 — so the geometry is
 * tested through `unionOf` directly and the DOM reading through a stubbed `getBoundingClientRect`,
 * which is the only part of the browser this module depends on.
 */

import { afterEach, describe, expect, it } from 'vitest'

import {
  MOUNT_SELECTOR,
  intersectionOf,
  measureMount,
  readMountOutlines,
  unionOf,
} from './outlines.ts'

/** A box, in the shape the DOM reports one. */
function box(x: number, y: number, width: number, height: number): DOMRect {
  return new DOMRect(x, y, width, height)
}

/** jsdom lays nothing out, so each element is told what it occupies. */
function occupies(element: Element, rect: DOMRect): void {
  element.getBoundingClientRect = () => rect
}

/** Every element reports nothing until it is told otherwise, which is what a `display: contents` wrapper does. */
function render(html: string): HTMLElement {
  document.body.innerHTML = html
  for (const element of document.body.querySelectorAll('*')) {
    occupies(element, box(0, 0, 0, 0))
  }
  return document.body
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the box a set of boxes covers', () => {
  it('is the one that covers them all', () => {
    expect(unionOf([box(10, 20, 30, 40), box(100, 0, 10, 10)])).toEqual({
      x: 10,
      y: 0,
      width: 100,
      height: 60,
    })
  })

  it('ignores a box with no area, which would otherwise drag the union to an empty wrapper', () => {
    expect(unionOf([box(0, 0, 1000, 0), box(200, 100, 50, 50)])).toEqual({
      x: 200,
      y: 100,
      width: 50,
      height: 50,
    })
  })

  it('is nothing at all when nothing occupies space', () => {
    expect(unionOf([])).toBeUndefined()
    expect(unionOf([box(0, 0, 0, 0)])).toBeUndefined()
  })
})

describe('the box two boxes share', () => {
  it('is the overlap', () => {
    expect(intersectionOf(box(0, 0, 100, 100), box(50, 50, 100, 100))).toEqual({
      x: 50,
      y: 50,
      width: 50,
      height: 50,
    })
  })

  it('is nothing when they only touch, which is not a region anyone can see', () => {
    expect(intersectionOf(box(0, 0, 50, 50), box(50, 0, 50, 50))).toBeUndefined()
    expect(intersectionOf(box(0, 0, 50, 50), box(500, 500, 50, 50))).toBeUndefined()
  })
})

describe('measuring a mount', () => {
  it('is the union of what it renders, because the scope root itself generates no box', () => {
    const body = render(
      `<div data-mfe-scope="alert-panel" data-mfe-mount="m1" data-mfe-kind="widget">
         <header></header><section></section>
       </div>`,
    )

    occupies(body.querySelector('header')!, box(10, 10, 100, 20))
    occupies(body.querySelector('section')!, box(10, 30, 120, 70))

    expect(measureMount(body.querySelector(MOUNT_SELECTOR)!)).toEqual({
      x: 10,
      y: 10,
      width: 120,
      height: 90,
    })
  })

  it('stops at the first element that has a box, rather than measuring the whole subtree', () => {
    const body = render(
      `<div data-mfe-scope="w" data-mfe-mount="m1" data-mfe-kind="widget">
         <div class="outer"><div class="inner"></div></div>
       </div>`,
    )

    occupies(body.querySelector('.outer')!, box(0, 0, 200, 100))
    // Bigger than its own parent, which only a transform or an overflow can do; the parent wins.
    occupies(body.querySelector('.inner')!, box(0, 0, 900, 900))

    expect(measureMount(body.querySelector(MOUNT_SELECTOR)!)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    })
  })

  it('is cut down to what a scrolling ancestor still shows', () => {
    const body = render(
      `<div class="canvas" style="overflow: auto">
         <div data-mfe-scope="w" data-mfe-mount="m1" data-mfe-kind="widget"><p></p></div>
       </div>`,
    )

    occupies(body.querySelector('.canvas')!, box(0, 0, 400, 300))
    // Half of it is scrolled past the right edge of the canvas.
    occupies(body.querySelector('p')!, box(200, 0, 400, 100))

    expect(measureMount(body.querySelector(MOUNT_SELECTOR)!)).toEqual({
      x: 200,
      y: 0,
      width: 200,
      height: 100,
    })
  })

  it('is nothing for a mount scrolled entirely out of the region holding it', () => {
    const body = render(
      `<div class="canvas" style="overflow: auto">
         <div data-mfe-scope="w" data-mfe-mount="m1" data-mfe-kind="widget"><p></p></div>
       </div>`,
    )

    occupies(body.querySelector('.canvas')!, box(0, 0, 400, 300))
    occupies(body.querySelector('p')!, box(900, 0, 100, 100))

    expect(measureMount(body.querySelector(MOUNT_SELECTOR)!)).toBeUndefined()
  })

  it('is nothing for a mount that renders nothing', () => {
    const body = render(`<div data-mfe-scope="w" data-mfe-mount="m1" data-mfe-kind="widget"></div>`)

    expect(measureMount(body.querySelector(MOUNT_SELECTOR)!)).toBeUndefined()
  })
})

describe('reading the page', () => {
  it('reports the definition, the kind and how deep the mount is nested', () => {
    const body = render(
      `<div data-mfe-scope="operations" data-mfe-mount="app-1" data-mfe-kind="app">
         <main>
           <div data-mfe-scope="alert-panel" data-mfe-mount="w-1" data-mfe-kind="widget">
             <article></article>
           </div>
         </main>
       </div>`,
    )

    occupies(body.querySelector('main')!, box(0, 0, 800, 600))
    occupies(body.querySelector('article')!, box(40, 40, 300, 200))

    expect(readMountOutlines(document)).toEqual([
      {
        key: 'app-1',
        id: 'operations',
        kind: 'app',
        depth: 0,
        rect: { x: 0, y: 0, width: 800, height: 600 },
      },
      {
        key: 'w-1',
        id: 'alert-panel',
        kind: 'widget',
        depth: 1,
        rect: { x: 40, y: 40, width: 300, height: 200 },
      },
    ])
  })

  it('leaves out the body-level overlay root, which carries a mount it is not', () => {
    const body = render(
      `<div data-mfe-scope="alert-panel" data-mfe-mount="w-1" data-mfe-kind="widget">
         <article></article>
       </div>
       <div data-mfe-scope="alert-panel" data-mfe-mount="w-1" data-mfe-overlay-root>
         <div class="popover"></div>
       </div>`,
    )

    occupies(body.querySelector('article')!, box(0, 0, 100, 100))
    occupies(body.querySelector('.popover')!, box(500, 500, 200, 200))

    expect(readMountOutlines(document).map(outline => outline.rect)).toEqual([
      { x: 0, y: 0, width: 100, height: 100 },
    ])
  })

  it('rounds to whole pixels, because half of one is a blurred border rather than information', () => {
    const body = render(
      `<div data-mfe-scope="w" data-mfe-mount="m1" data-mfe-kind="widget"><p></p></div>`,
    )

    occupies(body.querySelector('p')!, box(10.4, 10.6, 99.5, 50.2))

    expect(readMountOutlines(document)[0]?.rect).toEqual({ x: 10, y: 11, width: 100, height: 50 })
  })

  it('reports a mount the framework stamped without a kind rather than dropping it', () => {
    const body = render(`<div data-mfe-scope="w" data-mfe-mount="m1"><p></p></div>`)

    occupies(body.querySelector('p')!, box(0, 0, 10, 10))

    expect(readMountOutlines(document)[0]?.kind).toBe('unknown')
  })
})
