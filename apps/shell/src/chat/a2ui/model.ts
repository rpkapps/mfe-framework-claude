/**
 * A2UI v0.9 (https://a2ui.org, the open spec in which an agent composes UI from a catalogue the
 * client provides), the state half: surfaces built from the agent's messages, their data models,
 * and the values a component's properties resolve to. Pure, so the rendering and the tool share
 * it. The spec is v0.9.1, wire-compatible with v0.9; both version strings are accepted.
 *
 * Only data crosses: a component is a name from the catalogue, a value is a literal, a path into
 * the data model or a call of a named function the client implements. Nothing is evaluated.
 */

import { isObject } from '../records.ts'

export const A2UI_VERSIONS = ['v0.9', 'v0.9.1'] as const

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** One component of the flat list: its id, its catalogue name, and its properties inline. */
export interface A2uiComponent {
  readonly id: string
  readonly component: string
  readonly [property: string]: unknown
}

export interface Surface {
  readonly surfaceId: string
  readonly catalogId: string
  readonly components: ReadonlyMap<string, A2uiComponent>
  readonly data: JsonValue
}

/** What the client answers a payload it cannot render with, so the agent can correct it. */
export interface A2uiError {
  readonly code: 'VALIDATION_FAILED' | 'UNKNOWN_COMPONENT' | 'SURFACE_NOT_FOUND'
  readonly surfaceId: string
  readonly path?: string
  readonly message: string
}

// ─── JSON Pointer, with the spec's relative paths ─────────────────────────────

