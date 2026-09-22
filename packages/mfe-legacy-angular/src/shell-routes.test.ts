import { describe, expect, it, vi } from 'vitest'

import { isMfeError, type RegistryEntry } from '@company/mfe-core'

import { legacyAngularAdapter } from './registry/legacy-adapter.ts'
import {
  createLegacyReleaseNotesSource,
  isLegacyShellRoute,
  LEGACY_SHELL_ROUTE_PATTERNS,
  matchLegacyShellRoute,
  resolveLegacyReleaseNotesUrl,
  selectReleaseNotesRoute,
  type LegacyReleaseNotesFetch,
} from './shell-routes.ts'

function legacyEntry(overrides: Record<string, unknown> = {}): RegistryEntry {
  return legacyAngularAdapter.parse({
    name: 'asset-tracker',
    mfManifestUrl: 'https://cdn.example.test/apps/asset-tracker/mf-manifest.json',
    ...overrides,
  })
}

/** A migrated App that owns its release notes, for the additive-capability case. */
function migratedEntry(): RegistryEntry {
  return {
    ...legacyEntry(),
    capabilities: [{ name: 'releaseNotes', label: 'What’s new', path: '/release-notes' }],
  }
}

function okFetch(body: string): {
  readonly fetch: LegacyReleaseNotesFetch
  readonly calls: { url: string; signal: AbortSignal | undefined }[]
} {
  const calls: { url: string; signal: AbortSignal | undefined }[] = []
  const fetch: LegacyReleaseNotesFetch = (url, init) => {
    calls.push({ url, signal: init.signal })
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) })
  }
  return { fetch, calls }
}

describe('the shell-owned legacy routes', () => {
  it('publishes the patterns in evaluation order, catch-all last', () => {
    expect(LEGACY_SHELL_ROUTE_PATTERNS).toEqual([
      'settings',
      ':name/settings',
      'release-notes',
      ':name/release-notes',
      'solutions-health',
      ':name/solutions-health',
      ':name/**',
    ])
  })

  it('matches the shell settings page', () => {
    expect(matchLegacyShellRoute('/settings')).toEqual({ pattern: 'settings' })
  })

  it("matches an app's settings page and captures the app name", () => {
    expect(matchLegacyShellRoute('/asset-tracker/settings')).toEqual({
      pattern: ':name/settings',
      name: 'asset-tracker',
    })
  })

  it('matches the shell release notes page', () => {
    expect(matchLegacyShellRoute('/release-notes')).toEqual({ pattern: 'release-notes' })
  })

  it("matches an app's release notes page", () => {
    expect(matchLegacyShellRoute('/rigstream/release-notes')).toEqual({
      pattern: ':name/release-notes',
      name: 'rigstream',
    })
  })

  it('matches the shell solutions health page', () => {
    expect(matchLegacyShellRoute('/solutions-health')).toEqual({ pattern: 'solutions-health' })
  })

  it("matches an app's solutions health page", () => {
    expect(matchLegacyShellRoute('/asset-tracker/solutions-health')).toEqual({
      pattern: ':name/solutions-health',
      name: 'asset-tracker',
    })
  })

  it('routes everything else under an app name to that app, capturing the remainder', () => {
    expect(matchLegacyShellRoute('/asset-tracker/sites/42/edit')).toEqual({
      pattern: ':name/**',
      name: 'asset-tracker',
      rest: 'sites/42/edit',
    })
  })

  it('treats an app root as the catch-all with nothing left over', () => {
    expect(matchLegacyShellRoute('/rigstream')).toEqual({
      pattern: ':name/**',
      name: 'rigstream',
      rest: '',
    })
  })

  it('prefers a specific legacy route over the catch-all', () => {
    const match = matchLegacyShellRoute('/asset-tracker/settings')

    expect(match?.pattern).toBe(':name/settings')
  })

  it('ignores query strings, fragments and trailing slashes', () => {
    expect(matchLegacyShellRoute('/asset-tracker/settings/?tab=alerts#top')).toEqual({
      pattern: ':name/settings',
      name: 'asset-tracker',
    })
  })

  it('accepts a path written without its leading slash', () => {
    expect(matchLegacyShellRoute('settings')).toEqual({ pattern: 'settings' })
  })

  it('claims nothing at the root, which the shell owns itself', () => {
    expect(matchLegacyShellRoute('/')).toBeNull()
    expect(isLegacyShellRoute('/')).toBe(false)
  })

  it('answers the same question as a predicate for a router guard', () => {
    expect(isLegacyShellRoute('/asset-tracker/release-notes')).toBe(true)
  })
})

