#!/usr/bin/env node
/**
 * Screenshots the running shell. Expects `pnpm dev` on port 3000.
 *
 * Usage, from the repository root:
 *   node apps/shell/scripts/screenshot.mjs [path] [outfile]
 *
 * Both arguments are optional; the default outfile is under `screenshots/`,
 * which git ignores.
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

/*
 * `localhost`, never `127.0.0.1`: the dev server binds whichever family the
 * host resolves to — `[::1]` on this machine — and a hardcoded IPv4 literal is
 * refused outright by a server that is running perfectly well.
 */
const ORIGIN = 'http://localhost:3000'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
// Ignored by git: nothing asserts on a screenshot, so a tracked one is only a
// stale picture of a page that has moved on since.
const outfile = resolve(repoRoot, process.argv[3] ?? 'screenshots/shell-header.png')

// This machine's preinstalled Chromium is a build behind the one this
// Playwright release downloads, and downloading browsers is out of scope.
const preinstalled = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch(
  existsSync(preinstalled) ? { executablePath: preinstalled } : {},
)
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

const problems = []
page.on('console', message => message.type() === 'error' && problems.push(message.text()))
page.on('pageerror', error => problems.push(`pageerror: ${error.message}`))

// `networkidle` never arrives: the dev servers hold a websocket open for hot
// updates. The load event and then the shell header is what says it is ready.
await page.goto(`${ORIGIN}${process.argv[2] ?? '/'}`, { waitUntil: 'load' })
await page.waitForSelector('[data-slot="shell-header"]', { timeout: 20_000 })
await page.waitForTimeout(1500)

await mkdir(dirname(outfile), { recursive: true })
await page.screenshot({ path: outfile })

console.log('url:', page.url())
console.log(
  'header:',
  (await page.locator('[data-slot="shell-header"]').innerText()).replace(/\n/g, ' | '),
)
console.log('console errors:', problems.length === 0 ? '(none)' : problems.join(' ;; '))
console.log('written:', outfile)

await browser.close()
