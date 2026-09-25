/**
 * Who acted: one record for every action run, whoever asked and however it ended, so a trail can
 * say that the agent refunded an order on the user's behalf, in which chat turn, with what input.
 * The executor writes it as its last step; the runtime reports it through the telemetry provider
 * and hands it to the host, whose backend stores it. Storing it is not the page's job.
 */

import {
  boundAttributes,
  isRecord,
  type DefinitionKind,
  type JsonSchemaValue,
  type TelemetryFrameworkRecord,
} from '@company/mfe-core'

import type { ActionCaller } from './action-executor.ts'

/** Who the run is for: a person, the agent working for one, or the host's own code. */
export type ActionActor = 'user' | 'agent' | 'system'

/** The chat thread and turn an agent's call came from. */
export interface ActionTurn {
  readonly threadId: string
  readonly turnId: string
}

export type ActionOutcome =
  'executed' | 'denied' | 'declined' | 'invalid' | 'unavailable' | 'failed'

export interface ActionAuditRecord {
  readonly actionId: string
  readonly definitionId: string
  readonly definitionKind: DefinitionKind
  readonly actor: ActionActor
  /** The palette, a shortcut, the App's own UI, the agent, or the host's code. */
  readonly caller: ActionCaller
  /** The signed-in user: the one who acted, or on whose behalf the agent did. */
  readonly userId?: string
  readonly turn?: ActionTurn
  readonly outcome: ActionOutcome
  /** Why a run was denied or declined. */
  readonly reason?: string
  /** The code of the error an invalid, unavailable or failed run carried. */
  readonly errorCode?: string
  /** What the caller sent, with anything that looks like a credential replaced. */
  readonly input: JsonSchemaValue
  /** When the run was asked for, as an ISO timestamp. */
  readonly startedAt: string
  /** From the ask to the outcome, approval and waiting included. */
  readonly durationMs: number
}

/** Where the host takes a record: its backend, usually. */
export type ActionAuditSink = (record: ActionAuditRecord) => void

export const REDACTED = '[redacted]'

/**
 * The words of a key that make its value a credential by name alone, matched as whole words or as
 * two adjacent words run together, so `apiKey`, `api_key` and `x-api-key` match and `author` or
 * `compass` does not.
 */
const SECRET_WORDS = new Set([
  'password',
  'passphrase',
  'passwd',
  'pwd',
  'secret',
  'token',
  'apikey',
  'accesskey',
  'privatekey',
  'auth',
  'authorization',
  'cookie',
  'credential',
  'credentials',
  'signature',
  'sessionid',
])

function isSecretKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word !== '')
  return words.some(
    (word, index) =>
      SECRET_WORDS.has(word) ||
      SECRET_WORDS.has(word.replace(/s$/, '')) ||
      SECRET_WORDS.has(`${word}${words[index + 1] ?? ''}`),
  )
}

/**
 * A value that is a credential whatever its key: a bearer or basic header (the scheme and one
 * token, so a sentence that starts with "Basic" is kept), a JWT, or a PEM private key.
 */
const SECRET_VALUE =
  /^(bearer|basic)\s+[\w.~+/=-]+$|^ey[\w-]+\.ey[\w-]+\.[\w-]+$|-----BEGIN [A-Z ]*PRIVATE KEY-----/i

/** How deep the redaction walks; deeper input is not what an action takes. */
const MAX_DEPTH = 8

/**
 * The input as JSON, with every value under a credential-like key, and every string that looks
 * like a credential, replaced. What JSON cannot hold (a function, a date) is named instead.
 */
export function redactInput(value: unknown, depth = 0): JsonSchemaValue {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'string') return SECRET_VALUE.test(value.trim()) ? REDACTED : value
  if (value === undefined) return null
  if (depth >= MAX_DEPTH) return '[too deep]'
  if (Array.isArray(value)) return value.map(item => redactInput(item, depth + 1))
  if (isRecord(value) && Object.getPrototypeOf(value) === Object.prototype) {
    const redacted: Record<string, JsonSchemaValue> = {}
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = isSecretKey(key) ? REDACTED : redactInput(item, depth + 1)
    }
    return redacted
  }
  return `[${typeof value === 'object' ? (value.constructor?.name ?? 'object') : typeof value}]`
}

/**
 * The record as the telemetry provider takes it: a `framework` record, flat attributes, attributed
 * to the definition that owns the action. A denial and a failure are warnings, so a level filter
 * that keeps warnings keeps them.
 */
export function auditTelemetryRecord(record: ActionAuditRecord): TelemetryFrameworkRecord {
  const { actionId, actor, caller, outcome } = record
  const attributes: Record<string, string | number | boolean> = {
    'action.id': actionId,
    'action.actor': actor,
    'action.caller': caller,
    'action.outcome': outcome,
    'action.input': JSON.stringify(record.input),
    'action.duration_ms': record.durationMs,
  }
  if (record.userId !== undefined) attributes['action.user_id'] = record.userId
  if (record.turn !== undefined) {
    attributes['chat.thread_id'] = record.turn.threadId
    attributes['chat.turn_id'] = record.turn.turnId
  }
  if (record.reason !== undefined) attributes['action.reason'] = record.reason
  if (record.errorCode !== undefined) attributes['code'] = record.errorCode

  return {
    kind: 'framework',
    level: outcome === 'executed' ? 'info' : 'warn',
    operation: 'run action',
    message: `${actor === 'agent' ? 'The agent' : actor === 'system' ? 'The host' : 'The user'} ran '${actionId}': ${outcome}`,
    attributes: boundAttributes(attributes),
    attribution: { definitionId: record.definitionId, definitionKind: record.definitionKind },
    timestamp: Date.parse(record.startedAt),
  }
}
