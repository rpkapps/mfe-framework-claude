#!/usr/bin/env node
/**
 * Does editing this file hot-update the page, or reload it?
 *
 * A full reload looks almost identical to a hot update — the change appears —
 * so the difference is only visible in what was lost: scroll position, an open
 * dialog, a half-typed form, the dashboard you were building. This asks the
 * question directly by putting a value on `window` that a reload cannot carry.
 *
 * Usage, against servers that are already running (`pnpm dev`):
 *   node tools/dev/hmr-probe.mjs <file> [url]
 *
 * For example:
 *   node tools/dev/hmr-probe.mjs apps/shell/src/shell/chrome.tsx
 *   node tools/dev/hmr-probe.mjs examples/lab/src/routes/index.tsx /lab
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

const [target, path = '/'] = process.argv.slice(2)
if (target === undefined) {
  console.error('Usage: node tools/dev/hmr-probe.mjs <file> [url]')
  process.exit(1)
}

const file = resolve(repoRoot, target)
const PREINSTALLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const { chromium } = await import('@playwright/test')
const browser = await chromium.launch(
  existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {},
)
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

const log = []
page.on('console', message => log.push(`[${message.type()}] ${message.text()}`))
page.on('pageerror', error => log.push(`pageerror: ${error.message}`))

// `networkidle` never arrives: the dev servers hold a websocket open for hot
// updates. The mount root is what says the page is ready.
await page.goto(`http://localhost:3000${path}`, { waitUntil: 'load' })
await page.waitForSelector('[data-mfe-scope], [data-slot="shell-header"]', { timeout: 30_000 })
await page.waitForTimeout(3000)

// Survives a hot update and nothing else.
await page.evaluate(() => {
  window.hmrProbe = 'alive'
})
log.length = 0

const original = await readFile(file, 'utf8')
await writeFile(file, `${original}\n// hmr-probe ${String(Date.now())}\n`)
await page.waitForTimeout(8000)
await writeFile(file, original)
await page.waitForTimeout(5000)

const survived = await page.evaluate(() => window.hmrProbe ?? '(the page reloaded)')

console.log(`file:      ${target}`)
console.log(`url:       ${page.url()}`)
console.log(`result:    ${survived === 'alive' ? 'hot-updated in place' : survived}`)
const notable = log.filter(line => /hmr|hot|reload|error/i.test(line))
console.log(
  `console:   ${notable.length === 0 ? '(nothing about hot updates)' : notable.join('\n           ')}`,
)

await browser.close()
process.exitCode = survived === 'alive' ? 0 : 1
