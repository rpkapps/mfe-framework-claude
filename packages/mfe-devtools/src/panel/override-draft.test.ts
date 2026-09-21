import { describe, expect, it } from 'vitest'

import { conflictingContainers, manifestUrlFor, validateDraft } from './override-draft.ts'

describe('deriving a manifest URL from a dev server', () => {
  it('appends the manifest to a bare host and port', () => {
    expect(manifestUrlFor('localhost:3001')).toBe('http://localhost:3001/mf-manifest.json')
  })

  it('reads a bare port as a port on this machine, not as a host number', () => {
    // `new URL('http://3001')` parses, and resolves to http://0.0.11.185.
    expect(manifestUrlFor('3001')).toBe('http://localhost:3001/mf-manifest.json')
  })

  it('leaves a manifest URL somebody pasted whole alone', () => {
    expect(manifestUrlFor('http://localhost:3001/mf-manifest.json')).toBe(
      'http://localhost:3001/mf-manifest.json',
    )
  })

  it('keeps a base path rather than throwing it away', () => {
    expect(manifestUrlFor('https://cdn.example.com/operations')).toBe(
      'https://cdn.example.com/operations/mf-manifest.json',
    )
  })

  it('keeps https when that is what was given', () => {
    expect(manifestUrlFor('https://localhost:3001')).toBe('https://localhost:3001/mf-manifest.json')
  })

  it('has no answer for an empty box, or for something that is not a URL', () => {
    expect(manifestUrlFor('')).toBeUndefined()
    expect(manifestUrlFor('   ')).toBeUndefined()
    expect(manifestUrlFor('not a url at all')).toBeUndefined()
  })
})

describe('validating a draft', () => {
  it('passes an absolute http URL', () => {
    const problems = validateDraft(new Map([['operations', 'http://localhost:3001/m.json']]))

    expect(problems).toHaveLength(0)
  })

  it('rejects a relative URL, because it would resolve against the shell', () => {
    const problems = validateDraft(new Map([['operations', '/mf-manifest.json']]))

    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toContain('absolute URL')
  })

  it('asks for a URL rather than accepting an empty box as a clear', () => {
    const problems = validateDraft(new Map([['operations', '  ']]))

    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toContain('clear the override')
  })

  it('passes a staged removal, which carries no URL to check', () => {
    expect(validateDraft(new Map([['operations', null]]))).toHaveLength(0)
  })

  it('names every entry that is wrong, not just the first', () => {
    const problems = validateDraft(
      new Map([
        ['operations', '/relative'],
        ['reports', 'also-not-a-url'],
        ['insights', 'http://localhost:3004/m.json'],
      ]),
    )

    expect(problems.map(problem => problem.id)).toEqual(['operations', 'reports'])
  })
})

describe('finding a container pointed at two URLs', () => {
  const containerOf = (id: string): string | undefined =>
    ({ wells: 'operations', assets: 'operations', summary: 'reports' })[id]

  it('reports the container, because one container is registered once', () => {
    const conflicts = conflictingContainers(
      new Map([
        ['wells', 'http://localhost:3001/m.json'],
        ['assets', 'http://localhost:3009/m.json'],
      ]),
      containerOf,
    )

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.container).toBe('operations')
  })

  it('says nothing when every definition of a container agrees', () => {
    const conflicts = conflictingContainers(
      new Map([
        ['wells', 'http://localhost:3001/m.json'],
        ['assets', 'http://localhost:3001/m.json'],
      ]),
      containerOf,
    )

    expect(conflicts).toHaveLength(0)
  })

  it('does not confuse two containers for one', () => {
    const conflicts = conflictingContainers(
      new Map([
        ['wells', 'http://localhost:3001/m.json'],
        ['summary', 'http://localhost:3002/m.json'],
      ]),
      containerOf,
    )

    expect(conflicts).toHaveLength(0)
  })

  it('ignores a definition whose container it cannot name', () => {
    const conflicts = conflictingContainers(
      new Map([['unknown', 'http://localhost:3001/m.json']]),
      containerOf,
    )

    expect(conflicts).toHaveLength(0)
  })
})
