#!/usr/bin/env node
/**
 * Screenshots the running shell. Expects `dev` on port 3000.
 * Usage: node scripts/screenshot.mjs [path] [outfile]
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const shellRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = resolve(shellRoot, process.argv[3] ?? 'docs/shell-header.png')

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

await page.goto(`http://127.0.0.1:3000${process.argv[2] ?? '/'}`, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-slot="shell-header"]', { timeout: 15000 })
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
