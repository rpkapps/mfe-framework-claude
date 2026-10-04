#!/usr/bin/env node
/**
 * The tiny API the examples talk to in development, so that `#mfe/fetch` has something real to
 * reach: the base URL, the attached token and the origin allowlist are only observable when a
 * request goes out and comes back. It is not part of the framework — a deployment brings its own
 * API, and this stands in for one on the origin the examples' `runtime-config.json` names.
 */

import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import {
  createDemoBackend,
  DEMO_USER,
  readRequestBody,
} from '../../examples/user-storage/server.mjs'

/** Exported so `pnpm dev` checks and waits on this port without a second copy of the number. */
export const DEV_API_PORT = Number(process.env['MFE_DEV_API_PORT'] ?? 3010)

const ASSETS = {
  north: [
    { id: 'a-1041', name: 'Booster pump 4', status: 'operational' },
    { id: 'a-1042', name: 'Separator 2', status: 'degraded' },
    { id: 'a-1043', name: 'Gas lift compressor', status: 'operational' },
    { id: 'a-1044', name: 'Produced water pump', status: 'offline' },
    { id: 'a-1045', name: 'Test separator', status: 'operational' },
  ],
  south: [
    { id: 'a-2011', name: 'Subsea manifold A', status: 'operational' },
    { id: 'a-2012', name: 'Umbilical termination', status: 'degraded' },
  ],
  central: [],
}

/**
 * The shell and every container is a different origin, and the Authorization header the request
 * boundary attaches makes each request preflighted.
 */
function cors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  // `traceparent` names the request's client span, so the backend's span is its child.
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, traceparent')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.setHeader('Access-Control-Max-Age', '600')
}

function json(response, status, body) {
  cors(response)
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

const userStorage = createDemoBackend(
  fileURLToPath(new URL('../../.mfe/user-storage-demo/records.json', import.meta.url)),
)

/** Whose rows a request reads and writes. A real API reads it from the authenticated session. */
function currentUser(url) {
  // Identity is the server's alone: a request naming a user or scope is refused, not obeyed.
  if (url.searchParams.has('scope') || url.searchParams.has('user'))
    throw Object.assign(new Error('The server determines the user; do not submit scope or user'), {
      status: 400,
    })
  return DEMO_USER
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    cors(response)
    response.writeHead(204)
    response.end()
    return
  }

  const url = new URL(request.url ?? '/', `http://localhost:${String(DEV_API_PORT)}`)

  // GET loads every row of the user; PUT and DELETE store or remove one key of one owner.
  if (url.pathname === '/api/user-storage' || url.pathname.startsWith('/api/user-storage/')) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    request.once('aborted', abort)
    try {
      const user = currentUser(url)
      const [owner, key, ...rest] = url.pathname
        .slice('/api/user-storage/'.length)
        .split('/')
        .map(segment => decodeURIComponent(segment))
      if (url.pathname === '/api/user-storage') {
        if (request.method !== 'GET') {
          json(response, 405, { message: 'Use GET to load user storage' })
          return
        }
        json(response, 200, await userStorage.load(user, controller.signal))
        return
      }
      if (owner === undefined || key === undefined || rest.length > 0) {
        json(response, 404, { message: `No route for ${url.pathname}.` })
        return
      }
      if (request.method === 'PUT') {
        const value = await readRequestBody(request)
        json(response, 200, await userStorage.save(user, owner, key, value, controller.signal))
        return
      }
      if (request.method === 'DELETE') {
        json(response, 200, await userStorage.save(user, owner, key, null, controller.signal))
        return
      }
      json(response, 405, { message: 'Use PUT or DELETE for one stored key' })
    } catch (error) {
      json(response, error.status ?? 500, { message: error.message })
    } finally {
      request.off('aborted', abort)
    }
    return
  }

  if (url.pathname === '/api/assets') {
    const site = url.searchParams.get('site') ?? 'north'
    const assets = Object.hasOwn(ASSETS, site) ? ASSETS[site] : undefined
    if (assets === undefined) {
      json(response, 404, { error: `No site named ${site}.` })
      return
    }
    json(response, 200, assets)
    return
  }

  // The lab's probe reads this back to show that the token reaches a declared API origin and
  // nothing else.
  if (url.pathname === '/api/lab/probe') {
    json(response, 200, {
      sawAuthorization: request.headers.authorization !== undefined,
      // Never the token itself: a token in a log or a screenshot is a token in a log.
      scheme: request.headers.authorization?.split(' ')[0] ?? null,
      path: url.pathname,
    })
    return
  }

  // The lab's checkout places its order here, and reads back the trace context that arrived.
  if (url.pathname === '/api/lab/orders' && request.method === 'POST') {
    json(response, 201, { traceparent: request.headers.traceparent ?? null })
    return
  }

  json(response, 404, { error: `No route for ${url.pathname}.` })
})

// Only when this file is the process `pnpm dev` spawned: importing it must not take the port.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(DEV_API_PORT, () => {
    console.log(
      `dev api    :${String(DEV_API_PORT)}  /api/assets, /api/lab/probe, /api/lab/orders, /api/user-storage`,
    )
  })
}
