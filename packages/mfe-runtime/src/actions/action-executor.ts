/**
 * Running an action, whoever asks: the palette, a shortcut, the App's own UI, an agent or the
 * host's own code. Every caller goes through the same ordered steps, so they share one decision,
 * one input check, one failure report and one audit record:
 *
 *   decide (`canExecute`) → validate the input → approval → serialize writes → execute → audit
 *
 * Approval and serializing apply to an agent's calls alone: a user who runs an action is its
 * approval, and a user's run may itself run another action, which a queue would deadlock. Every
 * run is audited, however it ends (`action-audit.ts`). The registry owns everything else about an
 * action: its scope, its entry and its keys.
 */

import {
  allow,
  createMfeError,
  DEFAULT_ACTION_PLACEMENTS,
  toMfeError,
  withoutUndefined,
  type ActionEffect,
  type ActionInputSchema,
  type ActionRegistration,
  type Decision,
  type DefinitionKind,
  type MfeError,
} from '@company/mfe-core'
import { z } from 'zod'

import type { DiagnosticsHub } from '../diagnostics.ts'
import {
  redactInput,
  type ActionActor,
  type ActionAuditRecord,
  type ActionAuditSink,
  type ActionTurn,
} from './action-audit.ts'

/**
 * Who asked for the run. A denial reaches the user only when a user asked (the palette, a
 * shortcut, the App's own UI); `'system'` is the host's own code, acting for nobody.
 */
export type ActionCaller = 'palette' | 'shortcut' | 'ui' | 'agent' | 'system'

/** One request to run an action. */
export interface ActionCall {
  readonly caller: ActionCaller
  /** Validated against the action's `inputSchema`; absent is an empty object. */
  readonly input?: unknown
  /** The chat thread and turn an agent's call came from, recorded in the audit. */
  readonly turn?: ActionTurn
}

/** Who a caller acts for. */
function actorOf(caller: ActionCaller): ActionActor {
  return caller === 'agent' ? 'agent' : caller === 'system' ? 'system' : 'user'
}

export type ActionExecutionResult<Value = unknown> =
  /** `value` is what the action's `execute` returned, once awaited and checked. */
  | { readonly status: 'executed'; readonly value: Value }
  /** `canExecute`, the host's approval policy, or a placement that does not offer it, refused. */
  | { readonly status: 'denied'; readonly reason: string }
  /** The user was asked and said no. */
  | { readonly status: 'declined'; readonly reason: string }
  /** The input did not match the action's `inputSchema`, so nothing ran. */
  | { readonly status: 'invalid'; readonly error: MfeError }
  | { readonly status: 'unavailable'; readonly error: MfeError }
  | { readonly status: 'failed'; readonly error: MfeError }

/**
 * What an action's own `useAction` or `injectAction` returns: a run with the caller `'ui'`, so the
 * App's button shares validation, approval and audit with every other caller. The input is
 * optional when the schema accepts an empty object.
 */
export type ActionRun<Input extends ActionInputSchema = ActionInputSchema, Output = unknown> =
  Record<string, never> extends z.input<Input>
    ? (input?: z.input<Input>) => Promise<ActionExecutionResult<Output>>
    : (input: z.input<Input>) => Promise<ActionExecutionResult<Output>>

/** How a denial reaches the user: the shell's normal notification surface. */
export type ActionDenialNotifier = (notice: {
  readonly actionId: string
  readonly label: string
  readonly reason: string
  readonly caller: ActionCaller
}) => void

/** One agent call waiting on a ruling, with the input it would run with. */
export interface ApprovalRequest {
  readonly actionId: string
  readonly definitionId: string
  readonly label: string
  readonly description?: string
  readonly effect: ActionEffect
  readonly input: Readonly<Record<string, unknown>>
}

/** Run it, ask the user, or refuse it with a reason the agent is told. */
export type ApprovalRuling = 'approve' | 'ask' | { readonly deny: string }

/**
 * The host's rule over every agent call, on top of what the action declares (`declared`, from its
 * `effect` and `needsApproval`). `undefined` keeps the declared ruling. It is data the organization
 * owns, so it can tighten or relax one action without touching the App that registers it.
 */
export type ActionApprovalPolicy = (
  request: ApprovalRequest,
  declared: 'approve' | 'ask',
) => ApprovalRuling | undefined

