/**
 * `createApp` and `createWidget` both return plain, side-effect-free records, so the build
 * plugin can discover them statically without invoking a render function. Each also carries the
 * neutral `mount`, so a host built on another framework can place it; a React host renders the
 * record directly instead.
 */

import {
  createMfeError,
  DEFINITION_BRAND,
  DEFINITION_ID_RULE,
  eventNameToHandlerProp,
  isBrandedDefinition,
  isReservedInputName,
  isValidDefinitionId,
  isValidEventName,
  type ContractEvents,
  type ContractInputs,
  type WidgetContract,
} from '@company/mfe-core'
import type {
  AppMountTarget,
  MountableAppDefinition,
  MountableWidgetDefinition,
  MountedApp,
  MountedWidget,
  WidgetMountTarget,
} from '@company/mfe-runtime'
import type { AnyRouter } from '@tanstack/react-router'
import type { ComponentType, ReactNode, SVGProps } from 'react'
import type { z } from 'zod'

import type { AppRouterOptions } from './router-contract.ts'

/**
 * What a host shows before it has loaded anything. Read statically out of this call at build time
 * and published in the registry, so a catalogue can name, describe, filter and draw a definition
 * whose container has never been fetched (§16).
 */
interface PresentationOptions {
  /** Overridden by the host's own presentation map, where a deployment keeps its wording. */
  readonly title?: string
  readonly description?: string
  /** Free-form; a host filters its catalogue on them and never interprets them. */
  readonly tags?: readonly string[]
  /**
   * An imported identifier — an icon component, or an imported `.svg`. Nothing reads this value:
   * the build follows the import to the shapes behind it and publishes those, because the
   * registry crosses an origin boundary and carries data rather than components or markup.
   */
  readonly icon?: ComponentType<SVGProps<SVGSVGElement>> | string
}

export interface AppOptions extends PresentationOptions {
  /** The only public identity field, globally unique across Apps and Widgets. */
  readonly id: string
  /** Recorded in diagnostics so a failure identifies which build was running. */
  readonly version?: string
  /** Called once per mount, never once per module; an App mounted twice gets two routers. */
  readonly router: (options: AppRouterOptions) => AnyRouter
  /** Opts this App out of its own breadcrumb segment, not nested child Apps' contributions. */
  readonly breadcrumbs?: false
}

export interface AppDefinition extends MountableAppDefinition {
  readonly framework: 'react'
  readonly createRouter: (options: AppRouterOptions) => AnyRouter
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
      repair: 'Pass the named factory that calls createRouter; it runs once per mount.',
    })
  }

  return {
    [DEFINITION_BRAND]: true,
    kind: 'app',
    framework: 'react',
    id: options.id,
    ...(options.version === undefined ? {} : { version: options.version }),
    createRouter: options.router,
    contributesBreadcrumbs: options.breadcrumbs !== false,
    // `this` rather than the record above, because a container's build mounts the copy that
    // `withStyleRoot` attached its style root to. Imported on first use, because the React
    // mount imports this module and only a host on another framework ever calls it.
    async mount(target: AppMountTarget): Promise<MountedApp> {
      const { mountApp } = await import('./react-mount.tsx')
      return mountApp(this, target)
    },
  }
}

/** Both fields are typed from the schemas. */
export interface WidgetRenderProps<C extends WidgetContract> {
  readonly inputs: ContractInputs<C>
  /** Validates the payload at this call site, so a failure surfaces here. */
  readonly emit: <K extends keyof ContractEvents<C> & string>(
    event: K,
    payload: ContractEvents<C>[K],
  ) => void
}

export interface WidgetOptions<
  Inputs extends z.ZodType,
  Events extends Record<string, z.ZodType>,
> extends PresentationOptions {
  readonly id: string
  readonly version?: string
  readonly inputs: Inputs
  readonly events: Events
  readonly render: (props: WidgetRenderProps<WidgetContract<Inputs, Events>>) => ReactNode
}

export interface WidgetDefinition<
  Inputs extends z.ZodType = z.ZodType,
  Events extends Record<string, z.ZodType> = Record<string, z.ZodType>,
> extends MountableWidgetDefinition {
  readonly framework: 'react'
  readonly contract: WidgetContract<Inputs, Events>
  readonly render: (props: WidgetRenderProps<WidgetContract<Inputs, Events>>) => ReactNode
}

export function createWidget<Inputs extends z.ZodType, Events extends Record<string, z.ZodType>>(
  options: WidgetOptions<Inputs, Events>,
): WidgetDefinition<Inputs, Events> {
  assertValidId(options.id, 'createWidget')
  assertUsableEventNames(options.id, options.events)

  if (typeof options.render !== 'function') {
    throw createMfeError({
      code: 'mount/failure',
      id: options.id,
      operation: 'create Widget definition',
      expected: 'a render function',
      observed: options.render === undefined ? 'nothing' : `a ${typeof options.render}`,
      repair: 'Pass a component function as `render`; its props are typed from the schemas.',
    })
  }

  return {
    [DEFINITION_BRAND]: true,
    kind: 'widget',
    framework: 'react',
    id: options.id,
    ...(options.version === undefined ? {} : { version: options.version }),
    contract: { inputs: options.inputs, events: options.events },
    render: options.render,
    // See `createApp`: `this` is the copy a container's build attached its style root to.
    async mount(target: WidgetMountTarget): Promise<MountedWidget> {
      const { mountWidget } = await import('./react-mount.tsx')
      return mountWidget(this, target)
    },
  }
}

export type MfeDefinition = AppDefinition | WidgetDefinition

/** Recognises the brand, whichever adapter stamped it; `isReactDefinition` is the one to narrow. */
export function isMfeDefinition(value: unknown): value is MfeDefinition {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as Record<symbol, unknown>)[DEFINITION_BRAND] === true
  )
}

/** A definition this adapter renders in its own tree, rather than one it hosts through `mount`. */
export function isReactDefinition(value: unknown): value is MfeDefinition {
  return isBrandedDefinition(value) && value.framework === 'react'
}

function assertValidId(id: unknown, operation: string): asserts id is string {
  if (isValidDefinitionId(id)) return

  throw createMfeError({
    code: 'registry/invalid-entry',
    id: typeof id === 'string' && id !== '' ? id : '<missing>',
    operation,
    expected: DEFINITION_ID_RULE,
    observed:
      id === undefined ? 'nothing' : typeof id === 'string' ? JSON.stringify(id) : typeof id,
    repair: 'Give the definition a stable id; it is also its storage prefix and CSS scope value.',
  })
}

/** Two events mapping to one `on`-prefixed prop would make a subscription ambiguous. */
function assertUsableEventNames(id: string, events: Record<string, z.ZodType>): void {
  const handlerProps = new Map<string, string>()

  for (const name of Object.keys(events)) {
    const declaration = {
      code: 'contract/event-mismatch',
      id,
      operation: `declare event '${name}'`,
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

/** Called by the mount boundary, where the parsed input keys are known. */
export function assertUsableInputNames(id: string, inputNames: readonly string[]): void {
  for (const name of inputNames) {
    if (!isReservedInputName(name)) continue

    throw createMfeError({
      code: 'contract/input-mismatch',
      id,
      operation: `declare input '${name}'`,
      expected: 'an input name that is not reserved for host control or event handlers',
      observed: `'${name}', which is reserved`,
      repair: 'Rename the input; key, ref, fallback and onX names belong to the host.',
    })
  }
}
