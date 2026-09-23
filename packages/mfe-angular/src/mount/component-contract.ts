/**
 * Checking a Widget's component against its contract before anything is created: every input the
 * schema declares must be an input of the component, and every event one of its outputs. Read
 * through `reflectComponentType`, which covers `input()`/`output()` and `@Input()`/`@Output()`
 * alike, and matched on public names, which are what `setInput` and a template use.
 */

import { reflectComponentType } from '@angular/core'
import { createMfeErrorFactory, isReservedInputName, type MfeError } from '@company/mfe-core'

import type { WidgetDefinition } from '../definition.ts'

export interface ComponentContract {
  /** Public input names. */
  readonly inputs: ReadonlySet<string>
  /** Each declared event's public output name, mapped to the instance property carrying it. */
  readonly outputs: ReadonlyMap<string, string>
}

/** An object schema names its keys up front; any other schema is checked per value instead. */
function declaredInputNames(schema: unknown): readonly string[] {
  const shape = (schema as { readonly shape?: unknown } | null)?.shape
  return shape !== null && typeof shape === 'object' ? Object.keys(shape) : []
}

function list(names: Iterable<string>): string {
  const all = [...names]
  return all.length === 0 ? 'none' : all.join(', ')
}

export function readComponentContract(definition: WidgetDefinition): ComponentContract {
  const fail = createMfeErrorFactory({
    code: 'mount/failure',
    id: definition.id,
    ...(definition.version === undefined ? {} : { definitionVersion: definition.version }),
    operation: 'mount Widget',
  })

  const mirror = reflectComponentType(definition.component)
  const componentName = definition.component.name || 'the component'
  if (mirror === null) {
    throw fail({
      expected: 'a standalone component class',
      observed: `${componentName}, which Angular does not recognise as a component`,
      repair:
        'Pass the class decorated with @Component as `component`, not an instance or a module.',
    })
  }

  const inputs = new Set(mirror.inputs.map(input => input.templateName))
  for (const name of declaredInputNames(definition.contract.inputs)) {
    if (inputs.has(name)) continue
    throw fail({
      expected: `an input named "${name}" on ${componentName}, because the inputs schema declares it`,
      observed: `inputs ${list(inputs)}`,
      repair: `Declare it on the component: \`${name} = input.required<…>()\`, or \`@Input() ${name}\`.`,
    })
  }

  const outputs = new Map(mirror.outputs.map(output => [output.templateName, output.propName]))
  const events = Object.keys(definition.contract.events)
  for (const event of events) {
    if (outputs.has(event)) continue
    throw fail({
      expected: `an output named "${event}" on ${componentName}, because the events schema declares it`,
      observed: `outputs ${list(outputs.keys())}`,
      repair: `Declare it on the component: \`${event} = output<…>()\`, or \`@Output() ${event} = new EventEmitter<…>()\`.`,
    })
  }

  // An undeclared output is the component's own business, unless its name is one a host reserves.
  for (const name of outputs.keys()) {
    if (events.includes(name) || !isReservedInputName(name)) continue
    throw fail({
      expected: 'outputs that are declared events, or names a host does not reserve',
      observed: `an output named "${name}"`,
      repair: 'Rename the output; key, ref, fallback and onX names belong to the host.',
    })
  }

  return {
    inputs,
    outputs: new Map(events.map(event => [event, outputs.get(event) ?? event])),
  }
}

/** A validated input the component does not declare would fail inside `setInput`, far from here. */
export function undeclaredInput(
  definition: WidgetDefinition,
  contract: ComponentContract,
  name: string,
): MfeError {
  const fail = createMfeErrorFactory({
    code: 'mount/failure',
    id: definition.id,
    ...(definition.version === undefined ? {} : { definitionVersion: definition.version }),
    operation: `accept input '${name}'`,
  })
  return fail({
    expected: `an input the component declares (${list(contract.inputs)})`,
    observed: `'${name}', which the inputs schema let through`,
    repair: `Declare \`${name}\` as an input on the component, or strip it from the inputs schema.`,
  })
}