/** Asks the user about one call and resolves whether they approved it: the chat's card. */
export type ActionApprover = (request: ApprovalRequest) => Promise<boolean>

/** What running an action reads of it; the registry keeps the rest. */
export interface RunnableAction {
  readonly qualifiedId: string
  readonly definitionId: string
  /** The host page's actions count as an App's. */
  readonly definitionKind: DefinitionKind
  readonly registration: ActionRegistration
}

export interface ActionExecutorOptions<Action extends RunnableAction> {
  readonly diagnostics?: DiagnosticsHub | undefined
  readonly notifyDenial?: ActionDenialNotifier | undefined
  /** Runs before the user is told of a denial, so what the palette shows agrees with the notice. */
  readonly onDenied?: ((action: Action) => void) | undefined
  readonly approvalPolicy?: ActionApprovalPolicy | undefined
  /** Read at each call that asks, because the surface that asks comes and goes. */
  readonly approver?: (() => ActionApprover | undefined) | undefined
  /** Whether the action is still registered, read after a wait: its mount may have gone. */
  readonly isLive?: ((action: Action) => boolean) | undefined
  /** Takes one record for every run, however it ended. */
  readonly audit?: ActionAuditSink | undefined
  /** The signed-in user's id, read as a run is audited. */
  readonly readUserId?: (() => string | undefined) | undefined
  /** Injectable so a test can fix the audit's times. */
  readonly now?: (() => number) | undefined
}

const NO_INPUT: ActionInputSchema = z.object({})

export function effectOf(registration: ActionRegistration): ActionEffect {
  return registration.effect ?? 'write'
}

/**
 * `canExecute`, read so that a throw denies: treating a failed availability check as allowed would
 * run an action whose preconditions are unknown.
 */
export function decide(
  definitionId: string,
  registration: ActionRegistration,
  diagnostics: DiagnosticsHub | undefined,
): Decision {
  const { canExecute } = registration
  if (!canExecute) return allow()

  try {
    return canExecute()
  } catch (error) {
    diagnostics?.report(
      toMfeError(error, {
        code: 'mount/failure',
        id: definitionId,
        operation: `evaluate canExecute for '${registration.name}'`,
        repair:
          'canExecute must be a pure synchronous read of reactive state. Move the failing work into execute.',
      }),
    )
    return {
      allowed: false,
      reason: 'This action is unavailable because its availability check failed.',
    }
  }
}

type Parsed =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly error: MfeError }

export class ActionExecutor<Action extends RunnableAction> {
  readonly #options: ActionExecutorOptions<Action>
  /** The last queued agent write, settled either way; the next one waits for it. */
  #writes: Promise<unknown> = Promise.resolve()

  constructor(options: ActionExecutorOptions<Action> = {}) {
    this.#options = options
  }

