import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { serveLocalRuntimeConfig, type LocalRuntimeConfigServing } from './dev-server.ts'
import { writeFile } from './testing/containers.ts'
import { cleanupContainers, createContainer } from './testing/fixtures.ts'

const LOCAL = '{\n  "apiBaseUrl": "http://localhost:3010/api/"\n}\n'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
  cleanupContainers()
})

/** A server with the middleware first, and a 404 for whatever it passes on, as a dev server ends. */
async function serve(options: Omit<LocalRuntimeConfigServing, 'containerRoot'>, root: string) {
  const middleware = serveLocalRuntimeConfig({ ...options, containerRoot: root })
  const server = createServer((request, response) => {
    middleware(request, response, error => {
      response.statusCode = error === undefined ? 404 : 500
      response.end(error instanceof Error ? error.message : 'passed on')
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, 'localhost', resolve))
  const { port } = server.address() as AddressInfo
  return (path: string, init?: RequestInit) => fetch(`http://localhost:${port}${path}`, init)
}

describe('serveLocalRuntimeConfig', () => {
  it("answers the runtime configuration's URL with the developer's copy in .mfe/", async () => {
    const root = createContainer({ '.mfe/runtime-config.json': LOCAL })
    const request = await serve({}, root)

    const response = await request('/runtime-config.json?t=1')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe(LOCAL)
  })

  it('reads the file on every request, so an edit needs no restart', async () => {
    const root = createContainer({ '.mfe/runtime-config.json': LOCAL })
    const request = await serve({}, root)
    await request('/runtime-config.json')

    writeFile(root, '.mfe/runtime-config.json', '{ "apiBaseUrl": "http://edited/" }')

    expect(await (await request('/runtime-config.json')).json()).toEqual({
      apiBaseUrl: 'http://edited/',
    })
  })

  it('serves a renamed file at its own name, under the path the assets are served from', async () => {
    const root = createContainer({ '.mfe/app settings.json': LOCAL })
    const request = await serve(
      { runtimeConfigFileName: 'app settings.json', servePath: '/ops/' },
      root,
    )

    expect((await request('/ops/app%20settings.json')).status).toBe(200)
    expect((await request('/runtime-config.json')).status).toBe(404)
    expect((await request('/app%20settings.json')).status).toBe(404)
  })

  it('reads from the generated directory an author moved', async () => {
    const root = createContainer({ 'build/mfe/runtime-config.json': LOCAL })
    const request = await serve({ generatedDir: 'build/mfe' }, root)

    expect(await (await request('/runtime-config.json')).text()).toBe(LOCAL)
  })

  it('passes on every other request, and this one when there is no local file', async () => {
    const root = createContainer({ '.mfe/runtime-config.json': LOCAL })
    const request = await serve({}, root)

    expect((await request('/remoteEntry.js')).status).toBe(404)
    expect((await request('/runtime-config.json', { method: 'POST' })).status).toBe(404)

    const empty = await serve({}, createContainer({}))
    expect(await (await empty('/runtime-config.json')).text()).toBe('passed on')
  })

  it('passes on a file it cannot read as an error that names it and the repair', async () => {
    const root = createContainer({ '.mfe/runtime-config.json/not-a-file': '' })
    const request = await serve({}, root)

    const response = await request('/runtime-config.json')

    expect(response.status).toBe(500)
    expect(await response.text()).toMatch(
      /runtime-config\.json: the build failed to serve the local runtime configuration: expected a readable file, found .*EISDIR.* Make .* a readable JSON file/s,
    )
  })

  it('answers HEAD with the headers alone', async () => {
    const root = createContainer({ '.mfe/runtime-config.json': LOCAL })
    const request = await serve({}, root)

    const response = await request('/runtime-config.json', { method: 'HEAD' })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(LOCAL)))
    expect(await response.text()).toBe('')
  })
})
