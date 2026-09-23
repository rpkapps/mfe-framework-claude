/**
 * `createApp` and `createWidget` return plain records the build plugin discovers statically, plus
 * the `mount` every host reaches through the runtime: an Angular definition mounts itself into an
 * element, so a host written in any framework places it exactly as it places any other.
 */

import type { EnvironmentProviders, Provider, Type } from '@angular/core'
import type { RouterFeatures, Routes } from '@angular/router'
import {
  assertDefinitionId,
  createMfeError,
  DEFINITION_BRAND,
  findEventNameProblem,
  withoutUndefined,
  type WidgetContract,
} from '@company/mfe-core'
import type {
  AppMountTarget,
  MountableAppDefinition,
  MountableWidgetDefinition,
  WidgetMountTarget,
} from '@company/mfe-runtime'
import type { z } from 'zod'

import { mountApp, type AngularMountedApp } from './mount/mount-app.ts'
import { mountWidget, type AngularMountedWidget } from './mount/mount-widget.ts'
import { MfeAppRootComponent } from './routing/app-root.component.ts'

type AngularProviders = readonly (Provider | EnvironmentProviders)[]

/**
 * What a host shows before it has loaded anything. Read statically out of this call at build time
 * and published in the registry, so a catalogue can name, describe, filter and draw a definition
 * whose container has never been fetched.
 */
interface PresentationOptions {
  /** Overridden by the host's own presentation map, where a deployment keeps its wording. */
  readonly title?: string
  readonly description?: string
  /** Free-form; a host filters its catalogue on them and never interprets them. */
  readonly tags?: readonly string[]
  /**
   * An imported identifier — an imported `.svg`, or an icon package's icon data — or a short
   * text mark. Nothing reads this value: the build follows the import to the shapes behind it and
   * publishes those, because the registry crosses an origin boundary and carries data only.
   */
  readonly icon?: string | object
}

export interface AppOptions extends PresentationOptions {
  /** The only public identity field, globally unique across Apps and Widgets. */
  readonly id: string
  /** Recorded in diagnostics so a failure identifies which build was running. */
  readonly version?: string
  /** The App's routes; their paths are relative to the boundary the host assigns. */
  readonly routes: Routes
  /**
   * Features for the App's router, such as `withComponentInputBinding()`. The mount owns the
   * router's location and its first navigation, so features that set either are overridden.
   */
  readonly routerFeatures?: readonly RouterFeatures[]
  /** Extra environment providers for this App's application injector, created once per mount. */
  readonly providers?: AngularProviders
  /** The root component; defaults to one rendering `<router-outlet />`. It must contain one. */
  readonly component?: Type<unknown>
  /** Opts this App out of its own breadcrumb segment, not nested child Apps' contributions. */
  readonly breadcrumbs?: false
}

export interface AppDefinition extends MountableAppDefinition {
  readonly framework: 'angular'
  readonly routes: Routes
  readonly routerFeatures: readonly RouterFeatures[]
  readonly providers: AngularProviders
  readonly component: Type<unknown>
  mount(target: AppMountTarget): Promise<AngularMountedApp>
}

export interface WidgetOptions<
  Inputs extends z.ZodType,
  Events extends Record<string, z.ZodType>,
> extends PresentationOptions {
  readonly id: string
  readonly version?: string
  readonly inputs: Inputs
  readonly events: Events
  /** A standalone component whose inputs are the input keys and whose outputs are the events. */
  readonly component: Type<unknown>
  /** Extra environment providers for this Widget's application injector, created once per mount. */
  readonly providers?: AngularProviders
}

export interface WidgetDefinition<
  Inputs extends z.ZodType = z.ZodType,
  Events extends Record<string, z.ZodType> = Record<string, z.ZodType>,
> extends MountableWidgetDefinition {
  readonly framework: 'angular'
  readonly contract: WidgetContract<Inputs, Events>
  readonly component: Type<unknown>
  readonly providers: AngularProviders
  mount(target: WidgetMountTarget): Promise<AngularMountedWidget>
}

