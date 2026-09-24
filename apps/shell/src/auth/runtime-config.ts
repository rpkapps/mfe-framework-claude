/**
 * The shell's runtime configuration: `runtime-config.json`, served beside `index.html` and
 * written per deployment from the environment by `deploy/runtime-config.sh`, as a container's is.
 * One build therefore serves every environment. It is read before sign-in, so it is checked by
 * hand rather than through the framework's `#mfe/config`, which would put Zod in the entry (§36).
 */

export interface ShellRuntimeConfig {
  readonly oidcAuthority?: string
  readonly oidcClientId?: string
  readonly oidcScope?: string
  readonly oidcGroupsClaim?: string
  readonly oidcDisabled?: boolean
}

/** Where the shell reads it, and where `index.html` preloads it from. */
export const RUNTIME_CONFIG_URL = '/runtime-config.json'

interface FieldSpec {
  readonly field: keyof ShellRuntimeConfig
  /** The variable `deploy/runtime-config.sh` reads the value from. */
  readonly envVar: string
  readonly type: 'string' | 'boolean'
}

export const RUNTIME_CONFIG_FIELDS: readonly FieldSpec[] = [
  { field: 'oidcAuthority', envVar: 'OIDC_AUTHORITY', type: 'string' },
  { field: 'oidcClientId', envVar: 'OIDC_CLIENT_ID', type: 'string' },
  { field: 'oidcScope', envVar: 'OIDC_SCOPE', type: 'string' },
  { field: 'oidcGroupsClaim', envVar: 'OIDC_GROUPS_CLAIM', type: 'string' },
  { field: 'oidcDisabled', envVar: 'OIDC_DISABLED', type: 'boolean' },
]

export type ParsedRuntimeConfig =
  | { readonly ok: true; readonly config: ShellRuntimeConfig }
  | { readonly ok: false; readonly problem: string }

/**
 * Checks the shape only; what the values mean is `resolveAuthConfig`'s to decide. A key it does
 * not know is refused rather than ignored, so a misspelt field is found at the first load.
 */
export function parseRuntimeConfig(raw: unknown): ParsedRuntimeConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, problem: 'runtime-config.json is not a JSON object.' }
  }

  const values = raw as Readonly<Record<string, unknown>>
  const known = new Set<string>(RUNTIME_CONFIG_FIELDS.map(spec => spec.field))
  const unknown = Object.keys(values).filter(key => !known.has(key))
  if (unknown.length > 0) {
    return {
      ok: false,
      problem: `runtime-config.json has fields the shell does not read: ${unknown.join(', ')}.`,
    }
  }

  const config: Record<string, string | boolean> = {}
  for (const spec of RUNTIME_CONFIG_FIELDS) {
    const value = values[spec.field]
    // Absent and null both mean "not set", so a deployment may write either.
    if (value === undefined || value === null) continue
    if (typeof value !== spec.type) {
      return {
        ok: false,
        problem: `runtime-config.json field ${spec.field} (${spec.envVar}) must be a ${spec.type}, not ${JSON.stringify(value)}.`,
      }
    }
    config[spec.field] = value as string | boolean
  }
  return { ok: true, config }
}

/** Never throws: a network failure, a status and a body that is not JSON are each a problem. */
export async function fetchRuntimeConfig(): Promise<ParsedRuntimeConfig> {
  let response: Response
  try {
    // The same request the preload in index.html made, so it is answered from that.
    response = await fetch(RUNTIME_CONFIG_URL, { credentials: 'same-origin' })
  } catch (cause) {
    return {
      ok: false,
      problem: `runtime-config.json could not be fetched: ${cause instanceof Error ? cause.message : String(cause)}.`,
    }
  }
  const writtenBy = 'A deployment writes it from the environment with deploy/runtime-config.sh.'
  if (!response.ok) {
    return {
      ok: false,
      problem: `runtime-config.json responded ${String(response.status)}. ${writtenBy}`,
    }
  }
  // A server with a single-page fallback answers a missing file with index.html and a 200.
  const type = response.headers.get('Content-Type') ?? ''
  if (!type.includes('json')) {
    return {
      ok: false,
      problem: `runtime-config.json is missing: the server answered with ${type === '' ? 'something other than JSON' : type}. ${writtenBy}`,
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, problem: 'runtime-config.json is not valid JSON.' }
  }
  return parseRuntimeConfig(body)
}
