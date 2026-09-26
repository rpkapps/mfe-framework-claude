/**
 * An App's routes, published so a host can navigate to one, or offer an agent the way there,
 * before the App is loaded. Each integration finds its router's routes and writes their paths in
 * the neutral syntax (`:name`, `:name?`, `*`); this settles what every router shares: one entry
 * per path, sorted, and search params a route inherits from the routes it is nested in.
 */

import type { JsonSchemaObject, JsonSchemaValue, PublishedRoute } from '@company/mfe-core'

import { readStaticSchema } from '../config/zod-static.ts'
import { isMfeBuildError } from '../diagnostics.ts'
import type { ts } from './ts-ast.ts'

/**
 * The search schema's JSON Schema when it is an object schema the build can read, and `undefined`
 * otherwise: an unreadable search schema leaves the route published without one, rather than
 * failing the build over what only helps an agent fill the params in.
 */
export function readSearchSchema(
  expression: ts.Expression,
  context: { readonly file: string; readonly sourceFile: ts.SourceFile },
): JsonSchemaObject | undefined {
  try {
    const { jsonSchema } = readStaticSchema(expression, { ...context, field: 'validateSearch' })
    return jsonSchema['type'] === 'object' ? jsonSchema : undefined
  } catch (error) {
    if (isMfeBuildError(error)) return undefined
    throw error
  }
}

/** The properties of `inner` over those of `outer`, and both one's required names. */
export function mergeSearch(
  outer: JsonSchemaObject | undefined,
  inner: JsonSchemaObject | undefined,
): JsonSchemaObject | undefined {
  if (outer === undefined) return inner
  if (inner === undefined) return outer
  const required = [...new Set([...namesOf(outer['required']), ...namesOf(inner['required'])])]
  // A Zod object strips a param it does not declare, so either one saying so holds for both.
  const closed = outer['additionalProperties'] === false || inner['additionalProperties'] === false
  return {
    type: 'object',
    properties: { ...objectOf(outer['properties']), ...objectOf(inner['properties']) },
    ...(required.length > 0 ? { required } : {}),
    ...(closed ? { additionalProperties: false } : {}),
  }
}

/** One entry per path, sorted by path, merging the search params of routes that share one. */
export function collectRoutes(found: readonly PublishedRoute[]): readonly PublishedRoute[] {
  const byPath = new Map<string, PublishedRoute>()
  for (const route of found) {
    const existing = byPath.get(route.path)
    const search = mergeSearch(existing?.search, route.search)
    byPath.set(
      route.path,
      search === undefined ? { path: route.path } : { path: route.path, search },
    )
  }
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

function namesOf(value: JsonSchemaValue | undefined): readonly string[] {
  return Array.isArray(value)
    ? value.filter((name): name is string => typeof name === 'string')
    : []
}

function objectOf(value: JsonSchemaValue | undefined): JsonSchemaObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonSchemaObject)
    : {}
}
