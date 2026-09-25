/**
 * The navigate tool, generated from each App's published routes (§48): the agent goes where the
 * user would, by URL, and the navigation is the router's, so an App that holds the page (unsaved
 * changes) holds it for the agent too. Apps take URLs; nobody wraps a route in an action.
 */

import type { ChatTool } from '@company/mfe-agent'
import type { JsonSchemaObject, RegistryEntry } from '@company/mfe-react'

import { SHELL_TOOLS } from './names.ts'
import { isObject } from '../records.ts'

export type NavigateResult =
  | { readonly status: 'navigated'; readonly url: string }
  | { readonly status: 'blocked'; readonly reason: string }
  | { readonly status: 'invalid'; readonly error: string }

/** Goes to `href` and resolves the URL the page is at afterwards, or `undefined` if it stayed. */
export type Go = (href: string) => Promise<string | undefined>

/**
 * A published path as a pattern: `:name` is one segment, `:name?` an optional one, `*` the rest.
 * Anchored, so `/wells` does not accept `/wells/W-1`.
 */
export function routePattern(path: string): RegExp {
  const source = path
    .split('/')
    .filter(segment => segment !== '')
    .map(segment => {
      if (segment === '*') return '(?:/.*)?'
      if (segment.startsWith(':') && segment.endsWith('?')) return '(?:/[^/]+)?'
      if (segment.startsWith(':')) return '/[^/]+'
      return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
    })
    .join('')
  return new RegExp(`^${source === '' ? '/?' : `${source}/?`}$`)
}

/** One line per route, as the model reads them: its path and the search params it takes. */
function describeRoute(path: string, search: JsonSchemaObject | undefined): string {
  const properties = isObject(search?.['properties']) ? search['properties'] : {}
  const params = Object.entries(properties).map(([name, schema]) => {
    const choices = isObject(schema) && Array.isArray(schema['enum']) ? schema['enum'] : undefined
    return choices === undefined ? name : `${name}=${choices.map(String).join('|')}`
  })
  return params.length === 0 ? path : `${path}?${params.join('&')}`
}

function describeApp(app: RegistryEntry): string {
  const routes = app.routes ?? [{ path: '/' }]
  const title = app.title === undefined ? '' : ` (${app.title})`
  return `- ${app.id}${title}: ${routes.map(route => describeRoute(route.path, route.search)).join(', ')}`
}

function readInput(input: unknown): {
  readonly app: string
  readonly path: string
  readonly search: Readonly<Record<string, unknown>>
} {
  const value = isObject(input) ? input : {}
  const path = typeof value['path'] === 'string' && value['path'] !== '' ? value['path'] : '/'
  return {
    app: typeof value['app'] === 'string' ? value['app'] : '',
    path: path.startsWith('/') ? path : `/${path}`,
    search: isObject(value['search']) ? value['search'] : {},
  }
}

/** The search params as a query string, checked against the route's schema where it has one. */
function queryFor(
  search: Readonly<Record<string, unknown>>,
  schema: JsonSchemaObject | undefined,
): { readonly query: string } | { readonly error: string } {
  const properties = isObject(schema?.['properties']) ? schema['properties'] : undefined
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(search)) {
    if (value === undefined || value === null) continue
    const property = properties?.[name]
    if (properties !== undefined && property === undefined) {
      return { error: `The page takes no search param '${name}'.` }
    }
    const choices = isObject(property) && Array.isArray(property['enum']) ? property['enum'] : null
    if (choices !== null && !choices.includes(value)) {
      return { error: `'${name}' must be one of ${choices.map(String).join(', ')}.` }
    }
    params.set(name, typeof value === 'string' ? value : JSON.stringify(value))
  }
  const query = params.toString()
  return { query: query === '' ? '' : `?${query}` }
}

/** The navigate tool, over the Apps the registry lists. Undefined when there are none. */
export function navigateTool(apps: readonly RegistryEntry[], go: Go): ChatTool | undefined {
  if (apps.length === 0) return undefined

  return {
    name: SHELL_TOOLS.navigate,
    description: [
      'Go to a page of an App, as the user would by its URL. `path` is inside the App, and a',
      '`:name` segment is filled with a value, such as /wells/W-12. The pages, by App:',
      ...apps.map(describeApp),
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', enum: apps.map(app => app.id) },
        path: { type: 'string', description: 'The page inside the App; / when absent.' },
        search: {
          type: 'object',
          description: 'Search params the page takes, such as filters.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['app'],
      additionalProperties: false,
    },
    execute: async (input): Promise<NavigateResult> => {
      const { app: id, path, search } = readInput(input)
      const app = apps.find(candidate => candidate.id === id)
      if (app === undefined) return { status: 'invalid', error: `There is no App '${id}'.` }

      // A query or a `..` in the path would reach past the route and its search params' schema.
      if (
        /[?#]/.test(path) ||
        path.split('/').some(segment => segment === '.' || segment === '..')
      ) {
        return {
          status: 'invalid',
          error: 'A path is one page inside the App, with no `..`; search params go in `search`.',
        }
      }

      const route = (app.routes ?? [{ path: '/' }]).find(candidate =>
        routePattern(candidate.path).test(path),
      )
      if (route === undefined) {
        return { status: 'invalid', error: `${id} has no page at ${path}. ${describeApp(app)}` }
      }

      const query = queryFor(search, route.search)
      if ('error' in query) return { status: 'invalid', error: query.error }

      const landed = await go(`/${id}${path === '/' ? '' : path}${query.query}`)
      return landed === undefined
        ? {
            status: 'blocked',
            reason: 'The page stayed where it was: it has unsaved changes, or the user cancelled.',
          }
        : { status: 'navigated', url: landed }
    },
  }
}
