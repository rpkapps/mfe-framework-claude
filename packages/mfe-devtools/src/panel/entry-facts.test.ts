/**
 * An entry is emitted by a build the host does not control, so `inputs` is only known to be
 * *some* JSON value: the cases below are the shapes that validate as an entry and still cannot be
 * read as a schema.
 */

import { describe, expect, it } from 'vitest'

import type { RegistryEntry } from '@company/mfe-react'
import { factsOf } from './entry-facts.ts'

/** The four fields every entry has; each case adds only what it is about. */
function entry(rest: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: 'alert-panel',
    definitionKind: 'widget',
    adapter: 'react',
    manifestUrl: 'http://localhost:3003/mf-manifest.json',
    ...rest,
  }
}

/** Every entry says which adapter read it, last, so each case ends with this one. */
const readByReact = { label: 'adapter', values: ['react'] }

describe('the facts an entry states about itself', () => {
  it('names only its adapter for an app that exposes nothing', () => {
    expect(factsOf(entry({ definitionKind: 'app' }))).toEqual([readByReact])
  })

  it('names a capability with the route it opens', () => {
    const facts = factsOf(
      entry({
        definitionKind: 'app',
        capabilities: [{ name: 'settings', label: 'Operations settings', path: '/settings' }],
      }),
    )

    expect(facts).toEqual([{ label: 'opens', values: ['settings → /settings'] }, readByReact])
  })

  it('marks an optional input, and leaves a required one bare', () => {
    const facts = factsOf(
      entry({
        contract: {
          inputSchema: {
            type: 'object',
            properties: { alertId: { type: 'string' }, severity: { type: 'string' } },
            required: ['alertId'],
          },
        },
      }),
    )

    expect(facts).toEqual([{ label: 'inputs', values: ['alertId', 'severity?'] }, readByReact])
  })

  it('keeps outputs in the order they were declared', () => {
    const facts = factsOf(
      entry({
        contract: {
          outputSchema: { type: 'object', properties: { acknowledged: {}, dismissed: {} } },
        },
      }),
    )

    expect(facts).toEqual([
      { label: 'outputs', values: ['acknowledged', 'dismissed'] },
      readByReact,
    ])
  })

  /** No adapter is the usual one: the shell lists each, and none is assumed. */
  it('says which adapter read the entry, whichever it is', () => {
    expect(factsOf(entry({ adapter: 'react' }))).toEqual([readByReact])
    expect(factsOf(entry({ adapter: 'angular' }))).toEqual([
      { label: 'adapter', values: ['angular'] },
    ])
    expect(factsOf(entry({ adapter: 'legacy-angular' }))).toEqual([
      { label: 'adapter', values: ['legacy-angular'] },
    ])
  })

  it('reads a schema with no properties as no inputs, rather than as a blank row', () => {
    expect(factsOf(entry({ contract: { inputSchema: { type: 'object' } } }))).toEqual([readByReact])
  })

  it('survives a `properties` that is not an object', () => {
    expect(factsOf(entry({ contract: { inputSchema: { properties: ['alertId'] } } }))).toEqual([
      readByReact,
    ])
  })

  it('survives a `required` that is not a list of names', () => {
    const facts = factsOf(
      entry({
        contract: { inputSchema: { properties: { alertId: {} }, required: 'alertId' } },
      }),
    )

    expect(facts).toEqual([{ label: 'inputs', values: ['alertId?'] }, readByReact])
  })
})
