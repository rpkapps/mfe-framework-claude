/**
 * The render tool, generated from the registry's published Widget contracts (§16): the agent shows
 * a Widget in the chat with `{ widgetId, inputs }`, and the transcript mounts it as the dashboard
 * does. Widgets take props; nobody wraps one in an action.
 *
 * Its result is only that the Widget was shown, never a Widget's outputs (agentic plan, A): those
 * reach the agent as agent context while the Widget is in the chat, or as a new turn from the
 * user's own press. Showing a Widget ends the turn (`followUp: false`), since it is for the user.
 */

import type { ChatTool } from '@company/mfe-agent'
import type { JsonSchemaObject, RegistryEntry } from '@company/mfe-react'

import { SHELL_TOOLS } from './names.ts'

export interface RenderWidgetInput {
  readonly widgetId: string
  readonly inputs: Readonly<Record<string, unknown>>
}

export type RenderWidgetResult =
  | { readonly status: 'shown'; readonly widgetId: string }
  | { readonly status: 'invalid'; readonly error: string }

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The call's input, as far as it has arrived: a Widget id and its inputs. */
export function readRenderWidgetInput(input: unknown): RenderWidgetInput | undefined {
  if (!isObject(input) || typeof input['widgetId'] !== 'string') return undefined
  return { widgetId: input['widgetId'], inputs: isObject(input['inputs']) ? input['inputs'] : {} }
}

/** A Widget the agent can show: one whose inputs the build could read. */
function renderable(entry: RegistryEntry): entry is RegistryEntry & {
  readonly contract: { readonly inputSchema: JsonSchemaObject }
} {
  return entry.contract?.inputSchema !== undefined
}

/** The render tool, over the Widgets the registry lists. Undefined when none can be shown. */
export function renderWidgetTool(widgets: readonly RegistryEntry[]): ChatTool | undefined {
  const shown = widgets.filter(renderable)
  if (shown.length === 0) return undefined

  return {
    name: SHELL_TOOLS.renderWidget,
    description: [
      'Show a Widget to the user in the chat, with the inputs its schema takes. It is for the user:',
      'you get back only that it was shown. Use it for what a Widget shows best; never to show',
      'figures you made up. The Widgets:',
      ...shown.map(
        widget =>
          `- ${widget.id}${widget.title === undefined ? '' : `: ${widget.title}`}${
            widget.description === undefined ? '' : `. ${widget.description}`
          }`,
      ),
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        widgetId: { type: 'string', enum: shown.map(widget => widget.id) },
        inputs: {
          description: 'The inputs of that Widget: the variant titled with its id.',
          anyOf: shown.map(widget => ({ ...widget.contract.inputSchema, title: widget.id })),
        },
      },
      required: ['widgetId', 'inputs'],
      additionalProperties: false,
    },
    followUp: false,
    execute: (input): RenderWidgetResult => {
      const call = readRenderWidgetInput(input)
      if (call === undefined || !shown.some(widget => widget.id === call.widgetId)) {
        return {
          status: 'invalid',
          error: `Show one of: ${shown.map(widget => widget.id).join(', ')}.`,
        }
      }
      // The provider validates the inputs when it mounts the Widget, as it does everywhere.
      return { status: 'shown', widgetId: call.widgetId }
    },
  }
}
