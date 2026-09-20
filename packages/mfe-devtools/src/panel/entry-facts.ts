/**
 * What an accepted entry has to say about itself, as label/value pairs.
 *
 * The registry view used to print these as a row of badges — a capability, an
 * input name and an event name all rendered as the same pill, told apart only
 * by colour. Four badges reading `alertId`, `severity`, `acknowledged`,
 * `dismissed` are not four facts, they are one puzzle: nothing on screen says
 * which two are inputs and which two are events. Labelling them is the whole
 * fix, and once they are labelled they do not need to be badges at all.
 *
 * The labels are the descriptor's own words — `inputs` and `events` are the two
 * fields of `PublishedWidgetContract` — so what is read here maps onto what is
 * published without translation.
 *
 * Pure, and separate from the component, because reading a published JSON
 * Schema is the part with edge cases: `properties` may be absent, `required`
 * may be any JSON value at all, and neither can be trusted to be an object
 * just because the entry validated.
 */

import type { NeutralRegistryEntry } from '@company/mfe-react'

export interface EntryFact {
  readonly label: string
  /** Rendered as one line, space separated. Already in declaration order. */
  readonly values: readonly string[]
}

export function factsOf(entry: NeutralRegistryEntry): readonly EntryFact[] {
  const facts: EntryFact[] = []

  const capabilities = entry.capabilities ?? []
  if (capabilities.length > 0) {
    facts.push({
      label: 'opens',
      values: capabilities.map(capability => `${capability.name} → ${capability.path}`),
    })
  }

  const inputs = inputNames(entry)
  if (inputs.length > 0) facts.push({ label: 'inputs', values: inputs })

  const events = entry.contract?.events ?? []
  if (events.length > 0) facts.push({ label: 'events', values: [...events] })

  /*
   * Only when it is not the usual one. Which loader an entry goes through is
   * the answer to "why does this one behave differently", and it is noise on
   * the eight rows that go through the same one as everything else.
   */
  if (entry.adapter !== 'react') facts.push({ label: 'adapter', values: [entry.adapter] })

  return facts
}

/**
 * Input names, with `?` on the optional ones.
 *
 * TypeScript's mark rather than a second colour or a legend: everybody reading
 * this has spent the morning in a `.d.ts`, and it costs one character where a
 * badge would cost a row.
 */
function inputNames(entry: NeutralRegistryEntry): readonly string[] {
  const inputs = entry.contract?.inputs
  if (inputs === undefined) return []

  const properties = inputs['properties']
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) return []

  const required = inputs['required']
  const isRequired = new Set(
    Array.isArray(required) ? required.filter(name => typeof name === 'string') : [],
  )

  return Object.keys(properties).map(name => (isRequired.has(name) ? name : `${name}?`))
}
