import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { planContainer } from '../plan.ts'
import { cleanupContainers, createContainer } from '../testing/fixtures.ts'
import { TEST_PROFILE } from '../testing/profile.ts'
import { writeGeneratedFiles } from './emit.ts'

const ENTRY = `
import { createApp } from '@acme/mfe-adapter'
export const operations = createApp({ id: 'operations', routes: [] })
`

const CONFIG = `
import { env } from '@acme/mfe-plugin'
import { z } from 'zod'

export default {
  apiBaseUrl: env('API_BASE_URL', z.string().url(), { api: true }),
  telemetryEnabled: env('TELEMETRY_ENABLED', z.coerce.boolean().default(true)),
  pageSize: env('PAGE_SIZE', z.number().int().min(1).default(25)),
  ratio: env('RATIO', z.number().optional()),
  mode: env('MODE', z.enum(['staging', 'production']).optional()),
  label: env('LABEL', z.string().nullable().default('Operations')),
  hosts: env('HOSTS', z.array(z.string()).default([])),
}
`

const scratch: string[] = []

afterEach(() => {
  cleanupContainers()
  while (scratch.length > 0) rmSync(scratch.pop() as string, { recursive: true, force: true })
})

function generate(config = CONFIG) {
  const root = createContainer({ 'src/mfe.ts': ENTRY, 'src/mfe.config.ts': config })
  const plan = planContainer(TEST_PROFILE, {
    containerRoot: root,
    buildTime: '2026-01-02T03:04:05.000Z',
  })
  writeGeneratedFiles(plan.generated.files)
  return {
    script: join(root, '.mfe/runtime-config.sh'),
    defaults: readFileSync(join(root, '.mfe/runtime-config.defaults.json'), 'utf8'),
  }
}

/** A served directory holding what the build shipped, as the image would. */
function servedDirectory(contents: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'mfe-served-'))
  scratch.push(dir)
  if (contents !== null) writeFileSync(join(dir, 'runtime-config.json'), contents)
  return dir
}

function run(script: string, dir: string, env: Record<string, string>) {
  // `dash` is the strictest POSIX shell to hand; it stands in for BusyBox sh in nginx:alpine.
  const result = spawnSync('dash', [script, dir], {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', ...env },
  })
  let written: unknown
  try {
    written = JSON.parse(readFileSync(join(dir, 'runtime-config.json'), 'utf8'))
  } catch {
    written = undefined
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, written }
}

describe('runtime-config defaults', () => {
  it('holds only the declared defaults, so a required field stays absent', () => {
    const { defaults } = generate()

    expect(JSON.parse(defaults)).toEqual({
      telemetryEnabled: true,
      pageSize: 25,
      label: 'Operations',
      hosts: [],
    })
  })

  it('writes the script executable', () => {
    const { script } = generate()

    expect(statSync(script).mode & 0o111).toBe(0o111)
    expect(readFileSync(script, 'utf8').startsWith('#!/bin/sh\n')).toBe(true)
  })
})

