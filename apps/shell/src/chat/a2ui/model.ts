/**
 * A2UI v0.9 (https://a2ui.org, the open spec in which an agent composes UI from a catalogue the
 * client provides), the state half: surfaces built from the agent's messages, their data models,
 * and the values a component's properties resolve to. Pure, so the rendering and the tool share
 * it. The spec is v0.9.1, wire-compatible with v0.9; both version strings are accepted.
 *
 * Only data crosses: a component is a name from the catalogue, a value is a literal, a path into
 * the data model or a call of a named function the client implements. Nothing is evaluated.
 */

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

export type A2uiMessage =
  | {
      readonly version: string
      readonly createSurface: { readonly surfaceId: string; readonly catalogId: string }
    }
  | {
      readonly version: string
      readonly updateComponents: {
        readonly surfaceId: string
        readonly components: readonly A2uiComponent[]
      }
    }
  | {
      readonly version: string
      readonly updateDataModel: {
        readonly surfaceId: string
        readonly path?: string
        readonly value?: JsonValue
      }
    }
  | { readonly version: string; readonly deleteSurface: { readonly surfaceId: string } }

/** What the client answers a payload it cannot render with, so the agent can correct it. */
export interface A2uiError {
  readonly code: 'VALIDATION_FAILED' | 'UNKNOWN_COMPONENT' | 'SURFACE_NOT_FOUND'
  readonly surfaceId: string
  readonly path?: string
  readonly message: string
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

export function getAt(data: JsonValue, pointer: string): JsonValue | undefined {
  let current: JsonValue | undefined = data
  for (const segment of segments(pointer)) {
    if (Array.isArray(current)) current = current[Number(segment)]
    else if (isObject(current)) current = (current as Record<string, JsonValue>)[segment]
    else return undefined
  }
  return current
}

/** A copy of `data` with the value at `pointer` set, or removed when `value` is undefined. */
export function setAt(data: JsonValue, pointer: string, value: JsonValue | undefined): JsonValue {
  const [head, ...rest] = segments(pointer)
  if (head === undefined) return value ?? {}
  const restPointer = rest.length === 0 ? '' : `/${rest.join('/')}`

  if (Array.isArray(data) || (/^\d+$/.test(head) && !isObject(data))) {
    const array: JsonValue[] = Array.isArray(data) ? [...data] : []
    const index = Number(head)
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
    if (typeof pattern !== 'string') return false
    try {
      return new RegExp(pattern).test(text(resolve(args['value'], scope)))
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
): { readonly surfaces: Surfaces } | { readonly error: A2uiError } {
  const next = new Map(surfaces)

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

  return { surfaces: next }
}

/** Whether a surface can be drawn: it has its `root`. */
export function isReady(surface: Surface): boolean {
  return surface.components.has('root')
}
