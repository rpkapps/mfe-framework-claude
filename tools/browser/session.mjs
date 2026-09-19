/**
 * A browser attached to the running dev servers, for driving the page by hand.
 *
 * `pnpm verify:page` is the automated version and is the one CI runs; this is
 * the thing to import from a throwaway script when a change has to be *looked*
 * at. It starts nothing: point it at servers that are already up.
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/**
 * This machine's preinstalled Chromium is a build behind the one this
 * Playwright release downloads, and downloading browsers is out of scope.
 */
const PREINSTALLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

export async function openShell({ width = 1500, height = 1000 } = {}) {
  const browser = await chromium.launch(
    existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {},
  )
  const page = await browser.newPage({ viewport: { width, height } })

  /** Every console error and page error, so a silent failure is not silent. */
  const problems = []
  page.on('console', message => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', error => {
    problems.push(`pageerror: ${error.message}`)
  })

  const shot = async name => {
    const file = resolve(repoRoot, 'apps/shell/docs', `${name}.png`)
    await mkdir(dirname(file), { recursive: true })
    await page.screenshot({ path: file })
    return file
  }

  /**
   * `networkidle` never arrives: the dev servers hold a websocket open for hot
   * updates. Waiting for the load event and then for the mount root is what
   * actually says the page is ready.
   */
  const go = async (path, { settle = 2500 } = {}) => {
    await page.goto(`http://127.0.0.1:3000${path}`, { waitUntil: 'load' })
    await page.waitForSelector('[data-slot="shell-header"]', { timeout: 20_000 })
    await page.waitForTimeout(settle)
  }

  const close = async () => {
    await browser.close()
  }

  return { browser, page, problems, shot, go, close }
}
