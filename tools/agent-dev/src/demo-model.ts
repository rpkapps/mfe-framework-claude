/**
 * The demo agent: a script, not a model, so the chat can be worked on with no key and no network.
 * It reads the user's last message for a few words and answers with the page's own tools, so
 * every path of the shell's chat runs against it: page actions (and their approvals), navigation,
 * a Widget and the built-in renderers in the chat, a question for the user, tool discovery, and a
 * backend tool that asks for approval through an AG-UI interrupt.
 *
 * What it shows is real: the renderers are fed the page's own tool list and agent context, never
 * made-up figures, as the render tools require of a real model too.
 */

import type { AGUIEvent, Context, Message, RunAgentInput, Tool } from '@ag-ui/core'

import {
  runFinished,
  runInterrupted,
  runStarted,
  textMessage,
  toolCall,
  toolResult,
  type Model,
} from './events.ts'

/** The backend's own tool, which asks the user through an interrupt before it runs. */
export const SHUT_IN_WELL = 'shut_in_well'
const APPROVAL_PREFIX = 'approval_'

/** The shell's tools the demo drives by name (apps/shell/src/chat/tools). */
const SHELL = {
  navigate: 'navigate',
  renderWidget: 'render_widget',
  table: 'show_table',
  chart: 'show_chart',
  summary: 'show_summary',
  askUser: 'ask_user',
  discover: 'discover_tools',
} as const

const SHELL_TOOL_NAMES = new Set<string>(Object.values(SHELL))

/** One step of the reply. */
export type Step =
  | { readonly say: string }
  | { readonly call: { readonly name: string; readonly args: unknown } }
  | {
      readonly backendCall: {
        readonly id: string
        readonly args: unknown
        readonly message: string
      }
    }
  | { readonly backendResult: { readonly toolCallId: string; readonly content: unknown } }

type JsonObject = Readonly<Record<string, unknown>>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(message: Message | undefined): string {
  if (message === undefined || !('content' in message)) return ''
  const { content } = message
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(part => (isObject(part) && typeof part['text'] === 'string' ? part['text'] : ''))
    .join(' ')
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** Lower-case words of three letters or more, for matching a message against a tool. */
function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(word => word.length >= 3),
  )
}

/** Words a request shares with everything, which say nothing about the tool it means. */
const STOP_WORDS = new Set([
  'the',
  'this',
  'that',
  'and',
  'for',
  'with',
  'please',
  'can',
  'you',
  'what',
  'where',
  'when',
  'why',
  'how',
  'who',
  'does',
  'about',
  'here',
  'there',
])

function overlap(request: ReadonlySet<string>, text: string): number {
  let score = 0
  for (const word of words(text)) if (request.has(word) && !STOP_WORDS.has(word)) score += 1
  return score
}

/** An id such as `A-7` or `W-1042` in the message, to fill an id-shaped input with. */
function idIn(text: string): string | undefined {
  return /\b[A-Za-z]{1,4}-\d+\b/.exec(text)?.[0]
}

/** A value the schema accepts, from its default, first enum value or type. */
export function exampleOf(schema: unknown, hint: { readonly id?: string } = {}, key = ''): unknown {
  if (!isObject(schema)) return null
  if ('default' in schema) return schema['default']
  if ('const' in schema) return schema['const']
  const choices = schema['enum']
  if (Array.isArray(choices) && choices.length > 0) return choices[0] as unknown
  const variants = schema['anyOf'] ?? schema['oneOf']
  if (Array.isArray(variants) && variants.length > 0) return exampleOf(variants[0], hint, key)

  switch (schema['type']) {
    case 'object': {
      const properties = isObject(schema['properties']) ? schema['properties'] : {}
      const required = Array.isArray(schema['required']) ? (schema['required'] as unknown[]) : []
      const value: Record<string, unknown> = {}
      for (const [name, property] of Object.entries(properties)) {
        if (required.includes(name)) value[name] = exampleOf(property, hint, name)
      }
      return value
    }
    case 'array':
      return []
    case 'string':
      return /id$/i.test(key) && hint.id !== undefined ? hint.id : ''
    case 'number':
    case 'integer':
      return typeof schema['minimum'] === 'number' ? schema['minimum'] : 0
    case 'boolean':
      return false
    default:
      return null
  }
}

