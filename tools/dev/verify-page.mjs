#!/usr/bin/env node
/**
 * Boots the shell and every example container, loads the page in a real
 * browser, and asserts that a container actually mounted.
 *
 * This exists because the unit suite cannot see the things that break a
 * federated page. Sharing conflicts, a bundler's dev-only transform, a global
 * that assumes one router per page, a second copy of a package that carries
 * React context — every one of those compiles, type-checks and passes 1000
 * tests while rendering nothing, or rendering the shell inside the App. Each
 * assertion below stands for a defect that shipped and was found this way.
 *
 * Usage: pnpm run verify:page [--url /operations] [--keep-open]
 */

import { spawn } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

const { values } = parseArgs({
  options: { url: { type: 'string', default: '/operations' }, 'keep-open': { type: 'boolean' } },
})

/** This machine's preinstalled Chromium, as apps/shell/scripts/screenshot.mjs uses. */
const PREINSTALLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const children = []

function start(filter) {
  const child = spawn('pnpm', ['--filter', filter, 'run', 'dev'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so one kill takes the whole tree: pnpm spawns
    // rspack, and killing only pnpm leaves the port held.
    detached: true,
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  children.push(child)
  const note = data => process.stderr.write(`[${filter}] ${data}`)
  child.stdout.on('data', note)
  child.stderr.on('data', note)
  return child
}

function stopAll() {
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
}

async function waitForOk(url, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

/** The containers to run, and the manifest URL each one has to answer on. */
async function collectContainers() {
  const examplesDir = join(repoRoot, 'examples')
  const names = (await readdir(examplesDir, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()

  const containers = []
  for (const name of names) {
    const manifest = await readJson(join(examplesDir, name, 'package.json'))
    if (!manifest.scripts?.dev) continue
    containers.push({
      packageName: manifest.name,
      manifestUrl: `http://127.0.0.1:${manifest.mfe.port}/mf-manifest.json`,
    })
  }
  return containers
}

const failures = []

function check(description, condition, detail) {
  if (condition) {
    console.log(`  ok   ${description}`)
    return
  }
  failures.push(`${description}${detail === undefined ? '' : ` — ${detail}`}`)
  console.log(`  FAIL ${description}${detail === undefined ? '' : ` — ${detail}`}`)
}

async function main() {
  const containers = await collectContainers()

  console.log(`Starting the shell and ${containers.length} container(s)…`)
  start('@company/shell')
  for (const container of containers) start(container.packageName)

  await Promise.all([
    waitForOk('http://127.0.0.1:3000/'),
    ...containers.map(container => waitForOk(container.manifestUrl)),
  ])
  console.log('All dev servers are up.\n')

  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch(
    existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {},
  )
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('console', message => {
    // HMR sockets close as this script tears the servers down, which says
    // nothing about the page.
    if (message.type() === 'error' && !message.text().includes('WebSocket')) {
      pageErrors.push(message.text())
    }
  })

  await page.goto(`http://127.0.0.1:3000${values.url}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(6000)

  const scopes = await page.evaluate(() =>
    [...document.querySelectorAll('[data-mfe-scope]')].map(node => ({
      id: node.getAttribute('data-mfe-scope'),
      nested:
        node.parentElement?.closest('[data-mfe-scope]')?.getAttribute('data-mfe-scope') ?? null,
      text: (node.innerText ?? '').replace(/\s+/g, ' ').trim(),
    })),
  )
  const shellHeaders = await page.evaluate(
    () => document.querySelectorAll('[data-slot="shell-header"]').length,
  )
  const mounted = scopes.filter(scope => scope.text !== '')

  console.log(`Assertions for ${values.url}:`)

  check('the shell chrome renders exactly once', shellHeaders === 1, `found ${shellHeaders}`)
  check('an App mounted from its own container', mounted.length > 0, 'no scope root has content')

  // The shell rendering inside a mount is the router-global collision: the App
  // adopts the shell's root component and recurses.
  check(
    'no mount contains the shell',
    !mounted.some(scope => scope.text.includes('Search or jump to')),
    'a scope root contains the shell chrome',
  )

  // A Widget from a second container, mounted inside the first App, is what
  // proves sharing and the mount providers actually cross the boundary.
  const nested = scopes.filter(scope => scope.nested !== null && scope.text !== '')
  check(
    'a Widget from another container mounted inside the App',
    nested.length > 0,
    'no nested scope root has content',
  )

  // Every framework hook fails this way when a container resolves its own copy
  // of the React surface.
  check(
    'framework hooks resolved their mount',
    !mounted.some(scope => scope.text.includes('outside any mount')),
    'a mount reported a hook called outside any mount',
  )

  check('the page logged no errors', pageErrors.length === 0, pageErrors.join(' ;; '))

  console.log('\nMounted:')
  for (const scope of mounted) {
    console.log(
      `  ${scope.nested === null ? '' : `${scope.nested} > `}${scope.id}: ${scope.text.slice(0, 90)}`,
    )
  }

  if (values['keep-open'] !== true) await browser.close()
}

try {
  await main()
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error))
  console.error(error)
} finally {
  stopAll()
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log(
  '\nThe page works: a container mounted, and a Widget from a second container mounted inside it.',
)
process.exit(0)
