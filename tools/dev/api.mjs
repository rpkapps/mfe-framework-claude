#!/usr/bin/env node
/**
 * The tiny API the examples talk to in development.
 *
 * It exists so `#mfe/fetch` has something real to reach. A container that
 * cannot make a request demonstrates nothing about the request boundary: the
 * base URL it resolves against, the token it attaches and the origin allowlist
 * that decides where the token goes are only observable when a request
 * actually goes out and comes back.
 *
 * This is not part of the framework. A deployment brings its own API; this
 * stands in for one, on the origin the examples' `runtime-config.json` names.
 */

import { createServer } from 'node:http'

const PORT = Number(process.env['MFE_DEV_API_PORT'] ?? 3010)

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
 * The shell and every container is a different origin, so a browser will not
 * send these requests without CORS — and the Authorization header the request
 * boundary attaches makes each one preflighted.
 */
function cors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  response.setHeader('Access-Control-Max-Age', '600')
}

function json(response, status, body) {
  cors(response)
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

const server = createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    cors(response)
    response.writeHead(204)
    response.end()
    return
  }

  const url = new URL(request.url ?? '/', `http://localhost:${String(PORT)}`)

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

  // What the request boundary attached, echoed back. The lab's probe uses this
  // to show that the token reaches a declared API origin and nothing else.
  if (url.pathname === '/api/lab/probe') {
    json(response, 200, {
      sawAuthorization: request.headers.authorization !== undefined,
      // Never the token itself: this is a development server, and a token in a
      // log or a screenshot is a token in a log or a screenshot.
      scheme: request.headers.authorization?.split(' ')[0] ?? null,
      path: url.pathname,
    })
    return
  }

  json(response, 404, { error: `No route for ${url.pathname}.` })
})

server.listen(PORT, () => {
  console.log(`dev api    :${String(PORT)}  /api/assets, /api/lab/probe`)
})
