/**
 * One tool call in the transcript. The shell's own tools render as what they show: a Widget, a
 * table, a chart, a summary, a question. Every other call, a page action or a backend tool, is one
 * generic card with its label and its stage, and its inputs and result behind a disclosure.
 */

import { lazy, Suspense, useId, useRef, type ReactNode } from 'react'
import { DISCOVER_TOOLS, type ToolCallPart } from '@company/mfe-agent'
import { DynamicWidget } from '@company/mfe-react'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@tecton/react/components/collapsible'
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from '@tecton/react/components/questionnaire'
import { Skeleton } from '@tecton/react/components/skeleton'
import { Spinner } from '@tecton/react/components/spinner'
import {
  CheckIcon,
  ChevronDownIcon,
  CircleSlashIcon,
  RotateCcwIcon,
  ShieldQuestionIcon,
  TriangleAlertIcon,
} from 'lucide-react'

import { A2uiSurface } from './a2ui/surface.tsx'
import { useActionLabel, useQuestions } from './hooks.ts'
import { SummaryView, TableView } from './renderers.tsx'
import type { ShellChat } from './shell-chat.ts'
import { humanize, reasonOf, stageOf, STAGE_TEXT, type ToolStage } from './tool-stage.ts'
import type { Answers, AskUserInput, PendingQuestion } from './tools/ask-user.ts'
import { SHELL_TOOLS } from './tools/names.ts'
import { readRenderWidgetInput } from './tools/render-widget.ts'
import { ChartInput, SummaryInput, TableInput } from './tools/renderers.ts'
import { focusAfterAnswer, useFocusWhenWaiting, WAITING } from './waiting-focus.ts'

export function ToolCallView({
  chat,
  part,
}: {
  readonly chat: ShellChat
  readonly part: ToolCallPart
}): ReactNode {
  switch (part.name) {
    case SHELL_TOOLS.renderWidget:
      return <WidgetCall chat={chat} part={part} />
    case SHELL_TOOLS.table:
    case SHELL_TOOLS.chart:
    case SHELL_TOOLS.summary:
      return <RendererCall part={part} />
    case SHELL_TOOLS.askUser:
      return <AskUserCall chat={chat} part={part} />
    case SHELL_TOOLS.a2ui:
      return <A2uiCall chat={chat} part={part} />
    default:
      return <ToolCard part={part} />
  }
}

// ─── The generic card ─────────────────────────────────────────────────────────

const STAGE_BADGE: Readonly<
  Record<ToolStage, 'secondary' | 'info' | 'warning' | 'success' | 'destructive'>
> = {
  preparing: 'secondary',
  approval: 'warning',
  running: 'info',
  done: 'success',
  declined: 'secondary',
  failed: 'destructive',
}

function StageIcon({ stage }: { readonly stage: ToolStage }): ReactNode {
  switch (stage) {
    case 'preparing':
    case 'running':
      return <Spinner className="size-3.5" />
    case 'approval':
      return <ShieldQuestionIcon className="size-3.5 text-muted-foreground" aria-hidden />
    case 'done':
      return <CheckIcon className="size-3.5 text-success" aria-hidden />
    case 'declined':
      return <CircleSlashIcon className="size-3.5 text-muted-foreground" aria-hidden />
    case 'failed':
      return <TriangleAlertIcon className="size-3.5 text-destructive" aria-hidden />
  }
}

/** What the card calls a call: the action's label, where the page offers it, or its name. */
function useToolLabel(part: ToolCallPart): string {
  const actionLabel = useActionLabel(part.name)
  if (part.name === SHELL_TOOLS.navigate) {
    const input = part.input as { app?: unknown; path?: unknown } | undefined
    const app = typeof input?.app === 'string' ? input.app : undefined
    const path = typeof input?.path === 'string' && input.path !== '/' ? input.path : ''
    return app === undefined ? 'Go to a page' : `Go to ${app}${path}`
  }
  if (part.name === DISCOVER_TOOLS) return 'Look for tools'
  return actionLabel ?? humanize(part.name)
}

/**
 * A disclosure that opens and closes by its height, which React Aria sets as
 * `--disclosure-panel-height` for the length of the change, rather than in one step.
 */