function toolNamed(tools: readonly Tool[], name: string): Tool | undefined {
  return tools.find(tool => tool.name === name)
}

/** The enum of one property of a tool's input, such as the Apps `navigate` goes to. */
function enumOf(tool: Tool | undefined, property: string): string[] {
  const properties = isObject(tool?.parameters) ? tool.parameters['properties'] : undefined
  const schema = isObject(properties) ? properties[property] : undefined
  // An array of names keeps its enum on the items.
  const items = isObject(schema) && isObject(schema['items']) ? schema['items'] : schema
  const choices = isObject(items) ? items['enum'] : undefined
  return Array.isArray(choices) ? choices.filter(choice => typeof choice === 'string') : []
}

/** Where the user is, as the shell's agent context says. */
function whereabouts(context: readonly Context[]): {
  readonly pathname: string
  readonly apps: readonly string[]
  readonly others: readonly Context[]
} {
  let pathname = '/'
  let apps: string[] = []
  const others: Context[] = []
  for (const entry of context) {
    const value = parse(entry.value)
    if (isObject(value) && isObject(value['url']) && Array.isArray(value['apps'])) {
      pathname = typeof value['url']['pathname'] === 'string' ? value['url']['pathname'] : '/'
      apps = value['apps'].flatMap(app =>
        isObject(app) && typeof app['definitionId'] === 'string' ? [app['definitionId']] : [],
      )
    } else {
      others.push(entry)
    }
  }
  return { pathname, apps, others }
}

const HELP = [
  'I am the development agent: a script that reads a few words, not a model.',
  'Try "go to operations", "show a table of your tools", "chart the tools", "summarise the page",',
  '"show the well design widget", "ask me something", "shut in W-1", or the name of an action',
  'on the page, such as "acknowledge alert A-7".',
  'Set ANTHROPIC_API_KEY and AGENT_DEV_MODEL to talk to a real model instead.',
].join(' ')

