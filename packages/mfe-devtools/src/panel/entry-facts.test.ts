/**
 * Reading a published contract, which is the part of the registry view that
 * can be wrong about data it did not produce.
 *
 * A descriptor is emitted by a build the host does not control, so `inputs` is
 * only known to be *some* JSON value: the cases below are the shapes that
 * validate as an entry and still cannot be read as a schema. A developer tool
 * that threw on one of them would take the page down while reporting on it.
 */

import { describe, expect, it } from 'vitest'

import type { NeutralRegistryEntry } from '@company/mfe-react'
import { factsOf } from './entry-facts.ts'

/** The four fields every entry has; each case adds only what it is about. */
function entry(rest: Partial<NeutralRegistryEntry> = {}): NeutralRegistryEntry {
  return {
    id: 'alert-panel',
    definitionKind: 'widget',
    adapter: 'react',
    manifestUrl: 'http://localhost:3003/mf-manifest.json',
    ...rest,
  }
}

describe('the facts an entry states about itself', () => {
  it('has nothing to say about an app that exposes nothing', () => {
    expect(factsOf(entry({ definitionKind: 'app' }))).toEqual([])
  })

  it('names a capability with the route it opens', () => {
    const facts = factsOf(
      entry({
        definitionKind: 'app',
        capabilities: [{ name: 'settings', label: 'Operations settings', path: '/settings' }],
      }),
    )

    expect(facts).toEqual([{ label: 'opens', values: ['settings → /settings'] }])
  })

  it('marks an optional input, and leaves a required one bare', () => {
    const facts = factsOf(
      entry({
        contract: {
          events: [],
          inputs: {
            type: 'object',
            properties: { alertId: { type: 'string' }, severity: { type: 'string' } },
            required: ['alertId'],
          },
        },
      }),
    )

    expect(facts).toEqual([{ label: 'inputs', values: ['alertId', 'severity?'] }])
  })

  it('keeps events in the order they were declared', () => {
    const facts = factsOf(entry({ contract: { events: ['acknowledged', 'dismissed'] } }))

    expect(facts).toEqual([{ label: 'events', values: ['acknowledged', 'dismissed'] }])
  })

  it('says which loader an entry goes through only when it is the unusual one', () => {
    expect(factsOf(entry({ adapter: 'react' }))).toEqual([])
    expect(factsOf(entry({ adapter: 'legacy-angular' }))).toEqual([
      { label: 'adapter', values: ['legacy-angular'] },
    ])
  })

  it('reads a schema with no properties as no inputs, rather than as a blank row', () => {
    expect(factsOf(entry({ contract: { events: [], inputs: { type: 'object' } } }))).toEqual([])
  })

  it('survives a `properties` that is not an object', () => {
    expect(
      factsOf(entry({ contract: { events: [], inputs: { properties: ['alertId'] } } })),
    ).toEqual([])
  })

  it('survives a `required` that is not a list of names', () => {
    const facts = factsOf(
      entry({
        contract: { events: [], inputs: { properties: { alertId: {} }, required: 'alertId' } },
      }),
    )

    expect(facts).toEqual([{ label: 'inputs', values: ['alertId?'] }])
  })
})
