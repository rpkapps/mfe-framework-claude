/**
 * The render_a2ui tool: one-off UI with no Widget and no built-in renderer, which the agent
 * composes from the catalogue the shell provides, in A2UI v0.9 (https://a2ui.org). Its input is
 * the one the AG-UI A2UI middleware gives its own render tool, `{ surfaceId, components, data? }`,
 * so an agent written for that middleware works here too; `messages` takes raw A2UI messages
 * instead, for updating or deleting a surface already shown. The host stamps the catalogue id.
 *
 * A Button's event comes back as a new turn (`ShellChat.a2uiAction`), never on a timer.
 */

import type { ChatTool } from '@company/mfe-agent'

import { CATALOGUE, CATALOGUE_NAMES, TECTON_CATALOGUE_ID } from '../a2ui/catalogue.ts'
import { SHELL_TOOLS } from './names.ts'
import type { A2uiError } from '../a2ui/model.ts'
import type { A2uiSurfaces } from '../a2ui/surfaces.ts'
import { isObject } from '../records.ts'

const VERSION = 'v0.9'

export type RenderA2uiResult =
  | { readonly status: 'rendered'; readonly surfaceId: string }
  | { readonly status: 'invalid'; readonly error: A2uiError }

/** The call's input as A2UI messages: raw ones, or the middleware's shorthand expanded. */
function messagesOf(
  input: unknown,
  exists: (surfaceId: string) => boolean,
): { readonly surfaceId: string; readonly messages: readonly unknown[] } | undefined {
  if (!isObject(input)) return undefined
  if (Array.isArray(input['messages'])) {
    const first = input['messages'].find(isObject)
    const surface = first === undefined ? undefined : Object.values(first).find(isObject)
    const surfaceId =
      isObject(surface) && typeof surface['surfaceId'] === 'string' ? surface['surfaceId'] : ''
    if (surfaceId === '') return undefined
    // Whatever catalogue the agent named, the host's is the one the shell draws.
    const messages = (input['messages'] as unknown[]).map((message): unknown =>
      isObject(message) && isObject(message['createSurface'])
        ? {
            ...message,
            createSurface: { ...message['createSurface'], catalogId: TECTON_CATALOGUE_ID },
          }
        : message,
    )
    return { surfaceId, messages }
  }

  const { surfaceId, components, data } = input
  if (typeof surfaceId !== 'string' || surfaceId === '') return undefined
  return {
    surfaceId,
    messages: [
      ...(exists(surfaceId)
        ? []
        : [{ version: VERSION, createSurface: { surfaceId, catalogId: TECTON_CATALOGUE_ID } }]),
      { version: VERSION, updateComponents: { surfaceId, components } },
      ...(data === undefined
        ? []
        : [{ version: VERSION, updateDataModel: { surfaceId, path: '/', value: data } }]),
    ],
  }
}

export function renderA2uiTool(surfaces: A2uiSurfaces): ChatTool {
  return {
    name: SHELL_TOOLS.a2ui,
    description: [
      'Show a one-off piece of UI in the chat, composed in A2UI v0.9, when no Widget and no show_* tool fits: a short form, a choice, a status card.',
      'Components are a flat list of {id, component, ...properties}; exactly one has the id "root". A value is a literal, {"path": "/pointer"} into `data`, or {"call": fn, "args": {...}}.',
      'A Button with {"action": {"event": {"name", "context"}}} sends you the event, with its context resolved against `data`, as the user’s next message.',
      'The catalogue (* marks required properties):',
      ...Object.entries(CATALOGUE).map(([name, properties]) => `- ${name}: ${properties}`),
      'Never put figures in it that came from nowhere.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        surfaceId: { type: 'string', description: 'Names the surface; the same id updates it.' },
        components: { type: 'array', items: { type: 'object' } },
        data: { type: 'object', description: 'The data model the components bind to.' },
        messages: {
          type: 'array',
          items: { type: 'object' },
          description: 'Raw A2UI v0.9 messages, instead of the three above.',
        },
      },
      additionalProperties: false,
    },
    // Drawn, the turn ends; refused, the agent hears why and can correct it.
    followUp: result => (result as RenderA2uiResult).status !== 'rendered',
    execute: (input, { toolCallId }): RenderA2uiResult => {
      const parsed = messagesOf(input, surfaceId => surfaces.getSnapshot().has(surfaceId))
      if (parsed === undefined) {
        return {
          status: 'invalid',
          error: {
            code: 'VALIDATION_FAILED',
            surfaceId: '',
            path: '/surfaceId',
            message: 'Give a surfaceId and components, or messages.',
          },
        }
      }
      const error = surfaces.apply(toolCallId, parsed.messages, CATALOGUE_NAMES, parsed.surfaceId)
      if (error !== undefined) return { status: 'invalid', error }
      return { status: 'rendered', surfaceId: parsed.surfaceId }
    },
  }
}
