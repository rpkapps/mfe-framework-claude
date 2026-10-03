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
  readRequestBody,
  DEMO_SCOPE,
} from '../../examples/user-context/server.mjs'
import { DEV_API_PORT } from './api-port.mjs'

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
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Access-Control-Max-Age', '600')
}

function json(response, status, body) {
  cors(response)
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

const userContext = createDemoBackend(
  fileURLToPath(new URL('../../.mfe/user-context-demo/records.json', import.meta.url)),
)

// Explicit demo routes choose the permitted writer; a submitted record id does not grant it.
const contextWriters = new Map([
  ['/api/user-context/write/lab', userContext.forOwner('lab')],
  ['/api/user-context/write/well-inspection', userContext.forOwner('well-inspection')],
  ['/api/user-context/write/shell', userContext.forOwner('shell')],
])

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    cors(response)
    response.writeHead(204)
    response.end()
    return
  }

  const url = new URL(request.url ?? '/', `http://localhost:${String(DEV_API_PORT)}`)

  if (url.pathname === '/api/user-context/hydrate' || contextWriters.has(url.pathname)) {
    if (request.method !== 'POST') {
      json(response, 405, { message: 'Use POST for user context' })
      return
    }
    const controller = new AbortController()
    const abort = () => controller.abort()
    request.once('aborted', abort)
    try {
      const body = await readRequestBody(request)
      if (body === null || typeof body !== 'object' || Array.isArray(body))
        throw new Error('User-context requests must be JSON objects')
      if (Object.hasOwn(body, 'scope'))
        throw new Error('User identity is determined by the server; do not submit scope')
      const record = url.pathname.endsWith('/hydrate')
        ? await userContext.hydrate(DEMO_SCOPE, body.ids, controller.signal)
        : await contextWriters
            .get(url.pathname)
            .write({ ...body, scope: DEMO_SCOPE }, controller.signal)
      json(response, 200, record)
    } catch (error) {
      json(response, error.code === 'user-context/conflict' ? 409 : 400, {
        code: error.code ?? 'user-context/persistence-failed',
        id: error.id,
        message: error.message,
      })
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

  json(response, 404, { error: `No route for ${url.pathname}.` })
})

// Only when this file is the process `pnpm dev` spawned: importing it must not take the port.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(DEV_API_PORT, () => {
    console.log(`dev api    :${String(DEV_API_PORT)}  /api/assets, /api/lab/probe`)
  })
}
