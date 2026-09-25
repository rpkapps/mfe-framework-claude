/**
 * Running an action, whoever asks: the palette, a shortcut, the App's own UI or an agent. Every
 * caller goes through the same ordered steps, so they share one decision, one failure report
 * and, as actions gain the fields for them, one input check, one approval and one audit record:
 *
 *   decide (`canExecute`) → validate the input → approval → serialize writes → execute → audit
 *
 * Only deciding and executing exist yet. The steps between them need an action to declare its
 * input schema, its effect and whether it needs approval, and audit needs a record of who acted;
 * each lands in this module, in that order, with the field it reads (`agentic-plan.md`, A and C).
 * The registry owns everything else about an action: its scope, its entry and its keys.
 */

import {
  allow,
  toMfeError,
  type ActionRegistration,
  type Decision,
  type MfeError,
} from '@company/mfe-core'

import type { DiagnosticsHub } from '../diagnostics.ts'

/** Who asked for the run. A denial reaches the user only when a user asked. */
export type ActionCaller = 'palette' | 'shortcut' | 'ui' | 'agent'

/** One request to run an action. */
export interface ActionCall {
  readonly caller: ActionCaller
}

export type ActionExecutionResult =
  /** `value` is what the action's `execute` returned, once awaited. */
  | { readonly status: 'executed'; readonly value: unknown }
  | { readonly status: 'denied'; readonly reason: string }
  | { readonly status: 'unavailable'; readonly error: MfeError }
  | { readonly status: 'failed'; readonly error: MfeError }

/** How a denial reaches the user: the shell's normal notification surface. */
export type ActionDenialNotifier = (notice: {
  readonly actionId: string
  readonly label: string
  readonly reason: string
  readonly caller: ActionCaller
}) => void

/** What running an action reads of it; the registry keeps the rest. */
export interface RunnableAction {
  readonly qualifiedId: string
  readonly definitionId: string
  readonly registration: ActionRegistration
}

export interface ActionExecutorOptions<Action extends RunnableAction> {
  readonly diagnostics?: DiagnosticsHub | undefined
  readonly notifyDenial?: ActionDenialNotifier | undefined
  /** Runs before the user is told of a denial, so what the palette shows agrees with the notice. */
  readonly onDenied?: ((action: Action) => void) | undefined
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

export class ActionExecutor<Action extends RunnableAction> {
  readonly #options: ActionExecutorOptions<Action>

  constructor(options: ActionExecutorOptions<Action> = {}) {
    this.#options = options
  }

  /**
   * A denial does not run the action and does not fail silently: the reason goes back to the
   * caller and, when a user asked, to the shell's notification surface. An agent's denial goes
   * back to the agent alone, which tells the user in its own words.
   */
  async run(action: Action, call: ActionCall): Promise<ActionExecutionResult> {
    const { diagnostics, notifyDenial, onDenied } = this.#options
    const decision = decide(action.definitionId, action.registration, diagnostics)
    if (!decision.allowed) {
      onDenied?.(action)
      if (call.caller !== 'agent') {
        notifyDenial?.({
          actionId: action.qualifiedId,
          label: action.registration.label,
          reason: decision.reason,
          caller: call.caller,
        })
      }
      return { status: 'denied', reason: decision.reason }
    }

    try {
      const value: unknown = await action.registration.execute()
      return { status: 'executed', value }
    } catch (error) {
      const structured = toMfeError(error, {
        code: 'mount/failure',
        id: action.definitionId,
        operation: `execute action '${action.registration.name}'`,
        repair:
          'Handle the failure inside the action, or surface it through the App’s own error UI.',
      })
      diagnostics?.report(structured)
      return { status: 'failed', error: structured }
    }
  }
}