describe('runtime-config start-up script', () => {
  it('writes set variables over the shipped defaults, typed by their schema', () => {
    const { script, defaults } = generate()
    const dir = servedDirectory(defaults)

    const result = run(script, dir, {
      API_BASE_URL: 'https://api.example.com/',
      TELEMETRY_ENABLED: 'false',
      RATIO: '0.5',
      MODE: 'staging',
      HOSTS: '["a.example.com"]',
    })

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(result.written).toEqual({
      apiBaseUrl: 'https://api.example.com/',
      telemetryEnabled: false,
      pageSize: 25,
      ratio: 0.5,
      mode: 'staging',
      label: 'Operations',
      hosts: ['a.example.com'],
    })
    expect(result.stdout).toContain('from API_BASE_URL, TELEMETRY_ENABLED, RATIO, MODE, HOSTS')
  })

  it('keeps a value already in the file when its variable is unset or empty', () => {
    const { script } = generate()
    const dir = servedDirectory(
      '{ "apiBaseUrl": "https://mounted.example.com/", "pageSize": 50, "label": null }',
    )

    const result = run(script, dir, { PAGE_SIZE: '' })

    expect(result.status).toBe(0)
    expect(result.written).toEqual({
      apiBaseUrl: 'https://mounted.example.com/',
      pageSize: 50,
      label: null,
    })
  })

  it('escapes a string so the file stays JSON', () => {
    const { script, defaults } = generate()
    const dir = servedDirectory(defaults)
    const awkward = 'https://example.com/?q="a\\b"\tx\ny\u0001\'z'

    const result = run(script, dir, { API_BASE_URL: awkward, LABEL: 'Ops, "West" {1}' })

    expect(result.status).toBe(0)
    expect(result.written).toMatchObject({ apiBaseUrl: awkward, label: 'Ops, "West" {1}' })
  })

  it('writes null only for a nullable field', () => {
    const { script, defaults } = generate()
    const dir = servedDirectory(defaults)

    const result = run(script, dir, { API_BASE_URL: 'null', LABEL: 'null' })

    expect(result.written).toMatchObject({ apiBaseUrl: 'null', label: null })
  })

  it('starts from nothing when no file was shipped', () => {
    const { script } = generate()
    const dir = servedDirectory(null)

    const result = run(script, dir, { API_BASE_URL: 'https://api.example.com/' })

    expect(result.status).toBe(0)
    expect(result.written).toEqual({ apiBaseUrl: 'https://api.example.com/' })
  })

  it('refuses to start without a required value, and leaves the file as it was', () => {
    const { script, defaults } = generate()
    const dir = servedDirectory(defaults)

    const result = run(script, dir, {})

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('API_BASE_URL is required (apiBaseUrl: a string in uri form)')
    expect(result.written).toEqual(JSON.parse(defaults))
  })

  it.each([
    ['TELEMETRY_ENABLED', 'yes', 'TELEMETRY_ENABLED must be true or false; got "yes".'],
    ['PAGE_SIZE', '2.5', 'PAGE_SIZE must be a whole number; got "2.5".'],
    ['RATIO', 'half', 'RATIO must be a number; got "half".'],
    ['MODE', 'prod', 'MODE must be one of "staging", "production"; got "prod".'],
    ['HOSTS', 'a.example.com', 'HOSTS must be a JSON array, written as JSON; got "a.example.com".'],
  ])('rejects %s=%s before it reaches the browser', (name, value, message) => {
    const { script, defaults } = generate()
    const dir = servedDirectory(defaults)

    const result = run(script, dir, { API_BASE_URL: 'https://api.example.com/', [name]: value })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
    expect(result.written).toEqual(JSON.parse(defaults))
  })

  it('keeps an undeclared key, so the browser names it', () => {
    const { script } = generate()
    const dir = servedDirectory('{"apiBaseUrl":"https://a.example.com/","apiBaseUri":"x"}')

    const result = run(script, dir, {})

    expect(result.written).toEqual({ apiBaseUrl: 'https://a.example.com/', apiBaseUri: 'x' })
  })

  it('refuses a file that is not a flat JSON object', () => {
    const { script } = generate()
    const dir = servedDirectory('["not", "an", "object"]')

    const result = run(script, dir, { API_BASE_URL: 'https://api.example.com/' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is not a flat JSON object (it does not start with {)')
  })

  it('names the directory it could not find', () => {
    const { script } = generate()

    const result = run(script, '/nonexistent/served', {})

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('/nonexistent/served is not a directory')
  })

  it('quotes an enum member carrying a single quote through the shell', () => {
    const { script } = generate(`
import { env } from '@acme/mfe-plugin'
import { z } from 'zod'

export default {
  greeting: env('GREETING', z.enum(["it's", 'fine'])),
}
`)
    const dir = servedDirectory(null)

    const result = run(script, dir, { GREETING: "it's" })

    expect(result.stderr).toBe('')
    expect(result.written).toEqual({ greeting: "it's" })
  })
})