export type MfeDefinition = AppDefinition | WidgetDefinition

export function createApp(options: AppOptions): AppDefinition {
  assertDefinitionId(options.id, 'createApp')

  if (!Array.isArray(options.routes)) {
    throw createMfeError({
      code: 'app/invalid-router',
      id: options.id,
      operation: 'create App definition',
      expected: 'an array of Angular routes',
      observed: describeOption(options.routes),
      repair: 'Pass the App’s Routes array as `routes`; its paths are relative to the boundary.',
    })
  }
  if (options.component !== undefined) assertComponent(options.id, options.component, 'App')

  const definition: AppDefinition = {
    [DEFINITION_BRAND]: true,
    kind: 'app',
    framework: 'angular',
    id: options.id,
    ...withoutUndefined({ version: options.version }),
    routes: options.routes,
    routerFeatures: options.routerFeatures ?? [],
    providers: providersOf(options.id, options.providers),
    component: options.component ?? MfeAppRootComponent,
    contributesBreadcrumbs: options.breadcrumbs !== false,
    mount: target => mountApp(definition, target),
  }
  return definition
}

export function createWidget<Inputs extends z.ZodType, Events extends Record<string, z.ZodType>>(
  options: WidgetOptions<Inputs, Events>,
): WidgetDefinition<Inputs, Events> {
  assertDefinitionId(options.id, 'createWidget')
  assertUsableEventNames(options.id, options.events)
  assertComponent(options.id, options.component, 'Widget')

  const definition: WidgetDefinition<Inputs, Events> = {
    [DEFINITION_BRAND]: true,
    kind: 'widget',
    framework: 'angular',
    id: options.id,
    ...withoutUndefined({ version: options.version }),
    contract: { inputs: options.inputs, events: options.events },
    component: options.component,
    providers: providersOf(options.id, options.providers),
    mount: target => mountWidget(definition, target),
  }
  return definition
}

function describeOption(value: unknown): string {
  if (value === undefined) return 'nothing'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`
}

function assertComponent(id: string, component: unknown, kind: 'App' | 'Widget'): void {
  if (typeof component === 'function') return
  throw createMfeError({
    code: 'mount/failure',
    id,
    operation: `create ${kind} definition`,
    expected: 'a standalone component class',
    observed: describeOption(component),
    repair: 'Pass the class decorated with @Component as `component`, imported, not instantiated.',
  })
}

function providersOf(id: string, providers: AngularProviders | undefined): AngularProviders {
  if (providers === undefined) return []
  const declared: unknown = providers
  if (Array.isArray(declared)) return providers
  throw createMfeError({
    code: 'mount/failure',
    id,
    operation: 'read the definition’s providers',
    expected: 'an array of providers',
    observed: describeOption(providers),
    repair: 'Pass `providers: [...]`, as you would to bootstrapApplication.',
  })
}

/** Two events mapping to one `on`-prefixed prop would make a subscription ambiguous. */
function assertUsableEventNames(id: string, events: Record<string, z.ZodType>): void {
  const problem = findEventNameProblem(Object.keys(events))
  if (problem === null) return

  const declaration = {
    code: 'contract/event-mismatch',
    id,
    operation: `declare event '${problem.name}'`,
  } as const

  if (problem.kind === 'invalid') {
    throw createMfeError({
      ...declaration,
      expected: 'a lower-camel-case event name, for example "acknowledged"',
      observed: JSON.stringify(problem.name),
      repair: 'Rename the event; it is also the name of the component output that raises it.',
    })
  }

  throw createMfeError({
    ...declaration,
    expected: 'event names that map to distinct handler props',
    observed: `'${problem.existing}' and '${problem.name}' both map to ${problem.handlerProp}`,
    repair: `Rename one of them, for example '${problem.name}Completed'.`,
  })
}
