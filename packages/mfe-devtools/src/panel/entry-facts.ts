/**
 * What an accepted entry has to say about itself, as label/value pairs: badges told a capability,
 * an input and an event apart by colour alone. `describeWidgetInputs` is the only reader of the
 * published schema, because a second walk is how this panel and the shell's dashboard drifted (§28).
 */

import { describeWidgetInputs, type NeutralRegistryEntry } from '@company/mfe-react'

export interface EntryFact {
  readonly label: string
  /** Rendered as one line, space separated, in declaration order. */
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

  // Only when it is not the usual one, which is noise on every row that goes through the same one.
  if (entry.adapter !== 'react') facts.push({ label: 'adapter', values: [entry.adapter] })

  return facts
}

/** Input names, with TypeScript's `?` on the optional ones, where a badge would cost a row. */
function inputNames(entry: NeutralRegistryEntry): readonly string[] {
  const fields = describeWidgetInputs(entry.contract)
  if (fields === null) return []

  return fields.map(field => (field.required ? field.name : `${field.name}?`))
}
