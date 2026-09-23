/**
 * What a container's dev server adds, whichever bundler runs it: the developer's own runtime
 * configuration, answered at the URL a deployment publishes `runtime-config.json` at. The file
 * lives in `.mfe/`, which no build copies into its output, so container code fetches the same URL
 * in development and in production and only the dev server ever reads the local values.
 */

import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { posix } from 'node:path'

import { createBuildError } from './diagnostics.ts'
import {
  localRuntimeConfigPath,
  runtimeConfigFileNameOf,
  type LocalRuntimeConfigOptions,
} from './options.ts'

/** A Connect-style handler, which webpack-dev-server and Rsbuild's dev server both take. */
export type DevServerMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void

export interface LocalRuntimeConfigServing extends LocalRuntimeConfigOptions {
  /** The path the dev server serves the container's assets under; `/` unless it was moved. */
  readonly servePath?: string | undefined
}

/**
 * Reads the file on every request, so an edited value reaches the next page load without a
 * restart, and passes the request on when there is no file. It sets its own CORS header because
 * an integration may answer before the server's own middlewares: a shell on another origin reads
 * it, exactly as it reads the container's other assets.
 */
export function serveLocalRuntimeConfig(options: LocalRuntimeConfigServing): DevServerMiddleware {
  const file = localRuntimeConfigPath(options)
  // Built the way the browser spells the request, so a name that needs escaping still matches.
  const pathname = new URL(
    posix.join('/', options.servePath ?? '/', runtimeConfigFileNameOf(options)),
    'http://localhost',
  ).pathname

  return (request, response, next) => {
    const method = request.method
    if ((method !== 'GET' && method !== 'HEAD') || pathnameOf(request.url) !== pathname) {
      next()
      return
    }

    void readFile(file).then(
      body => {
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Content-Length', body.length)
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Access-Control-Allow-Origin', '*')
        response.end(method === 'HEAD' ? undefined : body)
      },
      (cause: unknown) => {
        if (isMissing(cause)) {
          next()
          return
        }
        next(
          createBuildError({
            file,
            operation: 'serve the local runtime configuration',
            expected: 'a readable file',
            observed: cause instanceof Error ? cause.message : String(cause),
            declaredBy: 'The dev server integration',
            repair: `Make ${file} a readable JSON file, or delete it and run the generate command to seed it again.`,
            cause,
          }),
        )
      },
    )
  }
}

function pathnameOf(url: string | undefined): string {
  return new URL(url ?? '/', 'http://localhost').pathname
}

function isMissing(cause: unknown): boolean {
  return cause instanceof Error && 'code' in cause && cause.code === 'ENOENT'
}