export const DISCLOSURE_MOTION =
  'h-(--disclosure-panel-height) overflow-clip transition-[height] duration-200 ease-out motion-reduce:transition-none'

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function ToolCard({
  part,
  label: labelOverride,
}: {
  readonly part: ToolCallPart
  readonly label?: string
}): ReactNode {
  const label = useToolLabel(part)
  const stage = stageOf(part)
  const reason = stage === 'declined' || stage === 'failed' ? reasonOf(part.output) : undefined

  return (
    <Collapsible
      data-slot="chat-tool-call"
      data-stage={stage}
      className="group/tool rounded-lg border border-border-subtle bg-card text-xs"
    >
      <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <StageIcon stage={stage} />
        <span className="min-w-0 flex-1 truncate font-medium">{labelOverride ?? label}</span>
        <Badge variant={STAGE_BADGE[stage]}>{STAGE_TEXT[stage]}</Badge>
        <ChevronDownIcon
          className="size-3.5 shrink-0 transition-transform group-data-expanded/tool:rotate-180"
          aria-hidden
        />
      </CollapsibleTrigger>
      {reason !== undefined && <p className="px-3 pb-2 text-muted-foreground">{reason}</p>}
      <CollapsibleContent className={DISCLOSURE_MOTION}>
        <div className="flex flex-col gap-2 border-t border-border-subtle px-3 py-2">
          <div>
            <p className="mb-1 font-medium text-muted-foreground">Inputs</p>
            <pre className="overflow-x-auto font-mono text-[0.6875rem] whitespace-pre-wrap">
              {part.input === undefined ? part.arguments || '…' : json(part.input)}
            </pre>
          </div>
          {part.output !== undefined && (
            <div>
              <p className="mb-1 font-medium text-muted-foreground">Result</p>
              <pre className="overflow-x-auto font-mono text-[0.6875rem] whitespace-pre-wrap">
                {json(part.output)}
              </pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ─── The built-in renderers ───────────────────────────────────────────────────

/** Recharts is loaded only when a chart is drawn, not with the chat. */
const ChartView = lazy(async () => ({ default: (await import('./chart-view.tsx')).ChartView }))

function RendererSkeleton(): ReactNode {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-subtle p-3" aria-hidden>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-20 w-full" />
    </div>
  )
}

function RendererCall({ part }: { readonly part: ToolCallPart }): ReactNode {
  const stage = stageOf(part)
  if (stage === 'preparing') return <RendererSkeleton />

  if (part.name === SHELL_TOOLS.table) {
    const parsed = TableInput.safeParse(part.input)
    if (parsed.success) return <TableView input={parsed.data} />
  } else if (part.name === SHELL_TOOLS.chart) {
    const parsed = ChartInput.safeParse(part.input)
    if (parsed.success) {
      return (
        <Suspense fallback={<RendererSkeleton />}>
          <ChartView input={parsed.data} />
        </Suspense>
      )
    }
  } else {
    const parsed = SummaryInput.safeParse(part.input)
    if (parsed.success) return <SummaryView input={parsed.data} />
  }
  // Inputs the schema refuses: the card says so, with the tool's own reason.
  return <ToolCard part={part} label={humanize(part.name)} />
}

// ─── A Widget in the chat ─────────────────────────────────────────────────────

/** Props the host sets itself, never taken from the agent's inputs. */
const HOST_PROPS = new Set(['widgetId', 'fallback', 'pending', 'key', 'ref', 'children'])

function inputsOnly(inputs: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(inputs).filter(([name]) => !HOST_PROPS.has(name) && !/^on[A-Z]/.test(name)),
  )
}

function WidgetSkeleton(): ReactNode {
  return (
    <div
      data-slot="chat-widget-skeleton"
      className="flex flex-col gap-2 rounded-lg border border-border-subtle p-3"
      aria-hidden
    >
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

function WidgetCall({
  chat,
  part,
}: {
  readonly chat: ShellChat
  readonly part: ToolCallPart
}): ReactNode {
  const stage = stageOf(part)
  const input = readRenderWidgetInput(part.input)
  if (stage === 'preparing' || input === undefined) return <WidgetSkeleton />
  if (stage === 'failed') return <ToolCard part={part} label={`Show ${input.widgetId}`} />

  return (
    <div
      data-slot="chat-widget"
      className="rounded-lg border border-border-subtle bg-card p-3"
      aria-label={`The ${input.widgetId} Widget`}
      role="group"
    >
      <DynamicWidget
        {...inputsOnly(input.inputs)}
        widgetId={input.widgetId}
        // The passive way back: the latest value of each output, for later turns (agentic plan, F).
        onOutput={(output: string, payload: unknown) => {
          chat.outputs.record(part.id, input.widgetId, output, payload)
        }}
        pending={<WidgetSkeleton />}
        fallback={({ error, retry }) => (
          <div role="alert" className="flex flex-col gap-2 text-xs">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <TriangleAlertIcon className="size-3.5" aria-hidden /> {error.code}
            </p>
            <p className="whitespace-pre-wrap text-muted-foreground">{error.message}</p>
            <div>
              <Button variant="outline" size="xs" onPress={retry}>
                <RotateCcwIcon /> Retry
              </Button>
            </div>
          </div>
        )}
      />
    </div>
  )
}

// ─── A2UI ─────────────────────────────────────────────────────────────────────

function A2uiCall({
  chat,
  part,
}: {
  readonly chat: ShellChat
  readonly part: ToolCallPart
}): ReactNode {
  const stage = stageOf(part)
  if (stage === 'preparing' || stage === 'running') return <RendererSkeleton />
  const output = part.output as { status?: string; surfaceId?: string } | undefined
  const surfaceId = output?.surfaceId
  if (output?.status !== 'rendered' || surfaceId === undefined) {
    return <ToolCard part={part} label="Show a form" />
  }
  // A later call that changed a surface already shown is a note; the surface itself stays where
  // it was first drawn, and shows the change there.
  if (chat.a2ui.createdBy(surfaceId) !== part.id) {
    return <ToolCard part={part} label="Update what is shown above" />
  }
  return (
    <A2uiSurface
      surfaces={chat.a2ui}
      surfaceId={surfaceId}
      imageOrigins={chat.imageOrigins}
      handlers={{
        write: (path, value) => {
          chat.a2ui.write(surfaceId, path, value)
        },
        act: (action, label) => {
          chat.a2uiAction(action, label)
        },
      }}
    />
  )
}

// ─── Asking the user ──────────────────────────────────────────────────────────

function answersFrom(form: HTMLFormElement, input: AskUserInput): Answers {
  const data = new FormData(form)
  const answers: Record<string, string | readonly string[]> = {}
  for (const question of input.questions) {
    const values = data
      .getAll(question.name)
      .flatMap(value => (typeof value === 'string' && value.trim() !== '' ? [value.trim()] : []))
    if (values.length === 0) continue
    answers[question.name] = question.multiple === true ? values : (values[0] ?? '')
  }
  return answers
}

function describeAnswer(value: string | readonly string[]): string {
  return typeof value === 'string' ? value : value.join(', ')
}

function AskUserCall({
  chat,
  part,
}: {
  readonly chat: ShellChat
  readonly part: ToolCallPart
}): ReactNode {
  const pending = useQuestions(chat).get(part.id)
  const stage = stageOf(part)

  if (pending === undefined) {
    if (stage === 'preparing' || stage === 'running') return <RendererSkeleton />
    const output = part.output as { status?: string; answers?: Answers } | undefined
    if (output?.status === 'answered' && output.answers !== undefined) {
      return (
        <div
          data-slot="chat-answers"
          className="rounded-lg border border-border-subtle p-3 text-xs"
        >
          <p className="mb-1 font-medium">You answered</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {Object.entries(output.answers).map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="text-muted-foreground">{name}</dt>
                <dd>{describeAnswer(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )
    }
    return <ToolCard part={part} label="A question for you" />
  }

  return <QuestionForm chat={chat} pending={pending} />
}

/**
 * The question the agent asked, answered here. It takes focus when the user is waiting on the
 * assistant, and is announced otherwise (`waiting-focus.ts`).
 */
function QuestionForm({
  chat,
  pending,
}: {
  readonly chat: ShellChat
  readonly pending: PendingQuestion
}): ReactNode {
  const card = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useFocusWhenWaiting(
    chat,
    card,
    `The assistant asks: ${pending.input.title ?? pending.input.questions[0]?.question ?? 'a question'}`,
    // In the transcript, not pinned above the composer as an approval is.
    'The questions are at the end of the conversation, above the message box.',
  )
  const { input } = pending
  const items = input.questions.map(question => ({
    name: question.name,
    required: question.required === true,
    ...(question.choices === undefined
      ? {}
      : { choices: question.choices.map(choice => ({ value: choice.value })) }),
  }))

  return (
    <div
      ref={card}
      role="group"
      aria-labelledby={titleId}
      tabIndex={-1}
      {...{ [WAITING]: '' }}
      data-slot="chat-question"
      className="rounded-lg border border-border bg-card p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p
        id={titleId}
        className={input.title === undefined ? 'sr-only' : 'mb-3 text-sm font-medium'}
      >
        {input.title ?? 'A question from the assistant'}
      </p>
      <Questionnaire
        items={items}
        shortcuts="letters"
        onSubmit={event => {
          event.preventDefault()
          focusAfterAnswer(chat, card.current)
          pending.answer(answersFrom(event.currentTarget, input))
        }}
      >
        {items.length > 1 && <QuestionnaireProgress />}
        {input.questions.map(question => (
          <QuestionnaireItem
            key={question.name}
            name={question.name}
            required={question.required === true}
            multiple={question.multiple === true}
          >
            <QuestionnaireTitle>{question.question}</QuestionnaireTitle>
            {question.description !== undefined && (
              <QuestionnaireDescription>{question.description}</QuestionnaireDescription>
            )}
            <QuestionnaireChoices>
              {question.choices?.map(choice => (
                <QuestionnaireChoice key={choice.value} value={choice.value}>
                  <span className="font-medium">{choice.label}</span>
                  {choice.description !== undefined && (
                    <QuestionnaireChoiceDescription>
                      {choice.description}
                    </QuestionnaireChoiceDescription>
                  )}
                </QuestionnaireChoice>
              ))}
              {(question.freeform === true || question.choices === undefined) && (
                <QuestionnaireInput aria-label={question.question} placeholder="Type an answer…" />
              )}
            </QuestionnaireChoices>
          </QuestionnaireItem>
        ))}
        <QuestionnaireActions>
          <Button
            variant="ghost"
            size="sm"
            className="col-start-2 row-start-1 justify-self-end"
            onPress={() => {
              focusAfterAnswer(chat, card.current)
              pending.decline()
            }}
          >
            Don’t answer
          </Button>
          {items.length > 1 && <QuestionnairePrevious size="sm" />}
          {items.length > 1 && <QuestionnaireNext size="sm" />}
          <QuestionnaireSubmit size="sm">Answer</QuestionnaireSubmit>
        </QuestionnaireActions>
      </Questionnaire>
    </div>
  )
}