  /**
   * A denial does not run the action and does not fail silently: the reason goes back to the
   * caller and, when a user asked, to the shell's notification surface. An agent's denial goes
   * back to the agent alone, which tells the user in its own words.
   */
  async run(action: Action, call: ActionCall): Promise<ActionExecutionResult> {
    const startedAt = this.#now()
    let result: ActionExecutionResult
    try {
      result = await this.#run(action, call)
    } catch (error) {
      // A host hook (the denial notifier) or a schema's own refinement threw: the run still ends in
      // a result the caller can read, and is still audited.
      result = {
        status: 'failed',
        error: this.#report(error, action, `run action '${action.registration.name}'`, {
          repair: 'The host’s hooks and the action’s schemas must not throw.',
        }),
      }
    }
    this.audit(action, call, result, startedAt)
    return result
  }

  /**
   * Records one run. The registry calls it too, for a call to an action that is no longer
   * registered, which never reaches `run`. A sink that throws is reported, and the run's result
   * stands.
   */
  audit(
    action: Pick<RunnableAction, 'qualifiedId' | 'definitionId' | 'definitionKind'>,
    call: ActionCall,
    result: ActionExecutionResult,
    startedAt: number,
  ): void {
    const { audit, readUserId } = this.#options
    if (!audit) return

    try {
      const record: ActionAuditRecord = {
        actionId: action.qualifiedId,
        definitionId: action.definitionId,
        definitionKind: action.definitionKind,
        actor: actorOf(call.caller),
        caller: call.caller,
        ...withoutUndefined({
          userId: readUserId?.(),
          turn: call.turn,
          reason: 'reason' in result ? result.reason : undefined,
          errorCode: 'error' in result ? result.error.code : undefined,
        }),
        outcome: result.status,
        input: redactInput(call.input ?? {}),
        startedAt: new Date(startedAt).toISOString(),
        durationMs: Math.max(0, this.#now() - startedAt),
      }
      audit(record)
    } catch (error) {
      this.#report(error, action, `audit the run of '${action.qualifiedId}'`, {
        repair: 'The audit sink must not throw; queue the record and deliver it elsewhere.',
      })
    }
  }

  /** Reports a throw from code the executor called, as the action's owner's failure. */
  #report(
    error: unknown,
    action: Pick<RunnableAction, 'definitionId'>,
    operation: string,
    { repair }: { readonly repair: string },
  ): MfeError {
    const structured = toMfeError(error, {
      code: 'mount/failure',
      id: action.definitionId,
      operation,
      repair,
    })
    this.#options.diagnostics?.report(structured)
    return structured
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now()
  }

  async #run(action: Action, call: ActionCall): Promise<ActionExecutionResult> {
    const { registration } = action
    const agent = call.caller === 'agent'
    const denied = this.#decide(action, call)
    if (denied) return denied

    const input = this.#parseInput(action, call.input)
    if (!input.ok) return { status: 'invalid', error: input.error }
    if (!agent) return await this.#execute(action, input.value)

    const ruling = this.#rule(action, input.value)
    if (typeof ruling === 'object') return { status: 'denied', reason: ruling.deny }
    if (ruling === 'ask') {
      const refused = await this.#ask(action, input.value)
      if (refused) return refused
    }

    // Anything awaited gave the page time to change, so the action is looked at again first.
    const waited = ruling === 'ask'
    if (effectOf(registration) === 'read' || registration.parallelSafe === true) {
      return waited
        ? await this.#executeAfterWait(action, call, input.value)
        : await this.#execute(action, input.value)
    }
    return await this.#serialize(() => this.#executeAfterWait(action, call, input.value))
  }

  /**
   * Whether the call may run now: an agent's only to an action placed for the agent, then
   * `canExecute`. Asked again after any wait, since both may have changed.
   */
  #decide(action: Action, call: ActionCall): ActionExecutionResult | undefined {
    const { registration } = action
    if (
      call.caller === 'agent' &&
      !(registration.placements ?? DEFAULT_ACTION_PLACEMENTS).includes('agent')
    ) {
      return { status: 'denied', reason: 'This action is not offered to the agent.' }
    }

    const { diagnostics, notifyDenial, onDenied } = this.#options
    const decision = decide(action.definitionId, action.registration, diagnostics)
    if (decision.allowed) return undefined

    onDenied?.(action)
    if (actorOf(call.caller) === 'user') {
      notifyDenial?.({
        actionId: action.qualifiedId,
        label: action.registration.label,
        reason: decision.reason,
        caller: call.caller,
      })
    }
    return { status: 'denied', reason: decision.reason }
  }

  /** A mismatch is the caller's to fix; it is reported as a warning, since an agent may retry. */
  #parseInput(action: Action, input: unknown): Parsed {
    const schema = action.registration.inputSchema ?? NO_INPUT
    const result = schema.safeParse(input ?? {})
    if (result.success) return { ok: true, value: result.data }

    const error = createMfeError({
      code: 'contract/input-mismatch',
      id: action.definitionId,
      operation: `accept input for action '${action.registration.name}'`,
      direction: 'input',
      ...pathOf(result.error),
      expected: 'input matching the action’s inputSchema',
      observed: z.prettifyError(result.error),
      repair: 'Call the action with input its inputSchema accepts.',
      cause: result.error,
    })
    this.#options.diagnostics?.report(error, { severity: 'warning' })
    return { ok: false, error }
  }

  /**
   * What the action declares, then what the host's policy makes of it. A policy that throws denies:
   * it may exist to refuse what the user could otherwise approve.
   */
  #rule(action: Action, input: Readonly<Record<string, unknown>>): ApprovalRuling {
    const declared = this.#declared(action, input)
    const policy = this.#options.approvalPolicy
    if (!policy) return declared
    try {
      return policy(this.#request(action, input), declared) ?? declared
    } catch (error) {
      this.#report(error, action, `apply the approval policy to '${action.registration.name}'`, {
        repair: 'The approval policy must return a ruling, or undefined to keep the declared one.',
      })
      return { deny: 'The host’s approval policy failed, so the call was not run.' }
    }
  }

  /** A check that throws asks, since the call it was meant to catch may be this one. */
  #declared(action: Action, input: Readonly<Record<string, unknown>>): 'approve' | 'ask' {
    const { needsApproval } = action.registration
    if (needsApproval === undefined) {
      return effectOf(action.registration) === 'read' ? 'approve' : 'ask'
    }
    if (typeof needsApproval === 'boolean') return needsApproval ? 'ask' : 'approve'

    try {
      return needsApproval(input) ? 'ask' : 'approve'
    } catch (error) {
      this.#report(error, action, `evaluate needsApproval for '${action.registration.name}'`, {
        repair: 'needsApproval must be a pure synchronous read of the input.',
      })
      return 'ask'
    }
  }

  async #ask(
    action: Action,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ActionExecutionResult | undefined> {
    const approver = this.#options.approver?.()
    if (!approver) {
      return {
        status: 'denied',
        reason: 'It needs the user’s approval, and this page has nowhere to ask for it.',
      }
    }

    let approved: boolean
    try {
      approved = await approver(this.#request(action, input))
    } catch (error) {
      this.#report(error, action, `ask the user to approve '${action.registration.name}'`, {
        repair: 'The approver must resolve true or false; a rejection counts as declined.',
      })
      approved = false
    }
    return approved ? undefined : { status: 'declined', reason: 'The user declined this call.' }
  }

  #request(action: Action, input: Readonly<Record<string, unknown>>): ApprovalRequest {
    const { registration } = action
    return {
      actionId: action.qualifiedId,
      definitionId: action.definitionId,
      label: registration.label,
      ...withoutUndefined({ description: registration.description }),
      effect: effectOf(registration),
      input,
    }
  }

  /** One agent write at a time, in the order they were asked for; a failure does not stop the next. */
  #serialize(run: () => Promise<ActionExecutionResult>): Promise<ActionExecutionResult> {
    const next = this.#writes.then(run)
    this.#writes = next.catch(() => undefined)
    return next
  }

  async #executeAfterWait(
    action: Action,
    call: ActionCall,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ActionExecutionResult> {
    if (this.#options.isLive?.(action) === false) {
      return {
        status: 'unavailable',
        error: createMfeError({
          code: 'action/unavailable',
          id: action.definitionId,
          operation: `execute action '${action.registration.name}'`,
          expected: 'the registration the call was approved against',
          observed: 'no registration, because its mount went away while the call waited',
          repair: 'List the actions again and call one that is registered now.',
        }),
      }
    }
    return this.#decide(action, call) ?? (await this.#execute(action, input))
  }

  async #execute(
    action: Action,
    input: Readonly<Record<string, unknown>>,
  ): Promise<ActionExecutionResult> {
    const { registration } = action
    let value: unknown
    try {
      value = await registration.execute(input)
    } catch (error) {
      return {
        status: 'failed',
        error: this.#report(error, action, `execute action '${registration.name}'`, {
          repair:
            'Handle the failure inside the action, or surface it through the App’s own error UI.',
        }),
      }
    }

    const { outputSchema } = registration
    if (!outputSchema) return { status: 'executed', value }

    const result = outputSchema.safeParse(value)
    if (result.success) return { status: 'executed', value: result.data }

    const error = createMfeError({
      code: 'contract/output-mismatch',
      id: action.definitionId,
      operation: `return a value from action '${registration.name}'`,
      direction: 'output',
      ...pathOf(result.error),
      expected: 'a value matching the action’s outputSchema',
      observed: z.prettifyError(result.error),
      repair: 'Return what the outputSchema declares from execute, or change the outputSchema.',
      cause: result.error,
    })
    this.#options.diagnostics?.report(error)
    return { status: 'failed', error }
  }
}

function pathOf(error: z.ZodError): { readonly path?: readonly (string | number)[] } {
  const path = (error.issues[0]?.path ?? []).filter(
    (segment): segment is string | number => typeof segment !== 'symbol',
  )
  return path.length > 0 ? { path } : {}
}