function segments(pointer: string): string[] {
  if (pointer === '' || pointer === '/') return []
  return pointer
    .replace(/^\//, '')
    .split('/')
    .map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
}

/** A path without a leading `/` is relative to the template item the component renders in. */
export function absolutePath(path: string, scope: string): string {
  if (path.startsWith('/')) return path
  const base = scope === '/' ? '' : scope
  return path === '' ? scope : `${base}/${path}`
}

const INDEX = /^\d+$/

/** Only the data's own members: `constructor` or `__proto__` never reach an object's prototype. */
export function getAt(data: JsonValue, pointer: string): JsonValue | undefined {
  let current: JsonValue | undefined = data
  for (const segment of segments(pointer)) {
    if (Array.isArray(current)) current = INDEX.test(segment) ? current[Number(segment)] : undefined
    else if (isObject(current) && Object.hasOwn(current, segment)) {
      current = (current as Record<string, JsonValue>)[segment]
    } else return undefined
  }
  return current
}

/**
 * A copy of `data` with the value at `pointer` set, or removed when `value` is undefined. A write
 * past the end of an array, or to `__proto__`, leaves the data as it was: one would allocate as
 * many elements as the index says, the other would set the object's prototype.
 */
export function setAt(data: JsonValue, pointer: string, value: JsonValue | undefined): JsonValue {
  const [head, ...rest] = segments(pointer)
  if (head === undefined) return value ?? {}
  if (head === '__proto__') return data
  const restPointer = rest.length === 0 ? '' : `/${rest.join('/')}`

  if (Array.isArray(data) || (INDEX.test(head) && !isObject(data))) {
    const array: JsonValue[] = Array.isArray(data) ? [...data] : []
    const index = Number(head)
    if (!INDEX.test(head) || index > array.length) return data
    const next = rest.length === 0 ? value : setAt(array[index] ?? {}, restPointer, value)
    // Removing an element keeps the length, as the spec says.
    array[index] = next ?? null
    return array
  }

  const object: Record<string, JsonValue> = isObject(data)
    ? { ...(data as Record<string, JsonValue>) }
    : {}
  if (rest.length === 0) {
    if (value === undefined) delete object[head]
    else object[head] = value
    return object
  }
  const child = setAt(object[head] ?? {}, restPointer, value)
  object[head] = child
  return object
}

/** Only a web address opens: never `javascript:`, `data:` or anything else. */
export function safeUrl(value: string, base: string): string | undefined {
  try {
    const url = new URL(value, base)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

/**
 * One origin of AGENT_IMAGE_HOSTS: scheme, host and optional port, no path, no wildcard. The
 * pattern in src/mfe.config.ts is the list form of this one, so a value the shell booted with only
 * holds entries of this form; one that still fails to parse (a port past 65535) is dropped.
 */
const ORIGIN = /^https?:\/\/(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?$/

/** The origins AGENT_IMAGE_HOSTS lists, as `URL.origin` writes them, so matching is exact. */
export function imageOrigins(setting: string | undefined): ReadonlySet<string> {
  const origins = new Set<string>()
  for (const entry of (setting ?? '').split(',')) {
    const origin = entry.trim()
    if (!ORIGIN.test(origin)) continue
    try {
      origins.add(new URL(origin).origin)
    } catch {
      // Not an origin after all; it widens nothing by being left out.
    }
  }
  return origins
}

/** An image in the data itself, which fetches nothing; any other `data:` is not an image. */
const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+[;,]/i

/**
 * What an agent's Image may do: load, or be withheld, with the host it would have loaded from. An
 * image loads as soon as it is drawn, so its address alone would carry whatever the agent put in
 * its query to the agent's own server; it loads only from the shell's origin, from the data URL
 * itself, or from an origin the deployment lists (`imageOrigins`). Nothing to show is undefined.
 */
export type ImageSource =
  | { readonly kind: 'load'; readonly url: string }
  | { readonly kind: 'withheld'; readonly host: string | undefined }

export function imageSource(
  value: string,
  page: string,
  allowed: ReadonlySet<string>,
): ImageSource | undefined {
  if (value.trim() === '') return undefined
  let url: URL
  try {
    url = new URL(value, page)
  } catch {
    return { kind: 'withheld', host: undefined }
  }
  if (url.protocol === 'data:') {
    return DATA_IMAGE.test(url.href)
      ? { kind: 'load', url: url.href }
      : { kind: 'withheld', host: undefined }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { kind: 'withheld', host: undefined }
  }
  return url.origin === new URL(page).origin || allowed.has(url.origin)
    ? { kind: 'load', url: url.href }
    : { kind: 'withheld', host: url.host }
}

// ─── Values ───────────────────────────────────────────────────────────────────

/** Where a component renders: its surface's data, and the template item it is inside. */
export interface Scope {
  readonly data: JsonValue
  readonly path: string
}

type Fn = (args: Readonly<Record<string, unknown>>, scope: Scope) => JsonValue

function text(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/**
 * A `regex` check runs the agent's pattern on the page's thread while the surface renders, so a
 * pattern that backtracks exponentially (`^(a+)+$` against a few dozen characters takes seconds)
 * freezes the whole shell. The pattern and the value it tests are capped in length, and a pattern
 * with a repeated group that itself repeats or alternates, the shape behind that blow-up, is
 * refused. Either way the check fails, as it does for a pattern that does not compile.
 */
const MAX_PATTERN_LENGTH = 200
const MAX_TESTED_LENGTH = 1000

/** A quantifier after a group that makes it repeat without bound: `*`, `+` or `{n,…}`. */
const REPEATS = /^(?:[*+]|\{\d+(?:,\d*)?\})/

function isBoundedPattern(pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return false
  // Per open group: whether it holds a quantifier or an alternation.
  const groups: { varies: boolean }[] = [{ varies: false }]
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    const group = groups.at(-1)
    if (group === undefined) return false
    if (char === '\\') {
      index += 1
    } else if (char === '[') {
      // A class is one atom: skip to its unescaped end.
      index += 1
      while (index < pattern.length && pattern[index] !== ']') {
        if (pattern[index] === '\\') index += 1
        index += 1
      }
    } else if (char === '(') {
      groups.push({ varies: false })
      // `(?:`, `(?=`, `(?<name>`: the `?` there is not a quantifier.
      if (pattern[index + 1] === '?') index += 1
    } else if (char === ')') {
      const closed = groups.pop()
      const parent = groups.at(-1)
      if (closed === undefined || parent === undefined) return false
      if (closed.varies && REPEATS.test(pattern.slice(index + 1))) return false
      parent.varies ||= closed.varies
    } else if (char === '*' || char === '+' || char === '?' || char === '{' || char === '|') {
      group.varies = true
    }
  }
  return true
}

/** The catalogue's functions this client implements; any other call resolves to null. */
const FUNCTIONS: Readonly<Record<string, Fn>> = {
  required: (args, scope) => {
    const value = resolve(args['value'], scope)
    return !(
      value === null ||
      value === undefined ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    )
  },
  regex: (args, scope) => {
    const pattern = resolve(args['pattern'], scope)
    const value = text(resolve(args['value'], scope))
    if (typeof pattern !== 'string' || !isBoundedPattern(pattern)) return false
    if (value.length > MAX_TESTED_LENGTH) return false
    try {
      return new RegExp(pattern).test(value)
    } catch {
      return false
    }
  },
  email: (args, scope) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(resolve(args['value'], scope))),
  length: (args, scope) => {
    const length = text(resolve(args['value'], scope)).length
    const min = resolve(args['min'], scope)
    const max = resolve(args['max'], scope)
    return (typeof min !== 'number' || length >= min) && (typeof max !== 'number' || length <= max)
  },
  numeric: (args, scope) => {
    const value = Number(resolve(args['value'], scope))
    const min = resolve(args['min'], scope)
    const max = resolve(args['max'], scope)
    return (
      Number.isFinite(value) &&
      (typeof min !== 'number' || value >= min) &&
      (typeof max !== 'number' || value <= max)
    )
  },
  and: (args, scope) => {
    const values = args['values']
    return Array.isArray(values) && values.every(value => resolve(value, scope) === true)
  },
  or: (args, scope) => {
    const values = args['values']
    return Array.isArray(values) && values.some(value => resolve(value, scope) === true)
  },
  not: (args, scope) => resolve(args['value'], scope) !== true,
  formatString: (args, scope) =>
    text(resolve(args['value'], scope)).replace(/(?<!\\)\$\{([^}]+)\}/g, (_, path: string) =>
      text(getAt(scope.data, absolutePath(path.trim(), scope.path))),
    ),
}

/** A dynamic value: a literal, `{ path }` into the data model, or `{ call, args }`. */
export function resolve(value: unknown, scope: Scope): JsonValue {
  if (isObject(value)) {
    if (typeof value['path'] === 'string' && Object.keys(value).length === 1) {
      return getAt(scope.data, absolutePath(value['path'], scope.path)) ?? null
    }
    if (typeof value['call'] === 'string') {
      const fn = FUNCTIONS[value['call']]
      return fn === undefined ? null : fn(isObject(value['args']) ? value['args'] : {}, scope)
    }
  }
  return (value ?? null) as JsonValue
}

export function resolveText(value: unknown, scope: Scope): string {
  return text(resolve(value, scope))
}

/** The path an input writes to: its `value` must be a binding for the input to be two-way. */
export function boundPath(value: unknown, scope: Scope): string | undefined {
  return isObject(value) && typeof value['path'] === 'string'
    ? absolutePath(value['path'], scope.path)
    : undefined
}

/** Whether every check passes; a Button with a failing check is disabled. */
export function checksPass(checks: unknown, scope: Scope): boolean {
  if (!Array.isArray(checks)) return true
  return checks.every(check => !isObject(check) || resolve(check['condition'], scope) === true)
}

/** The children of a component: a list of ids, or a template repeated per item of an array. */
export function childrenOf(
  children: unknown,
  scope: Scope,
): readonly { readonly id: string; readonly scope: Scope }[] {
  if (Array.isArray(children)) {
    return children.flatMap(id => (typeof id === 'string' ? [{ id, scope }] : []))
  }
  if (
    isObject(children) &&
    typeof children['componentId'] === 'string' &&
    typeof children['path'] === 'string'
  ) {
    const path = absolutePath(children['path'], scope.path)
    const items = getAt(scope.data, path)
    if (!Array.isArray(items)) return []
    const id = children['componentId']
    return items.map((_, index) => ({
      id,
      scope: { data: scope.data, path: `${path}/${String(index)}` },
    }))
  }
  return []
}

// ─── Messages ─────────────────────────────────────────────────────────────────

/** The surfaces of a conversation, by id, built from the agent's messages in order. */
export type Surfaces = ReadonlyMap<string, Surface>

/**
 * Applies messages to the surfaces, returning the new surfaces or the first error. Components
 * are upserted by id; a component whose name the catalogue lacks is refused, so the agent can
 * correct it, and nothing of that message is applied.
 */
export function applyMessages(
  surfaces: Surfaces,
  messages: readonly unknown[],
  catalogue: ReadonlySet<string>,
):
  | { readonly surfaces: Surfaces; readonly created: ReadonlySet<string> }
  | { readonly error: A2uiError } {
  const next = new Map(surfaces)
  const created = new Set<string>()

  for (const [index, message] of messages.entries()) {
    const fail = (
      error: Omit<A2uiError, 'path'>,
      field: string,
    ): { readonly error: A2uiError } => ({
      error: { ...error, path: `/messages/${String(index)}${field}` },
    })
    if (
      !isObject(message) ||
      !A2UI_VERSIONS.includes(message['version'] as (typeof A2UI_VERSIONS)[number])
    ) {
      return fail(
        {
          code: 'VALIDATION_FAILED',
          surfaceId: '',
          message: `Each message needs version ${A2UI_VERSIONS.join(' or ')}.`,
        },
        '/version',
      )
    }

    if (isObject(message['createSurface'])) {
      const { surfaceId, catalogId } = message['createSurface']
      if (typeof surfaceId !== 'string' || surfaceId === '' || typeof catalogId !== 'string') {
        return fail(
          {
            code: 'VALIDATION_FAILED',
            surfaceId: '',
            message: 'createSurface needs a surfaceId and a catalogId.',
          },
          '/createSurface',
        )
      }
      next.set(surfaceId, { surfaceId, catalogId, components: new Map(), data: {} })
      created.add(surfaceId)
      continue
    }

    if (isObject(message['updateComponents'])) {
      const { surfaceId, components } = message['updateComponents']
      const surface = typeof surfaceId === 'string' ? next.get(surfaceId) : undefined
      if (surface === undefined) {
        return fail(
          {
            code: 'SURFACE_NOT_FOUND',
            surfaceId: String(surfaceId),
            message: 'Create the surface first.',
          },
          '/updateComponents/surfaceId',
        )
      }
      if (!Array.isArray(components) || components.length === 0) {
        return fail(
          {
            code: 'VALIDATION_FAILED',
            surfaceId: surface.surfaceId,
            message: 'components must be a non-empty array.',
          },
          '/updateComponents/components',
        )
      }
      const merged = new Map(surface.components)
      for (const [position, component] of components.entries()) {
        if (
          !isObject(component) ||
          typeof component['id'] !== 'string' ||
          typeof component['component'] !== 'string'
        ) {
          return fail(
            {
              code: 'VALIDATION_FAILED',
              surfaceId: surface.surfaceId,
              message: 'Each component needs an id and a component name.',
            },
            `/updateComponents/components/${String(position)}`,
          )
        }
        if (!catalogue.has(component['component'])) {
          return fail(
            {
              code: 'UNKNOWN_COMPONENT',
              surfaceId: surface.surfaceId,
              message: `'${component['component']}' is not in the catalogue: use one of ${[...catalogue].join(', ')}.`,
            },
            `/updateComponents/components/${String(position)}/component`,
          )
        }
        merged.set(component['id'], component as A2uiComponent)
      }
      next.set(surface.surfaceId, { ...surface, components: merged })
      continue
    }

    if (isObject(message['updateDataModel'])) {
      const { surfaceId, path, value } = message['updateDataModel']
      const surface = typeof surfaceId === 'string' ? next.get(surfaceId) : undefined
      if (surface === undefined) {
        return fail(
          {
            code: 'SURFACE_NOT_FOUND',
            surfaceId: String(surfaceId),
            message: 'Create the surface first.',
          },
          '/updateDataModel/surfaceId',
        )
      }
      next.set(surface.surfaceId, {
        ...surface,
        data: setAt(
          surface.data,
          typeof path === 'string' ? path : '/',
          value as JsonValue | undefined,
        ),
      })
      continue
    }

    if (isObject(message['deleteSurface'])) {
      const { surfaceId } = message['deleteSurface']
      if (typeof surfaceId === 'string') next.delete(surfaceId)
      continue
    }

    return fail(
      {
        code: 'VALIDATION_FAILED',
        surfaceId: '',
        message:
          'A message holds one of createSurface, updateComponents, updateDataModel or deleteSurface.',
      },
      '',
    )
  }

  return { surfaces: next, created }
}

/** Whether a surface can be drawn: it has its `root`. */
export function isReady(surface: Surface): boolean {
  return surface.components.has('root')
}
