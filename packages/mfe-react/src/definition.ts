/**
 * `createApp` and `createWidget`: the one call an author makes in `src/mfe.ts`.
 *
 * Both return plain, side-effect-free descriptors, so the build plugin can
 * discover them statically without invoking a render function to read metadata.
 */

import {
  createMfeError,
  DEFINITION_ID_RULE,
  eventNameToHandlerProp,
  isReservedInputName,
  isValidDefinitionId,
  isValidEventName,
  type ContractEvents,
  type ContractInputs,
  type ContractSchema,
  type WidgetContract,
} from '@company/mfe-core'
import type { AnyRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import type { AppRouterOptions } from './router-contract.ts'

/** Brand used to recognise framework definitions at the mount boundary. */
const DEFINITION_BRAND = Symbol.for('@company/mfe.definition')

export interface AppOptions {
  /** The only public identity field. Globally unique across Apps and Widgets. */
  readonly id: string
  /** Recorded in diagnostics so a failure identifies which build was running. */
  readonly version?: string
  /**
   * Called once per mount, never once per module. An App mounted twice gets two
   * routers, and disposal drops the router rather than reusing a singleton.
   */
  readonly router: (options: AppRouterOptions) => AnyRouter
  /**
   * Opts this App out of contributing its own breadcrumb segment. It does not
   * disable contributions from nested child Apps.
   */
  readonly breadcrumbs?: false
}

export interface AppDefinition {
  readonly [DEFINITION_BRAND]: true
  readonly kind: 'app'
  readonly id: string
  readonly version?: string
  readonly createRouter: (options: AppRouterOptions) => AnyRouter
  readonly contributesBreadcrumbs: boolean
}

export function createApp(options: AppOptions): AppDefinition {
  assertValidId(options.id, 'createApp')

  if (typeof options.router !== 'function') {
    throw createMfeError({
      code: 'app/invalid-router',
      id: options.id,
      operation: 'create App definition',
      expected: 'a router factory function',
      observed: options.router === undefined ? 'nothing' : `a ${typeof options.router}`,
      declaredBy: 'The App definition contract',
      repair: 'Pass the named factory that calls createRouter; it runs once per mount.',
    })
  }

  return {
    [DEFINITION_BRAND]: true,
    kind: 'app',
    id: options.id,
    ...(options.version === undefined ? {} : { version: options.version }),
    createRouter: options.router,
    contributesBreadcrumbs: options.breadcrumbs !== false,
  }
}

/** What a Widget's render function receives. Both are typed from the schemas. */
export interface WidgetRenderProps<C extends WidgetContract> {
  readonly inputs: ContractInputs<C>
  /** Validates the payload at this call site, so a failure surfaces here. */
  readonly emit: <K extends keyof ContractEvents<C> & string>(
    event: K,
    payload: ContractEvents<C>[K],
  ) => void
}

export interface WidgetOptions<
  Inputs extends ContractSchema<unknown>,
  Events extends Record<string, ContractSchema<unknown>>,
> {
  readonly id: string
  readonly version?: string
  readonly inputs: Inputs
  readonly events: Events
  readonly render: (props: WidgetRenderProps<WidgetContract<Inputs, Events>>) => ReactNode
}

export interface WidgetDefinition<
  Inputs extends ContractSchema<unknown> = ContractSchema<unknown>,
  Events extends Record<string, ContractSchema<unknown>> = Record<string, ContractSchema<unknown>>,
> {
  readonly [DEFINITION_BRAND]: true
  readonly kind: 'widget'
  readonly id: string
  readonly version?: string
  readonly contract: WidgetContract<Inputs, Events>
  readonly render: (props: WidgetRenderProps<WidgetContract<Inputs, Events>>) => ReactNode
}

export function createWidget<
  Inputs extends ContractSchema<unknown>,
  Events extends Record<string, ContractSchema<unknown>>,
>(options: WidgetOptions<Inputs, Events>): WidgetDefinition<Inputs, Events> {
  assertValidId(options.id, 'createWidget')
  assertUsableEventNames(options.id, options.events)

  if (typeof options.render !== 'function') {
    throw createMfeError({
      code: 'mount/failure',
      id: options.id,
      operation: 'create Widget definition',
      expected: 'a render function',
      observed: options.render === undefined ? 'nothing' : `a ${typeof options.render}`,
      declaredBy: 'The Widget definition contract',
      repair: 'Pass a component function as `render`; its props are typed from the schemas.',
    })
  }

  return {
    [DEFINITION_BRAND]: true,
    kind: 'widget',
    id: options.id,
    ...(options.version === undefined ? {} : { version: options.version }),
    contract: { inputs: options.inputs, events: options.events },
    render: options.render,
  }
}

export type MfeDefinition = AppDefinition | WidgetDefinition

export function isMfeDefinition(value: unknown): value is MfeDefinition {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as Record<symbol, unknown>)[DEFINITION_BRAND] === true
  )
}

function assertValidId(id: unknown, operation: string): asserts id is string {
  if (isValidDefinitionId(id)) return

  throw createMfeError({
    code: 'registry/invalid-descriptor',
    id: typeof id === 'string' && id !== '' ? id : '<missing>',
    operation,
    expected: DEFINITION_ID_RULE,
    observed:
      id === undefined ? 'nothing' : typeof id === 'string' ? JSON.stringify(id) : typeof id,
    declaredBy: 'The framework identity rules',
    repair: 'Give the definition a stable id; it is also its storage prefix and CSS scope value.',
  })
}

/**
 * Event names must be lower-camel-case and must stay distinct once mapped to
 * their `on`-prefixed props, since two events mapping to one handler prop would
 * make a consumer's subscription ambiguous.
 */
function assertUsableEventNames(id: string, events: Record<string, ContractSchema<unknown>>): void {
  const handlerProps = new Map<string, string>()

  for (const name of Object.keys(events)) {
    const declaration = {
      code: 'contract/event-mismatch',
      id,
      operation: `declare event '${name}'`,
      declaredBy: 'The Widget contract',
    } as const

    if (!isValidEventName(name)) {
      throw createMfeError({
        ...declaration,
        expected: 'a lower-camel-case event name, for example "acknowledged"',
        observed: JSON.stringify(name),
        repair: `Rename the event; consumers subscribe to it as ${eventNameToHandlerProp('yourEvent')}.`,
      })
    }

    const handlerProp = eventNameToHandlerProp(name)
    const existing = handlerProps.get(handlerProp)
    if (existing !== undefined) {
      throw createMfeError({
        ...declaration,
        expected: 'event names that map to distinct handler props',
        observed: `'${existing}' and '${name}' both map to ${handlerProp}`,
        repair: `Rename one of them, for example '${name}Completed'.`,
      })
    }
    handlerProps.set(handlerProp, name)
  }
}

/**
 * Validates input field names against the reserved host control props. Called by
 * the mount boundary, where the parsed input keys are known.
 */
export function assertUsableInputNames(id: string, inputNames: readonly string[]): void {
  for (const name of inputNames) {
    if (!isReservedInputName(name)) continue

    throw createMfeError({
      code: 'contract/input-mismatch',
      id,
      operation: `declare input '${name}'`,
      expected: 'an input name that is not reserved for host control or event handlers',
      observed: `'${name}', which is reserved`,
      declaredBy: 'The Widget consumption contract',
      repair: 'Rename the input; key, ref, fallback and onX names belong to the host.',
    })
  }
}
