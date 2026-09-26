import type { RegistryEntry } from '@company/mfe-react'
import { describe, expect, it, vi } from 'vitest'

import { navigateTool, routePattern } from './navigate.ts'

const call = { toolCallId: 'c', threadId: 't', runId: 'r', signal: new AbortController().signal }

const operations = {
  id: 'operations',
  definitionKind: 'app',
  adapter: 'react',
  manifestUrl: 'http://localhost:3001/mf-manifest.json',
  title: 'Operations',
  routes: [
    { path: '/' },
    {
      path: '/assets',
      search: {
        type: 'object',
        properties: { site: { enum: ['north', 'south'] } },
      },
    },
    { path: '/wells/:wellId' },
    { path: '/reports/*' },
  ],
} as unknown as RegistryEntry

describe('routePattern', () => {
  it.each([
    ['/', '/', true],
    ['/', '/wells', false],
    ['/wells/:wellId', '/wells/W-12', true],
    ['/wells/:wellId', '/wells', false],
    ['/wells/:wellId', '/wells/W-12/log', false],
    ['/settings/:tab?', '/settings', true],
    ['/settings/:tab?', '/settings/theme', true],
    ['/reports/*', '/reports/a/b', true],
    ['/reports/*', '/reports', true],
    ['/a.b', '/aXb', false],
  ])('%s against %s is %s', (path, url, matches) => {
    expect(routePattern(path).test(url)).toBe(matches)
  })
})

describe('the navigate tool', () => {
  it('lists every App with its pages and the search params they take', () => {
    const tool = navigateTool([operations], vi.fn())
    expect(tool?.description).toContain(
      '- operations (Operations): /, /assets?site=north|south, /wells/:wellId, /reports/*',
    )
    expect(tool?.inputSchema).toMatchObject({ properties: { app: { enum: ['operations'] } } })
  })

  it('goes to a published page through the router, with its search params', async () => {
    const go = vi.fn((href: string) => Promise.resolve<string | undefined>(href))
    const tool = navigateTool([operations], go)

    const result: unknown = await tool?.execute(
      { app: 'operations', path: '/assets', search: { site: 'south' } },
      call,
    )

    expect(go).toHaveBeenCalledWith('/operations/assets?site=south')
    expect(result).toEqual({ status: 'navigated', url: '/operations/assets?site=south' })
  })

  it('answers with the URL the router landed on, which it may have normalised', async () => {
    const tool = navigateTool([operations], () => Promise.resolve('/operations/wells/W%2012'))
    const result: unknown = await tool?.execute({ app: 'operations', path: '/wells/W 12/' }, call)
    expect(result).toEqual({ status: 'navigated', url: '/operations/wells/W%2012' })
  })

  it('says so when the page stays where it was', async () => {
    const tool = navigateTool([operations], () => Promise.resolve(undefined))
    const result: unknown = await tool?.execute({ app: 'operations', path: '/wells/W-1' }, call)
    expect(result).toMatchObject({ status: 'blocked' })
  })

  it.each([
    [{ app: 'nowhere' }, "There is no App 'nowhere'."],
    [{ app: 'operations', path: '/pumps' }, 'operations has no page at /pumps.'],
    [{ app: 'operations', path: '/assets', search: { site: 'west' } }, "'site' must be one of"],
    [{ app: 'operations', path: '/assets', search: { page: '2' } }, "no search param 'page'"],
    [{ app: 'operations', path: '/reports/../../admin' }, 'with no `..`'],
    [{ app: 'operations', path: '/wells/W-1?tab=log' }, 'search params go in `search`'],
  ])('refuses %j without navigating', async (input, error) => {
    const go = vi.fn()
    const result: unknown = await navigateTool([operations], go)?.execute(input, call)
    expect(result).toMatchObject({
      status: 'invalid',
      error: expect.stringContaining(error) as unknown,
    })
    expect(go).not.toHaveBeenCalled()
  })

  it('is not offered when there are no Apps', () => {
    expect(navigateTool([], vi.fn())).toBeUndefined()
  })
})
