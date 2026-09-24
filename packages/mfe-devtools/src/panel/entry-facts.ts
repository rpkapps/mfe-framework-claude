/**
 * What an accepted entry has to say about itself, as label/value pairs: badges told a capability,
 * an input and an event apart by colour alone. `describeWidgetInputs` and `describeWidgetEvents` are
 * the only readers of the published schemas, because a second walk is how this panel and the
 * shell's dashboard drifted (§28).
 */

import { describeWidgetEvents, describeWidgetInputs, type RegistryEntry } from '@company/mfe-react'

export interface EntryFact {
  readonly label: string
  /** Rendered as one line, space separated, in declaration order. */
  readonly values: readonly string[]
}

export function factsOf(entry: RegistryEntry): readonly EntryFact[] {
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

  const events = describeWidgetEvents(entry.contract) ?? []
  if (events.length > 0) facts.push({ label: 'events', values: events.map(event => event.name) })

  // Always, because no adapter is the usual one: a shell lists each of them, and which one read an
  // entry is what decides how it loads and mounts.
  facts.push({ label: 'adapter', values: [entry.adapter] })

  return facts
}

/** Input names, with TypeScript's `?` on the optional ones, where a badge would cost a row. */
function inputNames(entry: RegistryEntry): readonly string[] {
  const fields = describeWidgetInputs(entry.contract)
  if (fields === null) return []

  return fields.map(field => (field.required ? field.name : `${field.name}?`))
}
