/**
 * Where a docked panel sits, and which way its handle drags.
 */

import { describe, expect, it } from 'vitest'

import { dockStyle, handleSide, isHorizontal, SIDES, sizeFromPointer } from './dock.ts'

describe('the docked box', () => {
  it('spans the full width and takes a height when docked bottom', () => {
    expect(dockStyle('bottom', 420)).toEqual({
      bottom: 0,
      left: 0,
      right: 0,
      height: '420px',
    })
  })

  it('spans the full height and takes a width when docked right', () => {
    expect(dockStyle('right', 360)).toEqual({
      top: 0,
      bottom: 0,
      right: 0,
      width: '360px',
    })
  })

  it('pins to the edge it is docked to, never the opposite one', () => {
    expect(dockStyle('top', 300)).toMatchObject({ top: 0 })
    expect(dockStyle('left', 300)).toMatchObject({ left: 0 })
  })

  it('sizes by height on the horizontal sides and by width on the vertical ones', () => {
    expect(SIDES.filter(isHorizontal)).toEqual(['top', 'bottom'])
  })
})

describe('the resize handle', () => {
  it('sits on the edge facing the page, not the one against the viewport', () => {
    expect(handleSide('bottom')).toBe('top')
    expect(handleSide('top')).toBe('bottom')
    expect(handleSide('left')).toBe('right')
    expect(handleSide('right')).toBe('left')
  })

  it('grows a bottom panel as the pointer moves up', () => {
    expect(sizeFromPointer('bottom', 600, 1000)).toBe(400)
    expect(sizeFromPointer('bottom', 400, 1000)).toBe(600)
  })

  it('grows a top panel as the pointer moves down', () => {
    expect(sizeFromPointer('top', 400, 1000)).toBe(400)
  })

  it('measures a left panel from the left edge and a right one from the right', () => {
    expect(sizeFromPointer('left', 320, 1440)).toBe(320)
    expect(sizeFromPointer('right', 320, 1440)).toBe(1120)
  })
})
