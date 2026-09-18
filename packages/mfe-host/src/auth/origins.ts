/**
 * The API origin allowlist: which origins may receive the session bearer token.
 *
 * An exact scheme+host+port set, with no wildcards and no substring matching,
 * so a third-party endpoint — or an attacker-controlled host that merely looks
 * like the API — can never be handed the session credential.
 */

import { createMfeError, describeValue } from '@company/mfe-core'

export interface OriginAllowlist {
  /** True when `origin` (a `URL.origin` string) was declared as an API. */
  readonly has: (origin: string) => boolean
  /** The declared origins, normalized and de-duplicated, in declaration order. */
  readonly origins: readonly string[]
}

export interface AllowlistContext {
  /** Attribution for diagnostics; the shell id unless the host binds a definition. */
  readonly id: string
  readonly operation: string
}

function fail(context: AllowlistContext, observed: string, repair: string): never {
  throw createMfeError({
    code: 'config/invalid',
    id: context.id,
    operation: context.operation,
    expected: 'an absolute http(s) origin such as "https://api.example.test"',
    observed,
    declaredBy: 'The author configuration that marks an origin { api: true }',
    repair,
    note: 'Only declared origins receive the session bearer token, so the list is a security boundary rather than a convenience.',
  })
}

function toOrigin(entry: string | URL, context: AllowlistContext): string {
  if (typeof entry !== 'string' && !(entry instanceof URL)) {
    fail(
      context,
      describeValue(entry),
      'Declare each API as a string or URL, for example "https://api.example.test".',
    )
  }

  const raw = typeof entry === 'string' ? entry.trim() : entry.href

  if (raw === '') {
    fail(
      context,
      'an empty string',
      'Remove the empty entry, or substitute the environment variable that was meant to supply the origin.',
    )
  }

  if (raw.includes('*')) {
    fail(
      context,
      `the wildcard pattern ${JSON.stringify(raw)}`,
      'List every API origin explicitly. A wildcard would hand the session bearer token to any host the pattern happens to match.',
    )
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    fail(
      context,
      `${JSON.stringify(raw)}, which is not an absolute URL`,
      'Write the full origin including the scheme, for example "https://api.example.test".',
    )
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail(
      context,
      `the ${parsed.protocol.replace(':', '')} URL ${JSON.stringify(raw)}`,
      'Declare http(s) API origins only; other schemes have no origin the framework can match against a request.',
    )
  }

  // `URL.origin` is the literal string "null" for opaque origins.
  if (parsed.origin === 'null') {
    fail(
      context,
      `${JSON.stringify(raw)}, which has an opaque origin`,
      'Declare an origin with a host, for example "https://api.example.test".',
    )
  }

  return parsed.origin
}

/**
 * Normalizes declared API entries (a full URL is reduced to its origin) into an
 * exact-match allowlist. Invalid entries fail here, at wiring time, rather than
 * at the first request that silently loses its token.
 */
export function normalizeAllowedOrigins(
  entries: Iterable<string | URL> | undefined,
  context: AllowlistContext,
): OriginAllowlist {
  const seen = new Set<string>()
  const origins: string[] = []

  for (const entry of entries ?? []) {
    const origin = toOrigin(entry, context)
    if (seen.has(origin)) continue
    seen.add(origin)
    origins.push(origin)
  }

  return {
    has: origin => seen.has(origin),
    origins: Object.freeze(origins),
  }
}
