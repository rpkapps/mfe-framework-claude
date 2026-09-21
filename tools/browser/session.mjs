/** A browser attached to dev servers that are already running, for looking at a change by hand. */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

/** `localhost`, never `127.0.0.1`: the dev server binds whichever family the host resolves to. */
const ORIGIN = 'http://localhost:3000'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

const SHOT_DIR = 'screenshots'

/** This machine's preinstalled Chromium; downloading the build Playwright wants is out of scope. */
const PREINSTALLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

export async function openShell({ width = 1500, height = 1000 } = {}) {
  const browser = await chromium.launch(
    existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {},
  )
  const page = await browser.newPage({ viewport: { width, height } })

  const problems = []
  page.on('console', message => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', error => {
    problems.push(`pageerror: ${error.message}`)
  })

  /** Git-ignored on purpose: a screenshot no test asserts on is a picture that goes stale. */
  const shot = async name => {
    const file = resolve(repoRoot, SHOT_DIR, `${name}.png`)
    await mkdir(dirname(file), { recursive: true })
    await page.screenshot({ path: file })
    return file
  }

  /** `networkidle` never arrives: the dev servers hold a websocket open for hot updates. */
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
