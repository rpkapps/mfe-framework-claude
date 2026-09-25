/**
 * `createApp` and `createWidget` both return plain, side-effect-free records, so the build
 * plugin can discover them statically without invoking a render function. Each carries the
 * neutral `mount`, through which every host places it, a React host included: the definition
 * opens a React root of its own in the element the host provides.
 */

import {
  assertDefinitionId,
  createMfeError,
  DEFINITION_BRAND,
  outputNameToHandlerProp,
  findOutputNameProblem,
  withoutUndefined,
  type ContractOutputs,
  type OutputSchema,
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
  assertDefinitionId(options.id, 'createApp')

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
    ...withoutUndefined({ version: options.version }),
    createRouter: options.router,
    contributesBreadcrumbs: options.breadcrumbs !== false,
    // `this` rather than the record above, because a container's build mounts the copy that
    // `withStyleRoot` attached its style root to. Imported on first use, so a module that only
    // declares definitions, such as a container's entry, does not pull the renderer in with it.
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
  readonly emit: <K extends keyof ContractOutputs<C> & string>(
    output: K,
    payload: ContractOutputs<C>[K],
  ) => void
}

export interface WidgetOptions<
  Inputs extends z.ZodType,
  Outputs extends OutputSchema,
> extends PresentationOptions {
  readonly id: string
  readonly version?: string
  readonly inputSchema: Inputs
  /** `z.object({ acknowledged: z.object({ … }) })`: one property per output, its payload's schema. */
  readonly outputSchema: Outputs
  readonly render: (props: WidgetRenderProps<WidgetContract<Inputs, Outputs>>) => ReactNode
}

export interface WidgetDefinition<
  Inputs extends z.ZodType = z.ZodType,
  Outputs extends OutputSchema = OutputSchema,
> extends MountableWidgetDefinition {
  readonly framework: 'react'
  readonly contract: WidgetContract<Inputs, Outputs>
  readonly render: (props: WidgetRenderProps<WidgetContract<Inputs, Outputs>>) => ReactNode
}

export function createWidget<Inputs extends z.ZodType, Outputs extends OutputSchema>(
  options: WidgetOptions<Inputs, Outputs>,
): WidgetDefinition<Inputs, Outputs> {
  assertDefinitionId(options.id, 'createWidget')
  assertUsableOutputNames(options.id, options.outputSchema)

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
    ...withoutUndefined({ version: options.version }),
    contract: { inputSchema: options.inputSchema, outputSchema: options.outputSchema },
    render: options.render,
    // See `createApp`: `this` is the copy a container's build attached its style root to.
    async mount(target: WidgetMountTarget): Promise<MountedWidget> {
      const { mountWidget } = await import('./react-mount.tsx')
      return mountWidget(this, target)
    },
  }
}

export type MfeDefinition = AppDefinition | WidgetDefinition

/** Two outputs mapping to one `on`-prefixed prop would make a subscription ambiguous. */
function assertUsableOutputNames(id: string, outputSchema: OutputSchema): void {
  const shape = (outputSchema as Partial<OutputSchema> | undefined)?.shape
  if (shape === null || typeof shape !== 'object') {
    throw createMfeError({
      code: 'contract/output-mismatch',
      id,
      operation: 'declare the outputs',
      expected: 'an outputSchema made with z.object, one property per output',
      observed: outputSchema === undefined ? 'nothing' : 'a schema that is not an object schema',
      repair:
        'Declare outputSchema: z.object({ acknowledged: z.object({ … }) }), or z.object({}) when the Widget emits nothing.',
    })
  }

  const problem = findOutputNameProblem(Object.keys(shape))
  if (problem === null) return

  const declaration = {
    code: 'contract/output-mismatch',
    id,
    operation: `declare output '${problem.name}'`,
  } as const

  if (problem.kind === 'invalid') {
    throw createMfeError({
      ...declaration,
      expected: 'a lower-camel-case output name, for example "acknowledged"',
      observed: JSON.stringify(problem.name),
      repair: `Rename the output; consumers subscribe to it as ${outputNameToHandlerProp('yourOutput')}.`,
    })
  }

  throw createMfeError({
    ...declaration,
    expected: 'output names that map to distinct handler props',
    observed: `'${problem.existing}' and '${problem.name}' both map to ${problem.handlerProp}`,
    repair: `Rename one of them, for example '${problem.name}Completed'.`,
  })
}
