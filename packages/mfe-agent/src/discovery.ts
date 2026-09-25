/**
 * Lazy tool discovery, following TanStack AI's (`lazy` tools and its discovery tool,
 * https://github.com/TanStack/ai): with many Apps publishing actions, a run declares only the tools
 * the task needs. The rest are named, with a line each, in the description of one discovery tool;
 * the agent calls it with the names it wants, gets their definitions back, and from the next run on
 * those tools are declared like any other, for the rest of the conversation.
 *
 * Only the API's idea is TanStack AI's: the tools here are the chat's, read again before every
 * run, so a tool whose mount has gone drops out of the list and the discovery tool alike.
 */

import type { ChatTool, ToolListContext } from './types.ts'

/** The discovery tool's name. */
export const DISCOVER_TOOLS = 'discover_tools'

export interface ToolDiscoveryOptions {
  /**
   * Up to this many tools, every one is declared and there is no discovery tool. Defaults to 24,
   * below the size at which models start picking the wrong tool.
   */
  readonly threshold?: number
  /** Tools always declared, such as navigation: those the agent needs whatever the task. */
  readonly eager?: (tool: ChatTool) => boolean
}

/** What the discovery tool returns for one name. */
export interface DiscoveredTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
}

const EMPTY_SCHEMA = { type: 'object', properties: {} } as const

/** The first sentence of a description, which is what the list shows of it. */
function firstSentence(description: string): string {
  const line = description.split('\n')[0]?.trim() ?? ''
  const end = line.search(/[.!?](\s|$)/)
  return end === -1 ? line : line.slice(0, end + 1)
}

/**
 * Wraps the chat's tool list so that, above `threshold`, a run declares the eager tools, the ones
 * discovered in this conversation and the discovery tool. Pass the result as the chat's `tools`.
 */
export function withToolDiscovery(
  tools: (context: ToolListContext) => readonly ChatTool[],
  options: ToolDiscoveryOptions = {},
): (context: ToolListContext) => readonly ChatTool[] {
  const threshold = options.threshold ?? 24
  const eager = options.eager ?? (() => false)
  /** Discovered names, per conversation: a new thread starts with none. */
  const discovered = new Map<string, Set<string>>()

  const namesFor = (threadId: string): Set<string> => {
    let names = discovered.get(threadId)
    if (names === undefined) {
      names = new Set()
      discovered.set(threadId, names)
    }
    return names
  }

  return context => {
    const all = tools(context)
    if (all.length <= threshold) return all

    const known = namesFor(context.threadId)
    const declared = all.filter(tool => eager(tool) || known.has(tool.name))
    const hidden = all.filter(tool => !eager(tool) && !known.has(tool.name))
    if (hidden.length === 0) return declared

    const discover: ChatTool = {
      name: DISCOVER_TOOLS,
      description: [
        'More tools are available than are declared. Call this with the names of the ones the task needs;',
        'it returns their definitions, and from then on you can call them.',
        '',
        ...hidden.map(tool => `- ${tool.name}: ${firstSentence(tool.description)}`),
      ].join('\n'),
      inputSchema: {
        type: 'object',
        properties: {
          names: {
            type: 'array',
            items: { type: 'string', enum: hidden.map(tool => tool.name) },
            description: 'The names of the tools to use, from the list in this description.',
          },
        },
        required: ['names'],
      },
      execute: (input, { threadId }) => {
        const requested = readNames(input)
        const byName = new Map(tools({ threadId }).map(tool => [tool.name, tool]))
        const names = namesFor(threadId)
        const found: DiscoveredTool[] = []
        const unknown: string[] = []
        for (const name of requested) {
          const tool = byName.get(name)
          if (tool === undefined) {
            unknown.push(name)
            continue
          }
          names.add(name)
          found.push({
            name,
            description: tool.description,
            inputSchema: tool.inputSchema ?? EMPTY_SCHEMA,
          })
        }
        return { tools: found, ...(unknown.length === 0 ? {} : { unknown }) }
      },
    }

    return [...declared, discover]
  }
}

function readNames(input: unknown): string[] {
  if (typeof input !== 'object' || input === null || !('names' in input)) return []
  const { names } = input
  return Array.isArray(names)
    ? (names as unknown[]).filter((name): name is string => typeof name === 'string')
    : []
}
