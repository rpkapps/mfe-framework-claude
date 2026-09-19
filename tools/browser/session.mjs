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

/*
 * `localhost`, never `127.0.0.1`: the dev server binds whichever family the
 * host resolves to — `[::1]` on this machine — and a hardcoded IPv4 literal is
 * refused outright by a server that is running perfectly well.
 */
const ORIGIN = 'http://localhost:3000'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/** Where a shot lands. Ignored by git; see `shot` below for why. */
const SHOT_DIR = 'screenshots'

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

  /**
   * Writes to an ignored directory on purpose. A screenshot is a snapshot of
   * something that keeps moving and no test asserts on it, so a tracked one is
   * a stale picture the repository carries forever — undiffable, and heavier
   * every time it is regenerated. Look at it, then let it go.
   */
  const shot = async name => {
    const file = resolve(repoRoot, SHOT_DIR, `${name}.png`)
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
    await page.goto(`${ORIGIN}${path}`, { waitUntil: 'load' })
    await page.waitForSelector('[data-slot="shell-header"]', { timeout: 20_000 })
    await page.waitForTimeout(settle)
  }

  const close = async () => {
    await browser.close()
  }

  return { browser, page, problems, shot, go, close }
}
