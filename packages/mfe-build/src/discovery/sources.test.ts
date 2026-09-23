import { writeFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { cleanupContainers, createContainer, entryOf } from '../testing/fixtures.ts'
import { createSourceCache } from './sources.ts'

afterEach(cleanupContainers)

const MODULE = "export const label = 'Orders'\n"

describe('the sources one plan reads', () => {
  it('parses a file once however many readers ask for it', () => {
    const file = entryOf(createContainer({ 'src/mfe.ts': MODULE }))
    const sources = createSourceCache()()

    expect(sources.parse(file)).toBe(sources.parse(file))
  })

  it('reads a file once per plan, so a reader sees what the plan started with', () => {
    const file = entryOf(createContainer({ 'src/mfe.ts': MODULE }))
    const sources = createSourceCache()()

    const first = sources.read(file)
    writeFileSync(file, "export const label = 'Invoices'\n")

    expect(sources.read(file)).toBe(first)
    expect(sources.parse(file).text).toBe(first)
  })
})

describe('the sources across plans', () => {
  it('keeps the syntax tree of a file whose text is unchanged', () => {
    const file = entryOf(createContainer({ 'src/mfe.ts': MODULE }))
    const nextPlan = createSourceCache()

    const first = nextPlan().parse(file)

    expect(nextPlan().parse(file)).toBe(first)
  })

  it('parses a file again once its text changes, whatever its size', () => {
    const file = entryOf(createContainer({ 'src/mfe.ts': MODULE }))
    const nextPlan = createSourceCache()

    const first = nextPlan().parse(file)
    // The same length, so only the text itself tells the edit apart.
    writeFileSync(file, "export const label = 'Ordres'\n")
    const second = nextPlan().parse(file)

    expect(second).not.toBe(first)
    expect(second.text).toContain('Ordres')
  })

  it('parses a file again when a plan in between did not read it', () => {
    const file = entryOf(createContainer({ 'src/mfe.ts': MODULE }))
    const nextPlan = createSourceCache()

    const first = nextPlan().parse(file)
    nextPlan()

    expect(nextPlan().parse(file)).not.toBe(first)
  })
})