/** The reply to a run whose last message is the user's. A quoted selection is context, not the request. */
function answerRequest(input: RunAgentInput, message: string): Step[] {
  const request = message
    .split('\n')
    .filter(line => !line.startsWith('>'))
    .join('\n')
  const text = request.toLowerCase()
  const asked = words(request)
  const { tools } = input
  const has = (name: string): boolean => toolNamed(tools, name) !== undefined

  if (/^\s*(help|hi|hello|hey|\?)\b/.test(text) || text.trim() === '') return [{ say: HELP }]

  if (/\bshut[\s-]?in\b/.test(text)) {
    const wellId = idIn(request) ?? 'W-1'
    return [
      { say: `Shutting in ${wellId} stops its production, so I need your approval first.` },
      {
        backendCall: {
          id: `call_shut_in_${input.runId}`,
          args: { wellId },
          message: `Shut in well ${wellId}? It stops the well producing until someone opens it again.`,
        },
      },
    ]
  }

  if (/\b(go to|open|navigate|take me)\b/.test(text) && has(SHELL.navigate)) {
    const apps = enumOf(toolNamed(tools, SHELL.navigate), 'app')
    const app =
      apps.find(candidate => text.includes(candidate.replace(/-/g, ' '))) ??
      apps.find(candidate => text.includes(candidate))
    if (app !== undefined) {
      const id = idIn(request)
      return [
        { say: `Taking you to ${app}.` },
        { call: { name: SHELL.navigate, args: { app, path: id === undefined ? '/' : `/${id}` } } },
      ]
    }
  }

  if (/\btable\b/.test(text) && has(SHELL.table)) {
    return [
      { say: 'Here are the tools the page gives me now.' },
      {
        call: {
          name: SHELL.table,
          args: {
            title: 'Tools on this page',
            columns: [
              { key: 'name', label: 'Tool' },
              { key: 'description', label: 'What it does' },
            ],
            rows: tools.map(tool => ({ name: tool.name, description: tool.description })),
          },
        },
      },
    ]
  }

  if (/\bchart\b/.test(text) && has(SHELL.chart)) {
    const counts = new Map<string, number>()
    for (const tool of tools) {
      const owner = tool.name.includes('__') ? (tool.name.split('__')[0] ?? 'shell') : 'shell'
      counts.set(owner, (counts.get(owner) ?? 0) + 1)
    }
    return [
      { say: 'The tools on this page, by who offers them.' },
      {
        call: {
          name: SHELL.chart,
          args: {
            title: 'Tools by owner',
            kind: 'bar',
            x: { key: 'owner', label: 'Owner' },
            series: [{ key: 'tools', label: 'Tools' }],
            data: [...counts].map(([owner, count]) => ({ owner, tools: count })),
          },
        },
      },
    ]
  }

  if (/\bsummar/.test(text) && has(SHELL.summary)) {
    const { pathname, apps, others } = whereabouts(input.context)
    return [
      {
        call: {
          name: SHELL.summary,
          args: {
            title: 'Where you are',
            summary: `The page is ${pathname}.`,
            facts: [
              { label: 'Apps', value: apps.length === 0 ? 'None' : apps.join(', ') },
              { label: 'Selections', value: String(others.length) },
              { label: 'Tools', value: String(tools.length) },
              ...others.map(entry => ({ label: entry.description, value: entry.value })),
            ],
          },
        },
      },
    ]
  }

  if (/\b(ask me|question)\b/.test(text) && has(SHELL.askUser)) {
    return [
      {
        call: {
          name: SHELL.askUser,
          args: {
            title: 'Before I go on',
            questions: [
              {
                name: 'priority',
                question: 'What matters most for this well?',
                choices: [
                  { value: 'cost', label: 'Cost' },
                  { value: 'schedule', label: 'Schedule' },
                  { value: 'risk', label: 'Risk' },
                ],
                freeform: true,
                required: true,
              },
            ],
          },
        },
      },
    ]
  }

  const renderWidget = toolNamed(tools, SHELL.renderWidget)
  if (/\bwidget\b/.test(text) && renderWidget !== undefined) {
    const widgets = enumOf(renderWidget, 'widgetId')
    const widgetId =
      widgets
        .map(id => ({ id, score: overlap(asked, id.replace(/-/g, ' ')) }))
        .sort((a, b) => b.score - a.score)[0]?.id ?? widgets[0]
    if (widgetId !== undefined) {
      // The render tool offers each Widget's inputs as one `anyOf` variant, titled with its id.
      const properties = isObject(renderWidget.parameters)
        ? renderWidget.parameters['properties']
        : undefined
      const inputs = isObject(properties) ? properties['inputs'] : undefined
      const variants = isObject(inputs) && Array.isArray(inputs['anyOf']) ? inputs['anyOf'] : []
      const schema: unknown = variants.find(
        (variant: unknown) => isObject(variant) && variant['title'] === widgetId,
      )
      return [
        { say: `Here is ${widgetId}.` },
        { call: { name: SHELL.renderWidget, args: { widgetId, inputs: exampleOf(schema) } } },
      ]
    }
  }

  // An action on the page, by the words of its name and description.
  const best = tools
    .filter(tool => !SHELL_TOOL_NAMES.has(tool.name))
    .map(tool => ({
      tool,
      score: overlap(asked, `${tool.name.replace(/[_-]/g, ' ')} ${tool.description}`),
    }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0]
  if (best !== undefined) {
    const id = idIn(request)
    const args = exampleOf(best.tool.parameters, id === undefined ? {} : { id })
    return [{ call: { name: best.tool.name, args } }]
  }

  // One the page has but did not declare: ask for it by name.
  const hidden = enumOf(toolNamed(tools, SHELL.discover), 'names')
    .map(name => ({ name, score: overlap(asked, name.replace(/[_-]/g, ' ')) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
  if (hidden.length > 0) {
    return [{ call: { name: SHELL.discover, args: { names: hidden.map(({ name }) => name) } } }]
  }

  return [{ say: HELP }]
}

/** What the result of a page tool says, in a sentence. */
function describeResult(name: string, content: unknown): string {
  if (!isObject(content)) return `${name} returned ${JSON.stringify(content)}.`
  const status = content['status']
  const reason = typeof content['reason'] === 'string' ? content['reason'] : undefined
  const error = isObject(content['error']) ? content['error']['message'] : content['error']

  if (name === SHELL.askUser) {
    return status === 'answered'
      ? `Thanks. You answered ${JSON.stringify(content['answers'])}.`
      : 'You did not answer, so I will leave it there.'
  }
  switch (status) {
    case 'executed':
      return content['value'] === undefined || content['value'] === null
        ? 'Done.'
        : `Done: ${JSON.stringify(content['value'])}.`
    case 'navigated':
      return 'You are there now.'
    case 'declined':
      return 'You declined, so I left it as it was.'
    case 'denied':
    case 'blocked':
      return `The page would not do it${reason === undefined ? '' : `: ${reason}`}.`
    default:
      return typeof error === 'string' ? `That did not work: ${error}` : `${name} answered.`
  }
}

/** The steps of a reply, from what the run was sent. */
export function decide(input: RunAgentInput): Step[] {
  const { messages } = input

  // The answer to the backend's own approval: run its tool, or say it did not.
  const approval = input.resume?.find(entry => entry.interruptId.startsWith(APPROVAL_PREFIX))
  if (approval !== undefined) {
    const toolCallId = approval.interruptId.slice(APPROVAL_PREFIX.length)
    const call = messages
      .flatMap(message => (message.role === 'assistant' ? (message.toolCalls ?? []) : []))
      .find(candidate => candidate.id === toolCallId)
    const args = parse(call?.function.arguments ?? '{}')
    const wellId =
      isObject(args) && typeof args['wellId'] === 'string' ? args['wellId'] : 'the well'
    const approved = isObject(approval.payload) && approval.payload['approved'] === true
    if (approval.status === 'resolved' && approved) {
      return [
        { backendResult: { toolCallId, content: { status: 'shut-in', wellId } } },
        { say: `${wellId} is shut in. (The development agent only pretends.)` },
      ]
    }
    return [
      { backendResult: { toolCallId, content: { status: 'declined' } } },
      { say: `I left ${wellId} producing.` },
    ]
  }

  const last = messages.at(-1)
  if (last?.role === 'tool') {
    const call = messages
      .flatMap(message => (message.role === 'assistant' ? (message.toolCalls ?? []) : []))
      .find(candidate => candidate.id === last.toolCallId)
    const name = call?.function.name ?? 'The tool'
    // Tools found: carry on with the request that needed them.
    if (name === SHELL.discover) {
      const request = messages.findLast(message => message.role === 'user')
      const retried = answerRequest(input, textOf(request))
      return retried.some(step => 'call' in step && step.call.name === SHELL.discover)
        ? [{ say: 'I found no tool on this page for that.' }]
        : retried
    }
    return [{ say: describeResult(name, parse(textOf(last))) }]
  }

  return answerRequest(input, textOf(last))
}

export interface DemoModelOptions {
  /** The pause between events, so the page shows a reply arriving. Defaults to 40 ms. */
  readonly delayMs?: number
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (ms <= 0 || signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

export function demoModel(options: DemoModelOptions = {}): Model {
  const delay = options.delayMs ?? 40

  return async function* run(input, signal) {
    const steps = decide(input)
    const messageId = `msg_${input.runId}`
    const pending: string[] = []
    let interrupt:
      { readonly id: string; readonly toolCallId: string; readonly message: string } | undefined
    const events: AGUIEvent[] = [runStarted(input)]

    steps.forEach((step, index) => {
      if ('say' in step) {
        events.push(
          ...textMessage(index === 0 ? messageId : `${messageId}_${String(index)}`, step.say),
        )
      } else if ('call' in step) {
        const id = `call_${input.runId}_${String(index)}`
        pending.push(id)
        events.push(...toolCall(id, step.call.name, step.call.args, messageId))
      } else if ('backendCall' in step) {
        events.push(
          ...toolCall(step.backendCall.id, SHUT_IN_WELL, step.backendCall.args, messageId),
        )
        interrupt = {
          id: `${APPROVAL_PREFIX}${step.backendCall.id}`,
          toolCallId: step.backendCall.id,
          message: step.backendCall.message,
        }
      } else {
        events.push(
          toolResult(
            `result_${input.runId}`,
            step.backendResult.toolCallId,
            step.backendResult.content,
          ),
        )
      }
    })

    events.push(
      interrupt === undefined
        ? runFinished(input, pending)
        : runInterrupted(input, [{ ...interrupt, reason: 'tool_call' }]),
    )

    for (const event of events) {
      if (signal.aborted) return
      await pause(delay, signal)
      yield event
    }
  }
}