describe('resolveLegacyReleaseNotesUrl', () => {
  it('resolves the document that sits next to the container manifest', () => {
    const url = resolveLegacyReleaseNotesUrl(
      'https://cdn.example.test/apps/asset-tracker/mf-manifest.json',
    )

    expect(url).toBe('https://cdn.example.test/apps/asset-tracker/release-notes.md')
  })

  it('follows the manifest when it lives at a versioned path', () => {
    const url = resolveLegacyReleaseNotesUrl(
      'https://cdn.example.test/rigstream/4.7.1/mf-manifest.json',
    )

    expect(url).toBe('https://cdn.example.test/rigstream/4.7.1/release-notes.md')
  })

  it('resolves a relative manifest URL against a supplied base', () => {
    const url = resolveLegacyReleaseNotesUrl('/apps/rigstream/mf-manifest.json', {
      base: 'https://shell.example.test/solutions/',
    })

    expect(url).toBe('https://shell.example.test/apps/rigstream/release-notes.md')
  })

  it('refuses to guess a base for a relative manifest URL', () => {
    let thrown: unknown
    try {
      resolveLegacyReleaseNotesUrl('/apps/rigstream/mf-manifest.json')
    } catch (error) {
      thrown = error
    }

    expect(isMfeError(thrown)).toBe(true)
    expect(thrown).toMatchObject({ code: 'config/invalid' })
    expect((thrown as Error).message).toContain('an absolute manifest URL')
  })
})

describe('createLegacyReleaseNotesSource', () => {
  it('fetches the sibling document through the injected fetch', async () => {
    const { fetch, calls } = okFetch('# Asset Tracker 4.7.1')
    const source = createLegacyReleaseNotesSource({ fetch })

    const notes = await source.load(legacyEntry())

    expect(calls[0]?.url).toBe('https://cdn.example.test/apps/asset-tracker/release-notes.md')
    expect(notes).toEqual({
      id: 'asset-tracker',
      url: 'https://cdn.example.test/apps/asset-tracker/release-notes.md',
      markdown: '# Asset Tracker 4.7.1',
      source: 'legacy-sibling',
    })
  })

  it('passes the caller’s abort signal through to the request', async () => {
    const { fetch, calls } = okFetch('# notes')
    const source = createLegacyReleaseNotesSource({ fetch })
    const controller = new AbortController()

    await source.load(legacyEntry(), { signal: controller.signal })

    expect(calls[0]?.signal).toBe(controller.signal)
  })

  it('reports a missing document with the status and a repair', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') }),
    )
    const source = createLegacyReleaseNotesSource({ fetch })

    const thrown = await source.load(legacyEntry()).catch((error: unknown) => error)

    expect(thrown).toMatchObject({ code: 'config/unreachable', id: 'asset-tracker' })
    expect((thrown as Error).message).toContain('HTTP 404')
    expect((thrown as Error).message).toContain('release-notes.md')
  })

  it('reports a transport failure without losing the original cause', async () => {
    const cause = new Error('network down')
    const source = createLegacyReleaseNotesSource({ fetch: () => Promise.reject(cause) })

    const thrown = await source.load(legacyEntry()).catch((error: unknown) => error)

    expect(thrown).toMatchObject({ code: 'config/unreachable' })
    expect((thrown as { cause?: unknown }).cause).toBe(cause)
  })
})

describe('release notes when an App owns its own', () => {
  it('sends the shell into the App when it declares the capability', () => {
    expect(selectReleaseNotesRoute(migratedEntry())).toEqual({
      kind: 'app-capability',
      path: '/release-notes',
    })
  })

  it('keeps the legacy sibling document for an entry without the capability', () => {
    expect(selectReleaseNotesRoute(legacyEntry())).toEqual({
      kind: 'legacy-sibling',
      url: 'https://cdn.example.test/apps/asset-tracker/release-notes.md',
    })
  })

  it('leaves the legacy path working for an entry that also declares the capability', async () => {
    const { fetch, calls } = okFetch('# still published')
    const source = createLegacyReleaseNotesSource({ fetch })

    const notes = await source.load(migratedEntry())

    expect(calls).toHaveLength(1)
    expect(notes.source).toBe('legacy-sibling')
    expect(notes.markdown).toBe('# still published')
  })

  it('does not change where an unmigrated app reads its notes from when a sibling app migrates', () => {
    const migrated = selectReleaseNotesRoute(migratedEntry())
    const unmigrated = selectReleaseNotesRoute(
      legacyEntry({
        name: 'rigstream',
        mfManifestUrl: 'https://cdn.example.test/apps/rigstream/mf-manifest.json',
      }),
    )

    expect(migrated.kind).toBe('app-capability')
    expect(unmigrated).toEqual({
      kind: 'legacy-sibling',
      url: 'https://cdn.example.test/apps/rigstream/release-notes.md',
    })
  })
})
